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

function fundamentalsProxy() {
  return {
    name: "fundamentals-proxy",
    configureServer(server) {
      server.middlewares.use("/api/fundamentals", (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const ticker = url.searchParams.get("ticker");
        if (!ticker) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ error: "ticker required" }));
        }
        (async () => {
          const { crumb, cookieStr } = await getYahooCrumb();
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
          const earningsEpsByDate = Object.fromEntries(earnings.map(e => [e.date, e.actual]));
          const quarterlyFinancials = qStmts.map(s => { const date = new Date(s.endDate.raw * 1000).toISOString().slice(0, 10); const eps = s.dilutedEPS?.raw ?? earningsEpsByDate[date] ?? null; return { date, totalRevenue: s.totalRevenue?.raw ?? null, netIncome: s.netIncome?.raw ?? null, eps }; }).filter(s => s.totalRevenue != null).sort((a, b) => a.date.localeCompare(b.date));
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
          res.end(JSON.stringify({ ticker: ticker.toUpperCase(), trailingPE: stats.trailingPE?.raw ?? null, forwardPE: stats.forwardPE?.raw ?? null, pb: stats.priceToBook?.raw ?? null, dividendYield: summary.trailingAnnualDividendYield?.raw ?? null, revenueGrowth: financial.revenueGrowth?.raw ?? null, earningsGrowth: financial.earningsGrowth?.raw ?? null, quarterlyFinancials, earnings, dividends }));
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
        if (!ticker) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ error: "ticker required" }));
        }
        const yhUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  return {
    plugins: [react(), anthropicProxy(apiKey), historyProxy(), fundamentalsProxy()],
    server: { port: 5173, host: true },
  };
});
