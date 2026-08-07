// Yahoo Finance price-history proxy. Serves public market data only (no secrets), so open
// CORS is fine — but callers must be signed-in Atlas users (anyone who found the URL used to
// be able to run up Vercel usage and risk Yahoo blocking our egress IP), inputs are still
// validated/encoded so nothing user-controlled can be smuggled into the upstream URL, and
// responses are CDN-cached briefly so a portfolio refreshing every 45s doesn't hammer Yahoo
// with identical requests.
import { requireUser } from "./_lib/auth.js";

const TICKER_RE = /^[A-Za-z0-9^=][A-Za-z0-9.\-^=]{0,14}$/;
const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
const INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"]);

// meta.tradingPeriods.regular arrives variously as {start,end}, [{...}] or [[{...}]] depending
// on range — unwrap defensively rather than trusting one shape.
function regularWindow(meta) {
  let reg = meta?.tradingPeriods?.regular ?? meta?.tradingPeriods;
  while (Array.isArray(reg)) reg = reg[0];
  if (reg && Number.isFinite(reg.start) && Number.isFinite(reg.end)) return { start: reg.start, end: reg.end };
  // Fallback: bracket the regular session around meta.regularMarketTime (its close stamp).
  const t = meta?.regularMarketTime;
  return Number.isFinite(t) ? { start: t - 6.5 * 3600, end: t } : null;
}

// Latest real print from an includePrePost intraday series, plus which session produced it.
// The extended price is reported ONLY when the last print falls outside regular hours — a
// normal stock with no after-hours activity yields extPrice/extSession null, so the UI shows
// no "after hours" tag when there's nothing to show.
function extendedQuote(result) {
  const meta = result.meta || {};
  const ts = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const pts = ts.map((t, i) => [t, closes[i]]).filter(([, c]) => c != null);
  const win = regularWindow(meta);
  const regularLast = win ? pts.filter(([t]) => t >= win.start && t < win.end).pop() : null;
  const regularPrice = meta.regularMarketPrice ?? regularLast?.[1] ?? null;
  const last = pts[pts.length - 1] || null;
  if (!last) return { price: regularPrice, regularPrice, extPrice: null, extSession: null, extTime: null };
  const [lastT, lastP] = last;
  let extSession = null;
  if (win && lastT >= win.end) extSession = "post";
  else if (win && lastT < win.start) extSession = "pre";
  // Ignore a negligible extended-session difference (rounding / a single stale print) so the
  // tag means something moved, not that a field merely exists.
  const moved = regularPrice != null && Math.abs(lastP - regularPrice) / regularPrice > 0.0005;
  if (extSession && moved) return { price: lastP, regularPrice, extPrice: lastP, extSession, extTime: lastT };
  return { price: regularPrice ?? lastP, regularPrice, extPrice: null, extSession: null, extTime: null };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Authorization isn't on the CORS safelist, so the native shells' (capacitor/tauri)
  // cross-origin GETs now preflight — the header must be explicitly allowed.
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 600/min: the busiest legitimate minute stacks a track-record load (1 benchmark + one call
  // per unique picked ticker, ~60 for a mature log) on the 45s portfolio poll (one call per
  // holding) and a portfolio review burst — ~150 calls. 4x headroom on top of that.
  const uid = await requireUser(req, res, { limit: 600 });
  if (!uid) return;

  const { ticker, range = "5y", interval = "1d" } = req.query;
  if (!ticker || !TICKER_RE.test(String(ticker))) return res.status(400).json({ error: "valid ticker required" });
  if (!RANGES.has(String(range))) return res.status(400).json({ error: "invalid range" });
  if (!INTERVALS.has(String(interval))) return res.status(400).json({ error: "invalid interval" });

  // Opt-in extended-session mode for the portfolio's LIVE price. Daily candles are
  // regular-session only by construction, so a stock that moved after the close (earnings at
  // 4pm ET) showed yesterday's close as "live". In this mode we ask for a 1-minute series
  // WITH pre/post trades and classify the last trade against meta.tradingPeriods.regular, so
  // the caller gets the real latest print plus which session it came from. Only callers that
  // pass prepost=1 are affected — history/backtest/track-record paths keep daily candles
  // exactly as before. NOTE: Yahoo's convenient meta fields (postMarketPrice, preMarketPrice,
  // marketState) come back NULL on this endpoint, which is why the price is derived from the
  // series + trading periods rather than read directly.
  const wantPrePost = String(req.query.prepost || "") === "1";

  try {
    const url = wantPrePost
      ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`
      : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!r.ok) return res.status(502).json({ error: `Market data source returned ${r.status} — try again shortly.` });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "No data found for ticker" });

    if (wantPrePost) {
      const ext = extendedQuote(result);
      // Markets closed all day (weekend/holiday) → no intraday series at all. Fall back to the
      // daily call so the portfolio still shows the last regular close instead of blanking.
      if (ext.price == null) {
        const fb = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (fb.ok) {
          const fbResult = (await fb.json())?.chart?.result?.[0];
          const closes = (fbResult?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
          const last = closes[closes.length - 1];
          if (last != null) {
            const m = fbResult.meta || {};
            res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
            return res.status(200).json({ ticker: m.symbol, currency: m.currency, name: m.longName || m.shortName || m.symbol, price: last, regularPrice: last, extPrice: null, extSession: null, prices: [] });
          }
        }
        return res.status(404).json({ error: "No data found for ticker" });
      }
      const meta = result.meta || {};
      res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
      return res.status(200).json({
        ticker: meta.symbol,
        currency: meta.currency,
        name: meta.longName || meta.shortName || meta.symbol,
        price: ext.price,                 // the latest real print, extended session included
        regularPrice: ext.regularPrice,   // the regular-session close/last, for reference
        extPrice: ext.extPrice,           // set only when the latest print is outside RTH
        extSession: ext.extSession,       // "pre" | "post" | null
        extTime: ext.extTime,
        prices: [],                       // series intentionally omitted — this mode is a quote
      });
    }

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
