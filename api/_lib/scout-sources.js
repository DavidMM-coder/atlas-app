// Scout upstream data sources — shared between the prod handler (api/scout.js) and the vite
// dev middleware so both run the SAME code. Server-side only: the Finnhub key lives here and
// must never appear in any response, log, or error string.
//
// Every fetcher returns { ok, status, data } (never throws) so the dispatcher can map
// upstream refusals (429/403/999) straight through to the client, whose circuit breaker
// keys off those statuses.

const SEC_HEADERS = { "User-Agent": "Atlas Investment Research App (contact: atlas-app@verdict-app.example)" };
const BROWSER_UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" };

function finnhubKey() {
  return process.env.FINNHUB_API_KEY || "";
}

// Strips the token from any URL that might leak into an error message.
const scrub = (s) => String(s).replace(/token=[^&\s"']+/g, "token=***");

async function fetchJson(url, { headers = {}, timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, redirect: "follow", signal: ctrl.signal });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON upstream */ }
    return { ok: r.ok, status: r.status, data, text: data ? null : text };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: scrub(String(e)) };
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, { headers = {}, timeoutMs = 60000, method = "GET" } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers, redirect: "follow", signal: ctrl.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: scrub(String(e)) };
  } finally {
    clearTimeout(t);
  }
}

// ---- US universe --------------------------------------------------------------------------

// EDGAR ticker->CIK map (with exchange) + Finnhub US symbol list, returned raw-ish; the
// client-side normalizeUs() does the merging so the logic stays unit-tested.
export async function usSymbols() {
  const key = finnhubKey();
  if (!key) return { ok: false, status: 500, error: "FINNHUB_API_KEY not configured" };
  const [edgar, fh] = await Promise.all([
    fetchJson("https://www.sec.gov/files/company_tickers_exchange.json", { headers: SEC_HEADERS }),
    fetchJson(`https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${encodeURIComponent(key)}`, { timeoutMs: 90000 }),
  ]);
  if (!fh.ok) return { ok: false, status: fh.status || 502, error: "Finnhub symbol list failed" };
  // Trim the Finnhub payload to the fields normalizeUs uses — the raw list is ~7MB.
  const symbols = (fh.data || []).map((s) => ({
    symbol: s.symbol, description: s.description, type: s.type, mic: s.mic, currency: s.currency, isin: s.isin || null,
  }));
  return { ok: true, status: 200, data: { finnhubSymbols: symbols, edgarTickers: edgar.ok ? edgar.data : null } };
}

// Finnhub company profile + metric for one US ticker: market cap for the band check plus the
// quarterly margin series that powers the trajectory metrics. Series trimmed to 12 quarters.
export async function usMetric(ticker) {
  const key = finnhubKey();
  if (!key) return { ok: false, status: 500, error: "FINNHUB_API_KEY not configured" };
  const enc = encodeURIComponent(ticker);
  const [prof, met] = await Promise.all([
    fetchJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${enc}&token=${encodeURIComponent(key)}`),
    fetchJson(`https://finnhub.io/api/v1/stock/metric?symbol=${enc}&metric=all&token=${encodeURIComponent(key)}`),
  ]);
  if (!prof.ok || !met.ok) {
    const status = [prof, met].find((r) => !r.ok)?.status || 502;
    return { ok: false, status, error: `Finnhub returned ${status}` };
  }
  const m = met.data?.metric || {};
  const q = met.data?.series?.quarterly || {};
  const trim = (arr) => (Array.isArray(arr) ? arr.slice(0, 12).map((p) => ({ period: p.period, v: p.v })) : []);
  return {
    ok: true, status: 200,
    data: {
      profile: {
        name: prof.data?.name ?? null, currency: prof.data?.currency ?? null,
        exchange: prof.data?.exchange ?? null, industry: prof.data?.finnhubIndustry ?? null,
        marketCapM: prof.data?.marketCapitalization ?? null, sharesOutM: prof.data?.shareOutstanding ?? null,
        ipo: prof.data?.ipo ?? null,
      },
      metric: {
        marketCapM: m.marketCapitalization ?? null,
        revenueGrowthTTMYoy: m.revenueGrowthTTMYoy ?? null,
        revenueGrowth3Y: m.revenueGrowth3Y ?? null,
        grossMarginTTM: m.grossMarginTTM ?? null,
        operatingMarginTTM: m.operatingMarginTTM ?? null,
        avgVolume10d: m["10DayAverageTradingVolume"] ?? null, // millions of shares
        cashFlowPerShareTTM: m.cashFlowPerShareTTM ?? null,
        currentEv: m.enterpriseValue ?? null,
      },
      series: {
        operatingMargin: trim(q.operatingMargin),
        grossMargin: trim(q.grossMargin),
        netMargin: trim(q.netMargin),
        fcfMargin: trim(q.fcfMargin),
        salesPerShare: trim(q.salesPerShare),
        ebitda: trim(q.ebitda),
      },
    },
  };
}

// ---- EU universe --------------------------------------------------------------------------

const EURONEXT_MICS = "XPAR,XAMS,XBRU,XLIS,XOSL,ALXP,ALXB,ALXL,XMLI,MLXB,XOAS,MERK";
async function euronextCsv() {
  const url = `https://live.euronext.com/en/pd_es/data/stocks/download?mics=${EURONEXT_MICS}&display_datapoints=dp_stocks&display_filters=df_stocks`;
  const r = await fetchText(url, { headers: BROWSER_UA, method: "POST", timeoutMs: 90000 });
  if (!r.ok) return { ok: false, status: r.status || 502, error: "Euronext download failed" };
  return { ok: true, status: 200, data: { kind: "euronext-csv", csv: r.text } };
}

// XETRA: scrape the instruments page for the current allTradableInstruments.csv blob URL
// (the blob id rotates), falling back to the last URL seen working.
const XETRA_PAGE = "https://www.xetra.com/xetra-en/instruments/instruments";
const XETRA_FALLBACK = "https://www.cashmarket.deutsche-boerse.com/resource/blob/1528/83c2bb2b1d815376d91bb351ff3a3265/data/t7-xetr-allTradableInstruments.csv";
async function xetraCsv() {
  let csvUrl = XETRA_FALLBACK;
  const page = await fetchText(XETRA_PAGE, { headers: BROWSER_UA });
  if (page.ok) {
    const m = page.text.match(/https?:\/\/[^"']*allTradableInstruments\.csv/i);
    if (m) csvUrl = m[0];
  }
  const r = await fetchText(csvUrl, { headers: BROWSER_UA, timeoutMs: 90000 });
  if (!r.ok) return { ok: false, status: r.status || 502, error: "XETRA instrument file failed" };
  return { ok: true, status: 200, data: { kind: "xetra-csv", csv: r.text } };
}

// LSE: "Instrument list_N.xlsx" where N bumps roughly monthly. Probe from a hint (persisted
// by the client in refresh state) upward, then fall back downward. Returns base64 xlsx —
// parsing happens client-side with the sheetjs dependency the app already ships.
const LSE_BASE = "https://docs.londonstockexchange.com/sites/default/files/reports/Instrument%20list_";
export async function lseXlsx(hintN) {
  const hint = Number.isFinite(hintN) && hintN > 0 ? hintN : 81;
  const candidates = [];
  for (let n = hint + 4; n >= Math.max(1, hint - 2); n--) candidates.push(n);
  for (const n of candidates) {
    const head = await fetch(`${LSE_BASE}${n}.xlsx`, { method: "HEAD", headers: BROWSER_UA }).catch(() => null);
    if (head && head.ok) {
      const r = await fetch(`${LSE_BASE}${n}.xlsx`, { headers: BROWSER_UA });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      return { ok: true, status: 200, data: { kind: "lse-xlsx-b64", n, b64: buf.toString("base64") } };
    }
  }
  return { ok: false, status: 404, error: "No LSE instrument list found near hint" };
}

// Nasdaq Nordic screener API, one call per (market, category[, segment]).
const NORDIC_BASE = "https://api.nasdaq.com/api/nordic/screener/shares";
const NORDIC_MARKETS = ["STO", "HEL", "CPH"];
const NORDIC_QUERIES = [
  "category=MAIN_MARKET&segment=MID_CAP",
  "category=MAIN_MARKET&segment=SMALL_CAP",
  "category=FIRST_NORTH",
];
async function nordicRows() {
  const out = [];
  for (const market of NORDIC_MARKETS) {
    for (const qs of NORDIC_QUERIES) {
      const r = await fetchJson(`${NORDIC_BASE}?${qs}&market=${market}&tableonly=true`, { headers: { ...BROWSER_UA, Accept: "application/json" }, timeoutMs: 45000 });
      if (!r.ok) return { ok: false, status: r.status || 502, error: `Nordic screener failed (${market})` };
      const rows = r.data?.data?.instrumentListing?.rows || [];
      out.push({ market, rows: rows.map((x) => ({ symbol: x.symbol, fullName: x.fullName, currency: x.currency, isin: x.isin, segment: x.segment || null })) });
    }
  }
  return { ok: true, status: 200, data: { kind: "nordic-rows", markets: out } };
}

export async function euVenue(venue) {
  if (venue === "euronext") return euronextCsv();
  if (venue === "xetra") return xetraCsv();
  if (venue === "nordic") return nordicRows();
  return { ok: false, status: 400, error: "unknown venue" };
}

// ---- US insiders: EDGAR Form 4 daily-index batch ------------------------------------------

// One day's form index -> Form 4 entries. dateStr: YYYYMMDD.
export async function form4Index(dateStr) {
  const y = dateStr.slice(0, 4), m = Number(dateStr.slice(4, 6));
  const qtr = `QTR${Math.floor((m - 1) / 3) + 1}`;
  const r = await fetchText(`https://www.sec.gov/Archives/edgar/daily-index/${y}/${qtr}/form.${dateStr}.idx`, { headers: SEC_HEADERS });
  if (!r.ok) return { ok: false, status: r.status || 502, error: `form index ${dateStr} unavailable` };
  const entries = [];
  for (const line of r.text.split("\n")) {
    // Form-type column is fixed-ish width; match exactly type "4" (not 4/A, 424, S-4...).
    if (!/^4\s{2,}/.test(line)) continue;
    const m2 = line.match(/^4\s+(.+?)\s{2,}(\d+)\s+(\d{8})\s+(\S+)\s*$/);
    if (!m2) continue;
    entries.push({ company: m2[1].trim(), cik: Number(m2[2]), date: m2[3], path: m2[4] });
  }
  return { ok: true, status: 200, data: { date: dateStr, entries } };
}

// One Form 4 filing (full-submission .txt with embedded ownershipDocument XML) -> parsed
// transactions. path e.g. edgar/data/910638/0001628280-26-058429.txt
const FORM4_PATH_RE = /^edgar\/data\/\d+\/[\d-]+\.txt$/;
const tagVal = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>\\s*(?:<value>)?([^<]*)`));
  return m ? m[1].trim() : null;
};
export async function form4Filing(path) {
  if (!FORM4_PATH_RE.test(path)) return { ok: false, status: 400, error: "bad filing path" };
  const r = await fetchText(`https://www.sec.gov/Archives/${path}`, { headers: SEC_HEADERS });
  if (!r.ok) return { ok: false, status: r.status || 502, error: "filing fetch failed" };
  const xmlMatch = r.text.match(/<XML>([\s\S]*?)<\/XML>/);
  if (!xmlMatch) return { ok: true, status: 200, data: { symbol: null, transactions: [] } };
  const xml = xmlMatch[1];
  const symbol = tagVal(xml, "issuerTradingSymbol");
  const owner = tagVal(xml, "rptOwnerName");
  const isDirector = tagVal(xml, "isDirector") === "1" || tagVal(xml, "isDirector") === "true";
  const isOfficer = tagVal(xml, "isOfficer") === "1" || tagVal(xml, "isOfficer") === "true";
  const officerTitle = tagVal(xml, "officerTitle");
  const transactions = [];
  // Non-derivative transactions only — open-market activity lives here; derivative rows are
  // grants/options noise for the flow signal.
  const ndBlock = xml.match(/<nonDerivativeTable>([\s\S]*?)<\/nonDerivativeTable>/);
  for (const t of (ndBlock ? ndBlock[1] : "").split("</nonDerivativeTransaction>")) {
    if (!t.includes("<nonDerivativeTransaction>")) continue;
    const code = tagVal(t, "transactionCode");
    if (!code) continue;
    transactions.push({
      date: tagVal(t, "transactionDate"),
      code,
      shares: Number(tagVal(t, "transactionShares")) || null,
      price: Number(tagVal(t, "transactionPricePerShare")) || null,
      ad: tagVal(t, "transactionAcquiredDisposedCode"),
      sharesAfter: Number(tagVal(t, "sharesOwnedFollowingTransaction")) || null,
      owner, isDirector, isOfficer, officerTitle,
    });
  }
  return { ok: true, status: 200, data: { symbol, transactions } };
}
