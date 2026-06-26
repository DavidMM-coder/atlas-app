export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { ticker, range = "5y", interval = "1d" } = req.query;
  if (!ticker) return res.status(400).json({ error: "ticker required" });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "No data found for ticker" });

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const highs = result.indicators.quote[0].high;
    const lows = result.indicators.quote[0].low;
    const volumes = result.indicators.quote[0].volume;
    const meta = result.meta;

    // Filter out null closes
    const prices = timestamps
      .map((t, i) => ({
        date: new Date(t * 1000).toISOString().slice(0, 10),
        close: closes[i],
        high: highs[i],
        low: lows[i],
        volume: volumes[i],
      }))
      .filter(p => p.close != null);

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
