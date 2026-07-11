import React, { useState, useEffect } from "react";
import { auth, loadPickHistory } from "./firebase.js";
import { apiUrl } from "./lib/api.js";
import { color as c, font, type, radius } from "./ui/tokens.js";
import { Card, Overline, LoadingBlock } from "./ui/primitives.jsx";

// ── Atlas track record ──────────────────────────────────────────────────────────
// Read-only scoreboard over the append-only Discover pick log (users/{uid}/pick_history,
// localStorage copy as the signed-out fallback). Each pick's return since it was made is
// compared against the S&P 500 (SPY) over the SAME holding period — beating the market is
// the bar; a pick that rose in a rising market proves nothing. Same honesty rules as the
// Backtester's verdict: picks younger than MIN_TRADING_DAYS aren't scored at all, and a
// hit rate isn't presented as meaningful until MIN_TRACK_RECORD picks have been scored.
const BENCH_TICKER = "SPY";
const MIN_TRADING_DAYS = 3;   // younger picks show as "too recent to evaluate"
const MIN_TRACK_RECORD = 15;  // scored picks needed before the hit rate is shown with confidence

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Smallest Yahoo range that still covers the oldest pick (with margin), so the benchmark
// series contains a close at-or-before every pick date.
function rangeCovering(oldestMs) {
  const days = (Date.now() - oldestMs) / 86400000;
  if (days < 20) return "1mo";
  if (days < 75) return "3mo";
  if (days < 160) return "6mo";
  if (days < 330) return "1y";
  if (days < 680) return "2y";
  if (days < 1750) return "5y";
  return "10y";
}

function fmtPct(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`; }

export default function TrackRecord() {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const uid = auth?.currentUser?.uid;
        let records = uid ? await loadPickHistory(uid) : null;
        // Fallback to this device's local copy when the cloud has nothing to show — signed out,
        // Firebase unconfigured, read failed (null), or an EMPTY subcollection ([]). The empty
        // case matters: [] is truthy, so `!records` alone hid local picks (logged while signed
        // out) from signed-in users whose cloud log hadn't been seeded yet.
        if (!records?.length) {
          try { const v = localStorage.getItem("atlas_pick_history"); records = v ? JSON.parse(v) : []; } catch { records = []; }
        }
        records = (Array.isArray(records) ? records : [])
          .filter(r => r && r.ticker && r.at)
          .sort((a, b) => String(b.at).localeCompare(String(a.at)));   // newest first
        if (!records.length) { if (!cancelled) setState({ status: "empty" }); return; }

        // One quote fetch per unique ticker + one benchmark fetch — never one per record.
        const oldestMs = Math.min(...records.map(r => new Date(r.at).getTime()));
        const range = rangeCovering(oldestMs);
        const uniq = [...new Set(records.map(r => r.ticker))];
        const [bench, ...quotes] = await Promise.all([
          fetchJson(apiUrl(`/api/history?ticker=${encodeURIComponent(BENCH_TICKER)}&range=${range}&interval=1d`)),
          ...uniq.map(t => fetchJson(apiUrl(`/api/history?ticker=${encodeURIComponent(t)}&range=5d&interval=1d`)).catch(() => null)),
        ]);
        const benchPrices = bench?.prices || [];
        if (!benchPrices.length) throw new Error("Benchmark data unavailable — try again later.");
        const benchLast = benchPrices[benchPrices.length - 1].close;
        const quoteByTicker = {};
        uniq.forEach((t, i) => {
          const p = quotes[i]?.prices;
          quoteByTicker[t] = p?.length ? { close: p[p.length - 1].close, currency: quotes[i].currency || null } : null;
        });

        const rows = records.map(r => {
          const pickDate = String(r.at).slice(0, 10);
          // Last benchmark close at-or-before the pick date; the count of closes after it is the
          // pick's age in TRADING days (weekends/holidays don't count toward evaluability).
          let bi = -1;
          for (let i = benchPrices.length - 1; i >= 0; i--) { if (benchPrices[i].date <= pickDate) { bi = i; break; } }
          const tradingDays = bi >= 0 ? benchPrices.length - 1 - bi : null;
          const quote = quoteByTicker[r.ticker];
          if (r.price == null || quote == null || tradingDays == null) return { ...r, pickDate, rowStatus: "nodata", tradingDays };
          // Return is computed in the pick's own stored currency — never cross-converted. If the
          // quote now comes back in a different currency than was stored, the two prices aren't
          // comparable units, so refuse to score rather than show a garbage number.
          if (r.currency && quote.currency && r.currency !== quote.currency) return { ...r, pickDate, rowStatus: "nodata", tradingDays };
          if (tradingDays < MIN_TRADING_DAYS) return { ...r, pickDate, rowStatus: "recent", tradingDays };
          const ret = ((quote.close - r.price) / r.price) * 100;
          const benchRet = ((benchLast - benchPrices[bi].close) / benchPrices[bi].close) * 100;
          return { ...r, pickDate, rowStatus: "evaluated", tradingDays, ret, benchRet, excess: ret - benchRet, beat: ret > benchRet };
        });

        const scored = rows.filter(r => r.rowStatus === "evaluated");
        const summary = {
          total: rows.length,
          scored: scored.length,
          recent: rows.filter(r => r.rowStatus === "recent").length,
          nodata: rows.filter(r => r.rowStatus === "nodata").length,
          wins: scored.filter(r => r.beat).length,
          hitRate: scored.length ? (scored.filter(r => r.beat).length / scored.length) * 100 : null,
          avgExcess: scored.length ? scored.reduce((s, r) => s + r.excess, 0) / scored.length : null,
        };
        if (!cancelled) setState({ status: "ready", rows, summary });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: e?.message || "Couldn't load the track record." });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { status, rows, summary } = state;
  const thin = status === "ready" && summary.scored < MIN_TRACK_RECORD;

  return (
    <Card pad={18} style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <Overline color={c.accent}>Atlas track record</Overline>
        <span style={{ ...type.caption, color: c.text3 }}>every pick vs {BENCH_TICKER} over its own holding period</span>
      </div>
      <p style={{ ...type.caption, color: c.text3, margin: "0 0 12px", lineHeight: 1.6 }}>
        Every Discover pick is logged with its price the moment it's recommended, then scored against the S&P 500 over the same window — beating the market is the bar, since a pick that merely rose in a rising market proves nothing. Picks need {MIN_TRADING_DAYS}+ trading days before they're scored at all.
      </p>

      {status === "loading" && <LoadingBlock title="Scoring past picks…" />}
      {status === "empty" && (
        <p style={{ ...type.small, color: c.text3, margin: 0 }}>No picks logged yet — run a Discover scan and Atlas starts keeping score on itself here.</p>
      )}
      {status === "error" && <p style={{ ...type.small, color: c.negative, margin: 0 }}>{state.message}</p>}

      {status === "ready" && (
        <>
          {/* Same principle as the Backtester's min-trade gate: a tiny sample must never look confident. */}
          {thin ? (
            <div style={{ background: c.warningSoft, border: "1px solid rgba(251,184,69,0.32)", borderRadius: radius.sm, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ ...type.bodyStrong, color: c.warning, marginBottom: 2 }}>
                Not enough track record yet — {summary.scored} evaluable pick{summary.scored === 1 ? "" : "s"} of {summary.total} logged. Check back in a few weeks.
              </div>
              <div style={{ ...type.caption, color: c.text3 }}>
                A hit rate needs {MIN_TRACK_RECORD}+ scored picks before it means anything.
                {summary.recent > 0 && ` ${summary.recent} pick${summary.recent === 1 ? " is" : "s are"} still too recent to evaluate.`}
                {summary.nodata > 0 && ` ${summary.nodata} couldn't be scored (missing or incomparable price data).`}
              </div>
              {summary.scored > 0 && (
                <div style={{ ...type.small, color: c.text3, marginTop: 8, opacity: 0.55 }}>
                  So far: {summary.wins}/{summary.scored} beat {BENCH_TICKER} · average excess {fmtPct(summary.avgExcess)} — greyed out because this is noise, not a record.
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: summary.avgExcess >= 0 ? c.positiveSoft : c.negativeSoft, border: `1px solid ${c.hairline}`, borderRadius: radius.sm, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ ...type.bodyStrong, color: c.text, marginBottom: 2 }}>
                {summary.wins} of {summary.scored} scored picks beat {BENCH_TICKER} over their holding period ({summary.hitRate.toFixed(0)}%) · average excess return {fmtPct(summary.avgExcess)}.
              </div>
              <div style={{ ...type.caption, color: c.text3 }}>
                {summary.recent > 0 ? `${summary.recent} more pick${summary.recent === 1 ? "" : "s"} too recent to score yet. ` : ""}Past picks aren't a promise about future ones — this exists so Atlas can't quietly forget its misses.
              </div>
            </div>
          )}

          <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "76px 92px 110px 86px 96px 86px 1fr", gap: 8, padding: "6px 0", borderBottom: `1px solid ${c.hairline}`, minWidth: 640 }}>
              {["Ticker", "Picked", "Entry price", "Return", `${BENCH_TICKER} same period`, "Δ excess", ""].map((h, i) => <span key={i} style={{ ...type.overline, color: c.text3 }}>{h}</span>)}
            </div>
            {rows.map((r, i) => (
              <div key={r.id || i} style={{ display: "grid", gridTemplateColumns: "76px 92px 110px 86px 96px 86px 1fr", gap: 8, padding: "7px 0", borderBottom: `1px solid ${c.hairline}`, minWidth: 640, alignItems: "center" }}>
                <span style={{ fontFamily: font.mono, fontWeight: 700, fontSize: 12, color: c.accent }}>{r.ticker}</span>
                <span style={{ fontFamily: font.mono, fontSize: 12, color: c.text3 }}>{r.pickDate}</span>
                <span style={{ fontFamily: font.mono, fontSize: 12, color: c.text2 }}>{r.price != null ? `${r.price.toFixed(2)} ${r.currency || ""}` : "—"}</span>
                {r.rowStatus === "evaluated" ? (
                  <>
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: r.ret >= 0 ? c.positive : c.negative }}>{fmtPct(r.ret)}</span>
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: c.text2 }}>{fmtPct(r.benchRet)}</span>
                    <span style={{ fontFamily: font.mono, fontSize: 12, fontWeight: 600, color: r.beat ? c.positive : c.negative }}>{fmtPct(r.excess)}</span>
                    <span style={{ ...type.caption, color: c.text3 }}>{r.tradingDays} trading day{r.tradingDays === 1 ? "" : "s"}</span>
                  </>
                ) : r.rowStatus === "recent" ? (
                  <span style={{ gridColumn: "4 / -1", ...type.caption, color: c.warning }}>
                    Too recent to evaluate — picked {r.tradingDays} trading day{r.tradingDays === 1 ? "" : "s"} ago (needs {MIN_TRADING_DAYS}+)
                  </span>
                ) : (
                  <span style={{ gridColumn: "4 / -1", ...type.caption, color: c.text3 }}>
                    Can't score — missing or incomparable price data
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
