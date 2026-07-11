// Market-news feed: real headlines + real article links from CNBC's markets/economy RSS, with a
// Yahoo Finance news-search fallback. Public data only (no secrets), so open CORS + a short CDN
// cache is fine. This replaces the old approach of asking the AI to web-search for news, which
// shared ONE upstream web-search rate limit with every other AI feature and frequently failed —
// now the AI only adds analysis on top of these headlines, with no web search involved.

import { requireUser } from "./_lib/auth.js";

const FEEDS = [
  { url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", source: "CNBC" }, // Markets
  { url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", source: "CNBC" }, // Economy
];

function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tag(item, name) {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}
function parseRss(xml, source) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.map((it) => {
    const pub = tag(it, "pubDate");
    const d = new Date(pub);
    return {
      headline: tag(it, "title"),
      url: tag(it, "link"),
      source,
      date: isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10),
      dateMs: isNaN(d.getTime()) ? 0 : d.getTime(),
      summary: tag(it, "description").slice(0, 400),
    };
  }).filter((x) => x.headline && /^https?:\/\//.test(x.url));
}

const TICKER_RE = /^[A-Za-z0-9^=.\-]{1,15}$/;
// Yahoo's JSON news-search — used both as the general-market fallback (q=SPY) and, with an explicit
// query, for ticker-specific news that feeds the research dossier.
async function fetchYahooNews(query) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=15&quotesCount=0`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.news || []).map((n) => ({
      headline: n.title,
      url: n.link,
      source: n.publisher || "Yahoo Finance",
      date: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10) : "",
      dateMs: n.providerPublishTime ? n.providerPublishTime * 1000 : 0,
      summary: "",
    })).filter((x) => x.headline && /^https?:\/\//.test(x.url));
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 50/min: legit peak is one market-news load plus manual refreshes and one ticker-news
  // fetch per dossier (~10/min worst case) — 5x headroom.
  const uid = await requireUser(req, res, { limit: 50 });
  if (!uid) return;

  // Ticker mode: news for one stock (research dossier). Falls through to the general feed otherwise.
  const ticker = String(req.query?.ticker || "").trim();
  if (ticker) {
    if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "invalid ticker" });
    let items = await fetchYahooNews(ticker);
    items.sort((a, b) => b.dateMs - a.dateMs);
    items = items.slice(0, 12).map(({ dateMs, ...rest }) => rest);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    return res.status(200).json({ items });
  }

  try {
    const results = await Promise.all(FEEDS.map(async (f) => {
      try {
        const r = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AtlasNews/1.0)" } });
        if (!r.ok) return [];
        return parseRss(await r.text(), f.source);
      } catch {
        return [];
      }
    }));
    let items = results.flat();
    if (!items.length) items = await fetchYahooNews("SPY");

    // Dedupe by headline (case-insensitive), newest first, cap the payload.
    const seen = new Set();
    items = items.filter((x) => {
      const k = x.headline.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    items.sort((a, b) => b.dateMs - a.dateMs);
    items = items.slice(0, 24).map(({ dateMs, ...rest }) => rest);

    if (!items.length) return res.status(502).json({ error: "No market news available right now." });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch market news: " + String(e) });
  }
}
