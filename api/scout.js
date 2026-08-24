// Scout data-layer proxy — universe enumeration, Finnhub metrics (key server-side only),
// and the EDGAR Form 4 pipeline. Same auth + per-user rate-limit pattern as the other
// market-data routes; every upstream is public market data. The heavy lifting lives in
// _lib/scout-sources.js, shared verbatim with the vite dev middleware.
import { requireUser } from "./_lib/auth.js";
import { usSymbols, usMetric, euVenue, lseXlsx, form4Index, form4Filing } from "./_lib/scout-sources.js";

const TICKER_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]{0,14}$/;
const DATE_RE = /^\d{8}$/;
const VENUES = new Set(["euronext", "xetra", "nordic"]);
const FILING_RE = /^edgar\/data\/\d+\/[\d-]+\.txt$/;

// Per-action CDN cache: instrument lists move daily at most; metrics hourly is plenty for a
// weekly-sharded refresh; past-day form indexes are immutable.
const CACHE = {
  "us-symbols": "s-maxage=86400, stale-while-revalidate=604800",
  "eu": "s-maxage=86400, stale-while-revalidate=604800",
  "lse": "s-maxage=86400, stale-while-revalidate=604800",
  "metric": "s-maxage=3600, stale-while-revalidate=86400",
  "form4-index": "s-maxage=21600, stale-while-revalidate=86400",
  "form4": "s-maxage=604800, stale-while-revalidate=2592000",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 120/min: the client-side batch runner self-paces at ~1 req/1.2s (≈50/min) — headroom for
  // a manual run alongside, far below abuse scale. Finnhub free is 60/min, so the limiter
  // also protects the upstream quota from a second device double-running the batch.
  const uid = await requireUser(req, res, { limit: 120 });
  if (!uid) return;

  const action = String(req.query.action || "");
  try {
    let out;
    if (action === "us-symbols") {
      out = await usSymbols();
    } else if (action === "metric") {
      const ticker = String(req.query.ticker || "");
      if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "valid ticker required" });
      out = await usMetric(ticker);
    } else if (action === "eu") {
      const venue = String(req.query.venue || "");
      if (!VENUES.has(venue)) return res.status(400).json({ error: "valid venue required" });
      out = await euVenue(venue);
    } else if (action === "lse") {
      out = await lseXlsx(Number(req.query.hint) || undefined);
    } else if (action === "form4-index") {
      const date = String(req.query.date || "");
      if (!DATE_RE.test(date)) return res.status(400).json({ error: "date=YYYYMMDD required" });
      out = await form4Index(date);
    } else if (action === "form4") {
      const path = String(req.query.path || "");
      if (!FILING_RE.test(path)) return res.status(400).json({ error: "valid filing path required" });
      out = await form4Filing(path);
    } else {
      return res.status(400).json({ error: "unknown action" });
    }

    if (!out.ok) {
      // Refusal statuses (429/403/999) pass through verbatim — the client breaker needs them.
      return res.status(out.status >= 400 && out.status < 600 ? out.status : 502).json({ error: out.error || "upstream failed" });
    }
    if (CACHE[action]) res.setHeader("Cache-Control", CACHE[action]);
    return res.status(200).json(out.data);
  } catch (e) {
    return res.status(500).json({ error: "scout action failed: " + String(e).replace(/token=[^&\s"']+/g, "token=***") });
  }
}
