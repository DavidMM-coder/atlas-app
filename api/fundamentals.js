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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: "ticker required" });

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
    const r = await fetch(url, { headers: { ...YF_HEADERS, Cookie: cookieStr } });

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

    const earningsEpsByDate = Object.fromEntries(earnings.map(e => [e.date, e.actual]));
    const quarterlyFinancials = qStmts
      .map(s => {
        const date = new Date(s.endDate.raw * 1000).toISOString().slice(0, 10);
        const eps = s.dilutedEPS?.raw ?? earningsEpsByDate[date] ?? null;
        return { date, totalRevenue: s.totalRevenue?.raw ?? null, netIncome: s.netIncome?.raw ?? null, eps };
      })
      .filter(s => s.totalRevenue != null)
      .sort((a, b) => a.date.localeCompare(b.date));

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

    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      trailingPE: stats.trailingPE?.raw ?? null,
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
