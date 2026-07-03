// Yahoo Finance price-history proxy. Serves public market data only (no secrets), so open
// CORS is fine — but inputs are still validated/encoded so nothing user-controlled can be
// smuggled into the upstream URL, and responses are CDN-cached briefly so a portfolio
// refreshing every 45s doesn't hammer Yahoo with identical requests.

const TICKER_RE = /^[A-Za-z0-9^=][A-Za-z0-9.\-^=]{0,14}$/;
const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
const INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { ticker, range = "5y", interval = "1d" } = req.query;
  if (!ticker || !TICKER_RE.test(String(ticker))) return res.status(400).json({ error: "valid ticker required" });
  if (!RANGES.has(String(range))) return res.status(400).json({ error: "invalid range" });
  if (!INTERVALS.has(String(interval))) return res.status(400).json({ error: "invalid interval" });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!r.ok) return res.status(502).json({ error: `Market data source returned ${r.status} — try again shortly.` });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "No data found for ticker" });

    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const meta = result.meta || {};

    const prices = timestamps
      .map((t, i) => ({
        date: new Date(t * 1000).toISOString().slice(0, 10),
        close: q.close?.[i],
        high: q.high?.[i],
        low: q.low?.[i],
        volume: q.volume?.[i],
      }))
      .filter((p) => p.close != null);

    // Short shared cache: identical requests (same ticker/range) within 30s are served from
    // the CDN instead of re-fetching Yahoo — live enough for the 45s portfolio refresh loop.
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({
      ticker: meta.symbol,
      currency: meta.currency,
      name: meta.longName || meta.shortName || meta.symbol,
      prices,
    });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch price history: " + String(e) });
  }
}
