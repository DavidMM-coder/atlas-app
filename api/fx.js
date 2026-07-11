import { requireUser } from "./_lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 30/min: legit peak is one fetch on boot plus up to 5 backoff retries and a 6-hourly
  // refresh (~6/min worst case) — 5x headroom.
  const uid = await requireUser(req, res, { limit: 30 });
  if (!uid) return;

  try {
    const url = "https://api.frankfurter.app/latest?from=USD";
    const r = await fetch(url);
    const data = await r.json();
    if (!data?.rates) return res.status(502).json({ error: "No rates returned" });
    // Frankfurter updates daily on ECB business days — an hour of CDN cache is plenty fresh.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ base: data.base || "USD", date: data.date, rates: data.rates });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch FX rates: " + String(e) });
  }
}
