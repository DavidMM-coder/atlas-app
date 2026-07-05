import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// A tiny dev-server proxy. The browser calls "/api/messages"; this forwards the
// request to Anthropic with your API key attached. The key lives only here on the
// server side (loaded from .env) and is never shipped to the browser.
function anthropicProxy(apiKey) {
  return {
    name: "anthropic-proxy",
    configureServer(server) {
      server.middlewares.use("/api/messages", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end("Method not allowed"); }
        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ error: { message: "ANTHROPIC_API_KEY is not set. Add it to a .env file (see .env.example) and restart `npm run dev`." } }));
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            // Mirror the production handler's shape validation so dev can't spend the key on an
            // arbitrary model / unbounded max_tokens even locally.
            let parsedBody;
            try { parsedBody = JSON.parse(body || "{}"); } catch { parsedBody = null; }
            if (!parsedBody || !ALLOWED_MODELS.has(parsedBody.model) || !Number.isFinite(parsedBody.max_tokens) || parsedBody.max_tokens < 1 || parsedBody.max_tokens > MAX_TOKENS_CAP) {
              res.statusCode = 400;
              res.setHeader("content-type", "application/json");
              return res.end(JSON.stringify({ error: { message: "Invalid model or max_tokens." } }));
            }
            const r = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body,
            });
            const text = await r.text();
            res.statusCode = r.status;
            res.setHeader("content-type", "application/json");
            res.end(text);
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: { message: "Proxy error: " + String(e) } }));
          }
        });
      });
    },
  };
}

const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// Same input allowlists the production api/* handlers enforce. The dev proxies used to
// interpolate range/interval straight into the upstream Yahoo URL, letting arbitrary query
// params be smuggled onto the request; mirror prod so dev behaves identically and can't be
// abused by anything that can reach the dev server.
const TICKER_RE = /^[A-Za-z0-9^=][A-Za-z0-9.\-^=]{0,14}$/;
const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
const INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"]);
const ALLOWED_MODELS = new Set(["claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"]);
const MAX_TOKENS_CAP = 32000;

async function getYahooCrumb() {
  const cookieResp = await fetch("https://fc.yahoo.com", { headers: YF_HEADERS, redirect: "follow" });
  const setCookie = cookieResp.headers.get("set-cookie") || "";
  const cookieStr = setCookie.split(/,(?=[^;]+=[^;]+)/).map(c => c.trim().split(";")[0]).join("; ");
  const crumbResp = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...YF_HEADERS, Cookie: cookieStr },
  });
  const crumb = (await crumbResp.text()).trim();
  return { crumb, cookieStr };
}

const SEC_HEADERS = { "User-Agent": "Atlas Investment Research App (contact: atlas-app@verdict-app.example)" };
let cikMapCache = null, cikMapFetchedAt = 0;
async function getCikMap() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (cikMapCache && Date.now() - cikMapFetchedAt < ONE_DAY) return cikMapCache;
  const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: SEC_HEADERS });
  if (!r.ok) return cikMapCache;
  const data = await r.json();
  const map = {};
  for (const entry of Object.values(data)) map[entry.ticker.toUpperCase()] = entry.cik_str;
  cikMapCache = map;
  cikMapFetchedAt = Date.now();
  return map;
}
// Mirrors api/fundamentals.js — stores {val, filed} so the backtester can gate signals on the
// date data actually became public, and so restatements/zero values dedupe correctly.
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
      if (!prev || String(e.filed || "") > String(prev.filed || "")) byEnd[e.end] = { val: e.val, filed: e.filed || null };
    }
  }
  return byEnd;
}
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
    const quarterlyFinancials = [...allDates].sort().map(date => ({
      date,
      totalRevenue: revByDate[date]?.val ?? null,
      netIncome: niByDate[date]?.val ?? null,
      eps: epsByDate[date]?.val ?? null,
      filed: [revByDate[date]?.filed, niByDate[date]?.filed, epsByDate[date]?.filed].filter(Boolean).sort().pop() || null,
    })).filter(q => q.totalRevenue != null || q.eps != null);
    return quarterlyFinancials.length ? quarterlyFinancials : null;
  } catch (_) {
    return null;
  }
}

function fundamentalsProxy() {
  return {
    name: "fundamentals-proxy",
    configureServer(server) {
      server.middlewares.use("/api/fundamentals", (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const ticker = url.searchParams.get("ticker");
        if (!ticker || !TICKER_RE.test(ticker)) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ error: "valid ticker required" }));
        }
        (async () => {
          const [{ crumb, cookieStr }, secQuarterlyFinancials] = await Promise.all([getYahooCrumb(), fetchSecQuarterlyFinancials(ticker)]);
          const modules = ["defaultKeyStatistics","financialData","incomeStatementHistoryQuarterly","earningsHistory","summaryDetail"].join(",");
          const yhUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(crumb)}`;
          const r = await fetch(yhUrl, { headers: { ...YF_HEADERS, Cookie: cookieStr } });
          const data = await r.json();
          const result = data?.quoteSummary?.result?.[0];
          if (!result) {
            res.statusCode = 404;
            res.setHeader("content-type", "application/json");
            return res.end(JSON.stringify({ error: data?.quoteSummary?.error?.description || JSON.stringify(data).slice(0, 200) }));
          }
          const qStmts = result.incomeStatementHistoryQuarterly?.incomeStatementHistory || [];
          const epsHistory = result.earningsHistory?.history || [];
          const earnings = epsHistory.map(e => ({ date: new Date(e.quarter.raw * 1000).toISOString().slice(0, 10), actual: e.epsActual?.raw ?? null, estimate: e.epsEstimate?.raw ?? null, surprisePct: e.surprisePercent?.raw != null ? e.surprisePercent.raw * 100 : null })).filter(e => e.actual !== null).sort((a, b) => a.date.localeCompare(b.date));
          let quarterlyFinancials;
          if (secQuarterlyFinancials) {
            quarterlyFinancials = secQuarterlyFinancials;
          } else {
            const earningsEpsByDate = Object.fromEntries(earnings.map(e => [e.date, e.actual]));
            quarterlyFinancials = qStmts.map(s => { const date = new Date(s.endDate.raw * 1000).toISOString().slice(0, 10); const eps = s.dilutedEPS?.raw ?? earningsEpsByDate[date] ?? null; return { date, totalRevenue: s.totalRevenue?.raw ?? null, netIncome: s.netIncome?.raw ?? null, eps, filed: null }; }).filter(s => s.totalRevenue != null).sort((a, b) => a.date.localeCompare(b.date));
          }
          let dividends = [];
          try {
            const divR = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1mo&range=10y&events=div&crumb=${encodeURIComponent(crumb)}`, { headers: { ...YF_HEADERS, Cookie: cookieStr } });
            const divData = await divR.json();
            const divEvents = divData?.chart?.result?.[0]?.events?.dividends || {};
            dividends = Object.values(divEvents).map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount })).sort((a, b) => a.date.localeCompare(b.date));
          } catch (_) {}
          const stats = result.defaultKeyStatistics || {};
          const financial = result.financialData || {};
          const summary = result.summaryDetail || {};
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ticker: ticker.toUpperCase(), trailingPE: summary.trailingPE?.raw ?? null, forwardPE: stats.forwardPE?.raw ?? null, pb: stats.priceToBook?.raw ?? null, dividendYield: summary.trailingAnnualDividendYield?.raw ?? null, revenueGrowth: financial.revenueGrowth?.raw ?? null, earningsGrowth: financial.earningsGrowth?.raw ?? null, quarterlyFinancials, earnings, dividends }));
        })().catch(e => { res.statusCode = 500; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: String(e) })); });
      });
    },
  };
}

function historyProxy() {
  return {
    name: "history-proxy",
    configureServer(server) {
      server.middlewares.use("/api/history", (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const ticker = url.searchParams.get("ticker");
        const range = url.searchParams.get("range") || "5y";
        const interval = url.searchParams.get("interval") || "1d";
        if (!ticker || !TICKER_RE.test(ticker) || !RANGES.has(range) || !INTERVALS.has(interval)) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ error: "valid ticker, range and interval required" }));
        }
        const yhUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
        fetch(yhUrl, { headers: { "User-Agent": "Mozilla/5.0" } })
          .then(r => r.json())
          .then(data => {
            const result = data?.chart?.result?.[0];
            if (!result) {
              res.statusCode = 404;
              res.setHeader("content-type", "application/json");
              return res.end(JSON.stringify({ error: "No data found for ticker" }));
            }
            const timestamps = result.timestamp;
            const q = result.indicators.quote[0];
            const prices = timestamps
              .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: q.close[i], high: q.high[i], low: q.low[i], volume: q.volume[i] }))
              .filter(p => p.close != null);
            const meta = result.meta;
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ticker: meta.symbol, currency: meta.currency, name: meta.longName || meta.shortName || meta.symbol, prices }));
          })
          .catch(e => {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Failed to fetch: " + String(e) }));
          });
      });
    },
  };
}

function newsProxy() {
  const dec = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const tg = (it, n) => { const m = it.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, "i")); return m ? dec(m[1]) : ""; };
  const parse = (xml) => (xml.match(/<item>[\s\S]*?<\/item>/gi) || []).map((it) => { const d = new Date(tg(it, "pubDate")); return { headline: tg(it, "title"), url: tg(it, "link"), source: "CNBC", date: isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10), dateMs: isNaN(d.getTime()) ? 0 : d.getTime(), summary: tg(it, "description").slice(0, 400) }; }).filter((x) => x.headline && /^https?:\/\//.test(x.url));
  const FEEDS = ["https://www.cnbc.com/id/10000664/device/rss/rss.html", "https://www.cnbc.com/id/20910258/device/rss/rss.html"];
  const yahooNews = async (q) => { try { const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=15&quotesCount=0`, { headers: { "User-Agent": "Mozilla/5.0" } }); if (!r.ok) return []; const d = await r.json(); return (d.news || []).map((n) => ({ headline: n.title, url: n.link, source: n.publisher || "Yahoo Finance", date: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10) : "", dateMs: n.providerPublishTime ? n.providerPublishTime * 1000 : 0, summary: "" })).filter((x) => x.headline && /^https?:\/\//.test(x.url)); } catch { return []; } };
  return {
    name: "news-proxy",
    configureServer(server) {
      server.middlewares.use("/api/news", (req, res) => {
        (async () => {
          const ticker = (new URL(req.url, "http://localhost").searchParams.get("ticker") || "").trim();
          if (ticker) {
            let items = await yahooNews(ticker);
            items.sort((a, b) => b.dateMs - a.dateMs);
            items = items.slice(0, 12).map(({ dateMs, ...rest }) => rest);
            res.statusCode = 200; res.setHeader("content-type", "application/json");
            return res.end(JSON.stringify({ items }));
          }
          const results = await Promise.all(FEEDS.map(async (u) => { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AtlasNews/1.0)" } }); return r.ok ? parse(await r.text()) : []; } catch { return []; } }));
          let items = results.flat();
          const seen = new Set();
          items = items.filter((x) => { const k = x.headline.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
          items.sort((a, b) => b.dateMs - a.dateMs);
          items = items.slice(0, 24).map(({ dateMs, ...rest }) => rest);
          res.statusCode = items.length ? 200 : 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(items.length ? { items } : { error: "No market news available right now." }));
        })().catch((e) => { res.statusCode = 500; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: String(e) })); });
      });
    },
  };
}

function fxProxy() {
  return {
    name: "fx-proxy",
    configureServer(server) {
      server.middlewares.use("/api/fx", (req, res) => {
        fetch("https://api.frankfurter.app/latest?from=USD")
          .then(r => r.json())
          .then(data => {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            if (!data?.rates) { res.statusCode = 502; return res.end(JSON.stringify({ error: "No rates returned" })); }
            res.end(JSON.stringify({ base: data.base || "USD", date: data.date, rates: data.rates }));
          })
          .catch(e => {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Failed to fetch FX rates: " + String(e) }));
          });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  return {
    plugins: [react(), anthropicProxy(apiKey), historyProxy(), fundamentalsProxy(), fxProxy(), newsProxy()],
    server: { port: Number(process.env.PORT) || 5173, host: true },
    build: {
      rollupOptions: {
        output: {
          // Split the heavyweight vendors into their own long-cacheable chunks so an app-code
          // change doesn't force users to re-download Firebase/Framer/React, and the entry
          // chunk stays small. xlsx is already lazy-loaded and chunks itself.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("firebase") || id.includes("@firebase")) return "firebase";
            if (id.includes("framer-motion")) return "motion";
            if (id.includes("react")) return "react";
            return undefined;
          },
        },
      },
    },
  };
});
