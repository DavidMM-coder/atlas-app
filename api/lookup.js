// Yahoo symbol-search proxy for the spreadsheet import's ticker-resolution fallback chain —
// handles renames, fresh listings and company-name matches that static or model knowledge
// misses (real case: STLN, The Oncology Institute's post-re-ticker symbol — the import's AI
// verify pass nulled it while Yahoo resolved it fine). Signed-in users only, same auth +
// rate-limit pattern as the other market-data routes; results are public data.
import { requireUser } from "./_lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 120/min: the worst legitimate burst is a big imported sheet (~80 unique identifiers, the
  // import's own cap) with a name-search retry on some of them — comfortable headroom above
  // that, far below abuse-loop scale.
  const uid = await requireUser(req, res, { limit: 120 });
  if (!uid) return;

  const q = String(req.query?.q || "").trim().slice(0, 60);
  if (!q) return res.status(400).json({ error: "q required" });

  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!r.ok) return res.status(502).json({ error: `Symbol search returned ${r.status}` });
    const d = await r.json();
    const quotes = (d.quotes || [])
      .filter((x) => x.symbol && (x.quoteType === "EQUITY" || x.quoteType === "ETF"))
      .slice(0, 6)
      .map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname || "", exch: x.exchDisp || "", type: x.quoteType }));
    // Symbol metadata is stable — an hour of shared CDN cache absorbs repeated imports.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ quotes });
  } catch (e) {
    return res.status(500).json({ error: "Symbol search failed: " + String(e) });
  }
}
