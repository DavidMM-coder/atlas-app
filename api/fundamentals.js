import { requireUser } from "./_lib/auth.js";

const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

async function getYahooCrumb() {
  // Hit the consent/cookie endpoint to get a session cookie
  const cookieResp = await fetch("https://fc.yahoo.com", {
    headers: YF_HEADERS,
    redirect: "follow",
  });
  const setCookieHeader = cookieResp.headers.get("set-cookie") || "";
  // Extract individual cookies (Node 18 fetch doesn't expose getSetCookie() reliably)
  const cookieStr = setCookieHeader.split(/,(?=[^;]+=[^;]+)/).map(c => c.trim().split(";")[0]).join("; ");

  // Now fetch the crumb using those cookies
  const crumbResp = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...YF_HEADERS, Cookie: cookieStr },
  });
  const crumb = await crumbResp.text();
  return { crumb: crumb.trim(), cookieStr };
}

// SEC EDGAR: free, no key, no meaningful rate limit — and unlike Yahoo's quoteSummary (capped at
// ~4 trailing quarters), it exposes every quarter a company has ever tagged in its XBRL filings,
// often 8-18 years back (verified: AAPL 29 quarters to 2017, NVDA 66 quarters to 2008). This is
// what makes strategies needing deep quarterly history (Revenue Growth Acceleration, P/E Value
// Threshold) actually usable instead of permanently starved of data.
const SEC_HEADERS = { "User-Agent": "Atlas Investment Research App (contact: atlas-app@verdict-app.example)" };

let cikMapCache = null, cikMapFetchedAt = 0;
async function getCikMap() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (cikMapCache && Date.now() - cikMapFetchedAt < ONE_DAY) return cikMapCache;
  const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: SEC_HEADERS });
  if (!r.ok) return cikMapCache; // serve stale cache (if any) rather than fail outright
  const data = await r.json();
  const map = {};
  for (const entry of Object.values(data)) map[entry.ticker.toUpperCase()] = entry.cik_str;
  cikMapCache = map;
  cikMapFetchedAt = Date.now();
  return map;
}

// Merges every concept a company might have used to tag the same fact across years (e.g. revenue
// moved from "Revenues" to "RevenueFromContractWithCustomerExcludingAssessedTax" after the 2018
// ASC 606 accounting change — using only one tag silently truncates history at that boundary,
// which is exactly what capped NVDA at 12 quarters before this fix). Keeps only ~3-month-span
// entries (quarterly, not annual/YTD) and dedupes by period-end date.
//
// RESTATEMENT BIAS FIX: for a period with multiple filings (original 10-Q + later 10-K/A or
// comparative re-statements), keep the FIRST-filed value — the number the market actually saw and
// traded on at the time — not the latest (hindsight) restatement. SEC companyfacts cleanly exposes
// filing sequence via each entry's `filed` date (ISO yyyy-mm-dd), so the earliest `filed` is the
// original filing; later ones are restatements/amendments. This preserves the point-in-time
// discipline quarterKnownDate() enforces downstream. Entries missing a `filed` date sort last so a
// real filing always wins. Stores {val, filed}; 0 is a legitimate value, not "missing".
function extractQuarterly(usgaap, concepts, unitKey) {
  const byEnd = {};
  for (const concept of concepts) {
    const arr = usgaap[concept]?.units?.[unitKey];
    if (!arr) continue;
    for (const e of arr) {
      if (!e.start || !e.end) continue;
      const days = (new Date(e.end) - new Date(e.start)) / 86400000;
      if (days <= 80 || days >= 100) continue;
      const prev = byEnd[e.end];
      if (!prev || (e.filed || "9999-99-99") < (prev.filed || "9999-99-99")) byEnd[e.end] = { val: e.val, filed: e.filed || null };
    }
  }
  return byEnd;
}

// Returns null (not []) on any failure so callers can fall back to Yahoo's thinner data —
// SEC EDGAR only covers SEC-registered filers, so foreign ADRs/some ETFs will legitimately miss.
async function fetchSecQuarterlyFinancials(ticker) {
  try {
    const cikMap = await getCikMap();
    const cik = cikMap?.[ticker.toUpperCase()];
    if (!cik) return null;
    const cikStr = String(cik).padStart(10, "0");
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cikStr}.json`, { headers: SEC_HEADERS });
    if (!r.ok) return null;
    const data = await r.json();
    const usgaap = data?.facts?.["us-gaap"];
    if (!usgaap) return null;
    const revByDate = extractQuarterly(usgaap, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "SalesRevenueServicesGross"], "USD");
    const epsByDate = extractQuarterly(usgaap, ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares");
    const niByDate = extractQuarterly(usgaap, ["NetIncomeLoss"], "USD");
    const allDates = new Set([...Object.keys(revByDate), ...Object.keys(epsByDate), ...Object.keys(niByDate)]);
    const quarterlyFinancials = [...allDates]
      .sort()
      .map(date => ({
        date,
        totalRevenue: revByDate[date]?.val ?? null,
        netIncome: niByDate[date]?.val ?? null,
        eps: epsByDate[date]?.val ?? null,
        // Earliest date this quarter's numbers were actually public (latest of the per-metric filings).
        filed: [revByDate[date]?.filed, niByDate[date]?.filed, epsByDate[date]?.filed].filter(Boolean).sort().pop() || null,
      }))
      .filter(q => q.totalRevenue != null || q.eps != null);
    return quarterlyFinancials.length ? quarterlyFinancials : null;
  } catch (_) {
    return null;
  }
}

const TICKER_RE = /^[A-Za-z0-9^=][A-Za-z0-9.\-^=]{0,14}$/;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 100/min: legit peak is a multi-ticker stress test (max 8) plus rapid single-run
  // iteration on a fundamental strategy and a dossier fetch (~20/min worst case) — 5x headroom.
  const uid = await requireUser(req, res, { limit: 100 });
  if (!uid) return;

  const { ticker } = req.query;
  if (!ticker || !TICKER_RE.test(String(ticker))) return res.status(400).json({ error: "valid ticker required" });

  try {
    const { crumb, cookieStr } = await getYahooCrumb();

    const modules = [
      "defaultKeyStatistics",
      "financialData",
      "incomeStatementHistoryQuarterly",
      "earningsHistory",
      "summaryDetail",
    ].join(",");

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(crumb)}`;
    const [r, secQuarterlyFinancials] = await Promise.all([
      fetch(url, { headers: { ...YF_HEADERS, Cookie: cookieStr } }),
      fetchSecQuarterlyFinancials(ticker),
    ]);

    if (!r.ok) return res.status(r.status).json({ error: `Yahoo Finance returned ${r.status}` });

    const data = await r.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) {
      const msg = data?.quoteSummary?.error?.description || JSON.stringify(data).slice(0, 200);
      return res.status(404).json({ error: msg });
    }

    const qStmts = result.incomeStatementHistoryQuarterly?.incomeStatementHistory || [];
    const epsHistory = result.earningsHistory?.history || [];
    const earnings = epsHistory
      .map(e => ({
        date: new Date(e.quarter.raw * 1000).toISOString().slice(0, 10),
        actual: e.epsActual?.raw ?? null,
        estimate: e.epsEstimate?.raw ?? null,
        surprisePct: e.surprisePercent?.raw != null ? e.surprisePercent.raw * 100 : null,
      }))
      .filter(e => e.actual !== null)
      .sort((a, b) => a.date.localeCompare(b.date));

    // SEC EDGAR is the primary source — it routinely covers 8-18 years of quarters versus
    // Yahoo's ~4, which is what actually unlocks strategies needing deep quarterly history
    // (verified: NVDA went from 4 quarters via Yahoo to 66 via SEC). Falls back to Yahoo's
    // quoteSummary for tickers SEC doesn't cover (foreign ADRs, some ETFs).
    let quarterlyFinancials;
    if (secQuarterlyFinancials) {
      quarterlyFinancials = secQuarterlyFinancials;
    } else {
      const earningsEpsByDate = Object.fromEntries(earnings.map(e => [e.date, e.actual]));
      quarterlyFinancials = qStmts
        .map(s => {
          const date = new Date(s.endDate.raw * 1000).toISOString().slice(0, 10);
          const eps = s.dilutedEPS?.raw ?? earningsEpsByDate[date] ?? null;
          // Yahoo doesn't expose a filing date — callers fall back to a conservative lag.
          return { date, totalRevenue: s.totalRevenue?.raw ?? null, netIncome: s.netIncome?.raw ?? null, eps, filed: null };
        })
        .filter(s => s.totalRevenue != null)
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    let dividends = [];
    try {
      const divUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1mo&range=10y&events=div&crumb=${encodeURIComponent(crumb)}`;
      const divR = await fetch(divUrl, { headers: { ...YF_HEADERS, Cookie: cookieStr } });
      const divData = await divR.json();
      const divEvents = divData?.chart?.result?.[0]?.events?.dividends || {};
      dividends = Object.values(divEvents)
        .map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (_) { /* dividends optional */ }

    const stats = result.defaultKeyStatistics || {};
    const financial = result.financialData || {};
    const summary = result.summaryDetail || {};

    // Fundamentals move on a quarterly cadence — an hour of shared CDN cache spares Yahoo/SEC
    // from repeated identical fetches (e.g. stress-testing 8 tickers, then re-running).
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      trailingPE: summary.trailingPE?.raw ?? null,
      forwardPE: stats.forwardPE?.raw ?? null,
      pb: stats.priceToBook?.raw ?? null,
      dividendYield: summary.trailingAnnualDividendYield?.raw ?? null,
      revenueGrowth: financial.revenueGrowth?.raw ?? null,
      earningsGrowth: financial.earningsGrowth?.raw ?? null,
      quarterlyFinancials,
      earnings,
      dividends,
    });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch fundamentals: " + String(e) });
  }
}
