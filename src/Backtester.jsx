import React, { useState, useEffect } from "react";
import { color as c, font, type, radius, shadow } from "./ui/tokens.js";
import {
  Card, Button, Input, Field, Overline, SegmentedControl, Tabs, Badge,
  InfoTip, ErrorBanner, LoadingBlock, EmptyState, motion,
} from "./ui/primitives.jsx";
import { sma, rsiCalc, calcStats, runBuyAndHold, runDCA, calcDCAStats, bootstrapCagrDiffCI, bootstrapDcaCagrDiffCI } from "./lib/marketStats.js";
import { apiUrl } from "./lib/api.js";

// Below this many trades, a strategy-vs-benchmark gap is dominated by a handful of entry/exit
// rolls of the dice, so the verdict is presented as "not enough data" and the stats are
// visually de-emphasized instead of shown with full confidence. DCA is exempt: its "trades"
// are deterministic monthly contributions, not signal-driven bets, so trade count doesn't
// measure sample size there.
const MIN_TRADES = 10;

// The bootstrap CI is computed on the (strategy − benchmark) gap; headlines phrase the gap in
// whichever direction won ("X beat Y by …"), so flip the interval to match that direction.
function ciInHeadlineDirection(ci, beats) {
  const lo = beats ? ci.lo : -ci.hi;
  const hi = beats ? ci.hi : -ci.lo;
  return `90% CI: ${lo.toFixed(2)}% to ${hi.toFixed(2)}%`;
}

const GLOSSARY = {
  "CAGR": "Compound Annual Growth Rate. The smoothed yearly return if your investment grew at a steady pace. $10,000 becoming $16,000 in 5 years = 9.9% CAGR.",
  "Total Return": "How much your investment grew overall. The most honest single number — but doesn't account for how long it took.",
  "Max Drawdown": "The biggest drop from a peak before recovering. If your portfolio hit $15k then fell to $9k, that's a 40% drawdown. Shows the worst pain you'd have felt holding this strategy.",
  "Sharpe Ratio": "Return per unit of risk. Above 1.0 is decent, above 2.0 is excellent. A high Sharpe means you're getting good returns without wild swings.",
  "Volatility": "How wildly the portfolio value swings day to day. High = bigger ups and downs. Low = steadier ride. Annualised as a percentage.",
};
function BtTip({ term }) {
  const def = GLOSSARY[term];
  if (!def) return <>{term}</>;
  return <InfoTip title={term} body={def}><span>{term}</span></InfoTip>;
}

// ── Currency display ────────────────────────────────────────────────────────────
const CCY_SYMBOL = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", CHF: "CHF ", CAD: "C$", AUD: "A$", NZD: "NZ$", HKD: "HK$", SGD: "S$", INR: "₹", KRW: "₩", TWD: "NT$", BRL: "R$", ZAR: "R", SEK: "kr ", NOK: "kr ", DKK: "kr ", MXN: "MX$", PLN: "zł " };
// Yahoo quotes some markets in a minor unit (GBp/GBX = pence). Normalize the whole price series
// to the major unit up front so cash, equity and trade prices are all in one coherent unit — and
// so a London ticker's results aren't rendered as pence prefixed with "$".
function normalizePriceData(data) {
  const raw = String(data.currency || "USD");
  if (/^gb[px]$/i.test(raw)) {
    return { ...data, currency: "GBP", prices: (data.prices || []).map(p => ({ ...p, close: p.close / 100, high: p.high != null ? p.high / 100 : p.high, low: p.low != null ? p.low / 100 : p.low })) };
  }
  return data;
}
function ccySymbol(code) { return CCY_SYMBOL[String(code || "USD").toUpperCase()] || ""; }
function fmtMoney(v, code, digits = 2) {
  const sym = ccySymbol(code);
  const body = Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return sym ? `${sym}${body}` : `${body} ${String(code || "USD").toUpperCase()}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysBetween(dateA, dateB) {
  return Math.round((new Date(dateB) - new Date(dateA)) / 86400000);
}
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
// The date a quarter's numbers were actually PUBLIC — the SEC filing date when we have it,
// else period end + a conservative lag. Trading on the fiscal period-END date is look-ahead
// bias: a quarter ending Mar 31 typically isn't filed until ~May, so a backtest that "bought"
// on Apr 2 used information nobody had, systematically inflating every fundamental strategy.
const FILING_LAG_DAYS = 45;   // 10-Q statutory deadline ballpark for unknown filing dates
const EARNINGS_LAG_DAYS = 40; // typical announce lag after quarter end (Yahoo gives no report date)
function quarterKnownDate(q) { return q.filed || addDays(q.date, FILING_LAG_DAYS); }
// ── Backtesting engines ───────────────────────────────────────────────────────
function runTechnicalStrategy(prices, strategy, params, cash, costPct) {
  const closes = prices.map(p => p.close);
  const equity = [{ date: prices[0].date, value: cash }];
  let position = 0, cashHeld = cash;
  const trades = [];
  const signals = Array(closes.length).fill(0);

  if (strategy === "sma_crossover") {
    const fastSMA = sma(closes, params.fast);
    const slowSMA = sma(closes, params.slow);
    for (let i = 1; i < closes.length; i++) {
      if (fastSMA[i] == null || slowSMA[i] == null) continue;
      if (fastSMA[i] > slowSMA[i] && fastSMA[i - 1] <= slowSMA[i - 1]) signals[i] = 1;
      if (fastSMA[i] < slowSMA[i] && fastSMA[i - 1] >= slowSMA[i - 1]) signals[i] = -1;
    }
  } else if (strategy === "rsi_mean_reversion") {
    const rsiVals = rsiCalc(closes, params.period);
    for (let i = 1; i < closes.length; i++) {
      if (rsiVals[i] == null) continue;
      if (rsiVals[i] < params.oversold && rsiVals[i - 1] >= params.oversold) signals[i] = 1;
      if (rsiVals[i] > params.overbought && rsiVals[i - 1] <= params.overbought) signals[i] = -1;
    }
  } else if (strategy === "momentum") {
    // Signals must track their own position state — `position` isn't updated until the
    // execution loop below runs (after this whole loop finishes), so checking it here would
    // always see 0 and the sell branch could never fire (verified: strategy bought once and
    // then held forever, since ret < -0.05 && position > 0 was always false).
    let inPos = false;
    for (let i = params.lookback; i < closes.length; i++) {
      const ret = (closes[i] - closes[i - params.lookback]) / closes[i - params.lookback];
      if (ret > 0.05 && !inPos) { signals[i] = 1; inPos = true; }
      if (ret < -0.05 && inPos) { signals[i] = -1; inPos = false; }
    }
  }

  for (let i = 1; i < closes.length; i++) {
    if (signals[i] === 1 && position === 0 && cashHeld > 0) {
      const sharesBought = (cashHeld * (1 - costPct)) / closes[i];
      position = sharesBought;
      cashHeld = 0;
      trades.push({ date: prices[i].date, type: "BUY", price: closes[i], shares: sharesBought });
    } else if (signals[i] === -1 && position > 0) {
      cashHeld = position * closes[i] * (1 - costPct);
      trades.push({ date: prices[i].date, type: "SELL", price: closes[i], shares: position });
      position = 0;
    }
    equity.push({ date: prices[i].date, value: cashHeld + position * closes[i] });
  }
  return { equity, trades };
}
function runFundamentalStrategy(prices, strategy, params, cash, costPct, fundamentals) {
  const equity = [{ date: prices[0].date, value: cash }];
  let position = 0, cashHeld = cash;
  const trades = [];

  if (strategy === "earnings_momentum") {
    const { surpriseThreshold, holdDays } = params;
    // e.date is Yahoo's fiscal quarter END — the surprise wasn't knowable until the earnings
    // call weeks later. Model the announcement at quarter end + EARNINGS_LAG_DAYS so the buy
    // window opens when the market could actually have reacted, not before.
    const earningsDates = (fundamentals.earnings || [])
      .filter(e => e.surprisePct != null)
      .map(e => ({ ...e, announced: addDays(e.date, EARNINGS_LAG_DAYS) }));
    let holdUntil = -1;
    for (let i = 1; i < prices.length; i++) {
      const priceDate = prices[i].date;
      if (position === 0 && cashHeld > 0) {
        const hit = earningsDates.find(e => {
          const d = daysBetween(e.announced, priceDate);
          return d >= 0 && d <= 5 && e.surprisePct >= surpriseThreshold;
        });
        if (hit) {
          const shares = (cashHeld * (1 - costPct)) / prices[i].close;
          position = shares; cashHeld = 0; holdUntil = i + holdDays;
          trades.push({ date: priceDate, type: "BUY", price: prices[i].close, shares, note: `${hit.surprisePct.toFixed(1)}% surprise` });
        }
      }
      if (position > 0 && i >= holdUntil && holdUntil > 0) {
        cashHeld = position * prices[i].close * (1 - costPct);
        trades.push({ date: priceDate, type: "SELL", price: prices[i].close, shares: position });
        position = 0; holdUntil = -1;
      }
      equity.push({ date: priceDate, value: cashHeld + position * prices[i].close });
    }
  } else if (strategy === "pe_threshold") {
    const { buyPE, sellPE } = params;
    const qf = (fundamentals.quarterlyFinancials || []).filter(q => q.eps != null);
    // `known` advances forward with priceDate (both monotonic) instead of re-filtering qf every
    // row — same "quarters public by this date" set, computed once per new quarter.
    let known = 0;
    for (let i = 1; i < prices.length; i++) {
      const priceDate = prices[i].date;
      // Only quarters whose filing was public by this date — not merely ended by it.
      while (known < qf.length && quarterKnownDate(qf[known]) <= priceDate) known++;
      if (known >= 4) {
        const trailingEPS = qf[known - 1].eps + qf[known - 2].eps + qf[known - 3].eps + qf[known - 4].eps;
        if (trailingEPS > 0) {
          const pe = prices[i].close / trailingEPS;
          if (pe < buyPE && position === 0 && cashHeld > 0) {
            const shares = (cashHeld * (1 - costPct)) / prices[i].close;
            position = shares; cashHeld = 0;
            trades.push({ date: priceDate, type: "BUY", price: prices[i].close, shares, note: `P/E ${pe.toFixed(1)}` });
          } else if (pe > sellPE && position > 0) {
            cashHeld = position * prices[i].close * (1 - costPct);
            trades.push({ date: priceDate, type: "SELL", price: prices[i].close, shares: position, note: `P/E ${pe.toFixed(1)}` });
            position = 0;
          }
        }
      }
      equity.push({ date: priceDate, value: cashHeld + position * prices[i].close });
    }
  } else if (strategy === "revenue_acceleration") {
    const { minGrowth } = params;
    const qf = (fundamentals.quarterlyFinancials || []).filter(q => q.totalRevenue != null);
    const growthRates = [];
    for (let i = 4; i < qf.length; i++) {
      const curr = qf[i].totalRevenue, yearAgo = qf[i - 4]?.totalRevenue;
      // The YoY figure becomes computable only once the CURRENT quarter is filed.
      if (curr && yearAgo && yearAgo > 0) growthRates.push({ date: qf[i].date, known: quarterKnownDate(qf[i]), yoy: (curr - yearAgo) / yearAgo * 100 });
    }
    let lastSignalDate = null;
    // `knownN` advances forward with priceDate instead of re-filtering growthRates every row.
    let knownN = 0;
    for (let i = 1; i < prices.length; i++) {
      const priceDate = prices[i].date;
      while (knownN < growthRates.length && growthRates[knownN].known <= priceDate) knownN++;
      if (knownN >= 2) {
        const latest = growthRates[knownN - 1];
        const prev = growthRates[knownN - 2];
        const accelerating = latest.yoy > prev.yoy && latest.yoy >= minGrowth;
        const daysFromReport = daysBetween(latest.known, priceDate);
        if (daysFromReport >= 0 && daysFromReport <= 10 && latest.known !== lastSignalDate) {
          lastSignalDate = latest.known;
          if (accelerating && position === 0 && cashHeld > 0) {
            const shares = (cashHeld * (1 - costPct)) / prices[i].close;
            position = shares; cashHeld = 0;
            trades.push({ date: priceDate, type: "BUY", price: prices[i].close, shares, note: `Rev +${latest.yoy.toFixed(1)}% YoY↑` });
          } else if (!accelerating && position > 0) {
            cashHeld = position * prices[i].close * (1 - costPct);
            trades.push({ date: priceDate, type: "SELL", price: prices[i].close, shares: position, note: `Rev +${latest.yoy.toFixed(1)}% YoY↓` });
            position = 0;
          }
        }
      }
      equity.push({ date: priceDate, value: cashHeld + position * prices[i].close });
    }
  } else if (strategy === "dividend_reversion") {
    const { yieldPremium } = params;
    const divs = fundamentals.dividends || [];   // sorted ascending by date
    const yieldHistory = [];
    // Maintain the trailing-12-month dividend total with two forward-only pointers into `divs`
    // (window is date > yearAgoStr && date <= priceDate), and the trailing-252 yield average with
    // a running sum + ring — instead of re-filtering `divs` and re-reducing a 252-slice every row.
    let divHi = 0, divLo = 0, annualDiv = 0, yieldSum = 0;
    for (let i = 1; i < prices.length; i++) {
      const priceDate = prices[i].date;
      const yearAgo = new Date(priceDate); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      const yearAgoStr = yearAgo.toISOString().slice(0, 10);
      while (divHi < divs.length && divs[divHi].date <= priceDate) { annualDiv += divs[divHi].amount; divHi++; }
      while (divLo < divHi && divs[divLo].date <= yearAgoStr) { annualDiv -= divs[divLo].amount; divLo++; }
      if (annualDiv > 0 && prices[i].close > 0) {
        const yld = annualDiv / prices[i].close;
        yieldHistory.push(yld); yieldSum += yld;
        if (yieldHistory.length > 252) yieldSum -= yieldHistory[yieldHistory.length - 253];
        if (yieldHistory.length >= 60) {
          const winLen = Math.min(yieldHistory.length, 252);
          const avgYield = yieldSum / winLen;
          const threshold = avgYield * (1 + yieldPremium / 100);
          if (yld >= threshold && position === 0 && cashHeld > 0) {
            const shares = (cashHeld * (1 - costPct)) / prices[i].close;
            position = shares; cashHeld = 0;
            trades.push({ date: priceDate, type: "BUY", price: prices[i].close, shares, note: `Yield ${(yld * 100).toFixed(2)}%` });
          } else if (yld <= avgYield && position > 0) {
            cashHeld = position * prices[i].close * (1 - costPct);
            trades.push({ date: priceDate, type: "SELL", price: prices[i].close, shares: position, note: "Yield normalised" });
            position = 0;
          }
        }
      }
      equity.push({ date: priceDate, value: cashHeld + position * prices[i].close });
    }
  }
  return { equity, trades };
}
function runStrategy(prices, strategy, params, cash = 10000, costPct = 0.001, fundamentals = null) {
  const FUNDAMENTAL_IDS = ["earnings_momentum", "pe_threshold", "revenue_acceleration", "dividend_reversion"];
  if (FUNDAMENTAL_IDS.includes(strategy)) return runFundamentalStrategy(prices, strategy, params, cash, costPct, fundamentals || {});
  return runTechnicalStrategy(prices, strategy, params, cash, costPct);
}
// ── SVG Chart ─────────────────────────────────────────────────────────────────
function EquityChart({ strategy, buyhold, trades = [], currency = "USD", width = 760, height = 340 }) {
  const pad = { top: 20, right: 20, bottom: 40, left: 64 };
  const W = width - pad.left - pad.right;
  const H = height - pad.top - pad.bottom;
  const allVals = [...strategy.map(e => e.value), ...buyhold.map(e => e.value)];
  const minV = Math.min(...allVals) * 0.98;
  const maxV = Math.max(...allVals) * 1.02;
  const n = strategy.length;
  const x = i => (i / (n - 1)) * W;
  const y = v => H - ((v - minV) / (maxV - minV)) * H;
  const sym = ccySymbol(currency);
  const toPath = arr => arr.map((e, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(e.value).toFixed(1)}`).join(" ");
  const yLabels = Array.from({ length: 5 }, (_, i) => { const v = minV + ((maxV - minV) * i) / 4; return { v, y: y(v) }; });
  const xLabels = Array.from({ length: 6 }, (_, i) => { const idx = Math.min(Math.floor(i * n / 6), n - 1); return { idx, date: strategy[idx]?.date?.slice(0, 7) }; });
  // Both arrays are date-sorted, so map each trade to its equity index with a single advancing
  // pointer instead of a full findIndex scan per trade (which was O(trades × equityLength) on
  // every render, before the 300-cap even applied). Cap the marker count up front too.
  const tradeMarkers = (type) => {
    const out = [];
    let k = 0;
    for (const t of trades) {
      if (t.type !== type) continue;
      while (k < n && strategy[k].date < t.date) k++;
      if (k < n) out.push({ idx: k, v: strategy[k]?.value });
      if (out.length >= 300) break;
    }
    return out;
  };
  const buyTrades = tradeMarkers("BUY");
  const sellTrades = tradeMarkers("SELL");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <g transform={`translate(${pad.left},${pad.top})`}>
        {yLabels.map((l, i) => <line key={i} x1={0} y1={l.y.toFixed(1)} x2={W} y2={l.y.toFixed(1)} stroke={c.grid} strokeWidth="1" />)}
        {yLabels.map((l, i) => <text key={i} x={-10} y={l.y + 4} textAnchor="end" style={{ fontFamily: font.mono, fontSize: 10, fill: c.text3 }}>{sym}{(l.v / 1000).toFixed(1)}k</text>)}
        {xLabels.map((l, i) => <text key={i} x={x(l.idx)} y={H + 20} textAnchor="middle" style={{ fontFamily: font.mono, fontSize: 9, fill: c.text3 }}>{l.date}</text>)}
        <path d={toPath(buyhold)} fill="none" stroke={c.seriesAlt} strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7" />
        <motion.path d={toPath(strategy)} fill="none" stroke={c.accent} strokeWidth="2.2"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: [0.16,1,0.3,1] }}
          style={{ filter: `drop-shadow(0 0 5px ${c.accentGlow})` }} />
        {buyTrades.map((t, i) => <circle key={i} cx={x(t.idx).toFixed(1)} cy={y(t.v).toFixed(1)} r="3.5" fill={c.positive} />)}
        {sellTrades.map((t, i) => <circle key={i} cx={x(t.idx).toFixed(1)} cy={y(t.v).toFixed(1)} r="3.5" fill={c.negative} />)}
      </g>
    </svg>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, strategy, buyhold, good = "high", unit = "%", baseLabel = "B&H" }) {
  const sVal = parseFloat(strategy), bVal = parseFloat(buyhold);
  const stratWins = good === "high" ? sVal > bVal : sVal < bVal;
  const diff = sVal - bVal;
  return (
    <div style={{ background: c.surface2, border: `1px solid ${c.hairline}`, borderRadius: radius.sm, padding: "13px 16px", minWidth: 132, flex: "1 1 132px" }}>
      <div style={{ ...type.caption, color: c.text3, marginBottom: 8 }}><BtTip term={label} /></div>
      <div style={{ ...type.data, fontSize: 22, fontWeight: 600, color: stratWins ? c.positive : c.negative, marginBottom: 4 }}>{strategy}{unit}</div>
      <div style={{ ...type.caption, color: c.text3 }}>
        {baseLabel} <span style={{ color: c.text2, fontFamily: font.mono }}>{buyhold}{unit}</span>{" "}
        <span style={{ color: stratWins ? c.positive : c.negative, fontFamily: font.mono }}>{diff > 0 ? "+" : ""}{diff.toFixed(2)}{unit}</span>
      </div>
    </div>
  );
}

// ── Fundamentals context panel ────────────────────────────────────────────────
function FundamentalsPanel({ f }) {
  if (!f) return null;
  return (
    <div>
      <Overline color={c.text3} style={{ marginBottom: 14 }}>Fundamental data used</Overline>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        {[
          ["Trailing P/E", f.trailingPE != null ? f.trailingPE.toFixed(1) + "×" : "—"],
          ["Forward P/E", f.forwardPE != null ? f.forwardPE.toFixed(1) + "×" : "—"],
          ["Price / Book", f.pb != null ? f.pb.toFixed(2) + "×" : "—"],
          ["Div Yield", f.dividendYield != null ? (f.dividendYield * 100).toFixed(2) + "%" : "—"],
          ["Rev Growth", f.revenueGrowth != null ? (f.revenueGrowth * 100).toFixed(1) + "%" : "—"],
          ["EPS Growth", f.earningsGrowth != null ? (f.earningsGrowth * 100).toFixed(1) + "%" : "—"],
        ].map(([label, val]) => (
          <div key={label} style={{ background: c.surface2, borderRadius: radius.xs, padding: "10px 12px" }}>
            <div style={{ ...type.caption, color: c.text3, marginBottom: 4 }}>{label}</div>
            <div style={{ ...type.data, fontWeight: 600, color: c.text }}>{val}</div>
          </div>
        ))}
      </div>
      {f.earnings?.length > 0 && (
        <div style={{ marginBottom: f.quarterlyFinancials?.length ? 14 : 0 }}>
          <div style={{ ...type.caption, fontWeight: 600, color: c.text3, marginBottom: 8 }}>Earnings surprise history</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {f.earnings.map((e, i) => (
              <div key={i} style={{ background: c.surface2, borderRadius: radius.xs, padding: "6px 10px", border: `1px solid ${e.surprisePct >= 5 ? "rgba(61,220,132,0.3)" : e.surprisePct < 0 ? "rgba(255,92,92,0.3)" : c.hairline}` }}>
                <div style={{ fontFamily: font.mono, fontSize: 10, color: c.text3 }}>{e.date}</div>
                <div style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, color: e.surprisePct >= 5 ? c.positive : e.surprisePct < 0 ? c.negative : c.warning }}>
                  {e.surprisePct != null ? (e.surprisePct > 0 ? "+" : "") + e.surprisePct.toFixed(1) + "%" : "—"}
                </div>
                <div style={{ ...type.caption, color: c.text3 }}>A: {e.actual?.toFixed(2)} / E: {e.estimate?.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {f.quarterlyFinancials?.length > 0 && (
        <div>
          <div style={{ ...type.caption, fontWeight: 600, color: c.text3, marginBottom: 8 }}>Quarterly revenue</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {f.quarterlyFinancials.map((q, i) => (
              <div key={i} style={{ background: c.surface2, borderRadius: radius.xs, padding: "6px 10px" }}>
                <div style={{ fontFamily: font.mono, fontSize: 10, color: c.text3 }}>{q.date}</div>
                <div style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, color: c.text }}>{q.totalRevenue ? `$${(q.totalRevenue / 1e9).toFixed(1)}B` : "—"}</div>
                <div style={{ ...type.caption, color: c.text3 }}>EPS: {q.eps?.toFixed(2) ?? "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {f.dividends?.length > 0 && (
        <div style={{ marginTop: 12, ...type.caption, color: c.text3 }}>
          {f.dividends.length} dividend payments on record · latest ${f.dividends[f.dividends.length - 1]?.amount?.toFixed(4)} on {f.dividends[f.dividends.length - 1]?.date}
        </div>
      )}
    </div>
  );
}

// ── Strategy definitions ──────────────────────────────────────────────────────
const STRATEGIES = [
  { id: "sma_crossover", name: "SMA Crossover", type: "technical", origin: "Wall Street, mid-1900s",
    desc: "Buy on golden cross (fast MA crosses above slow MA), sell on death cross.",
    params: [ { id: "fast", label: "Fast SMA (days)", default: 50, min: 5, max: 100 }, { id: "slow", label: "Slow SMA (days)", default: 200, min: 20, max: 400 } ] },
  { id: "rsi_mean_reversion", name: "RSI Mean Reversion", type: "technical", origin: "J. Welles Wilder Jr., 1978",
    desc: "Buy when RSI dips into oversold territory, sell when it reaches overbought.",
    params: [ { id: "period", label: "RSI Period", default: 14, min: 5, max: 30 }, { id: "oversold", label: "Oversold threshold", default: 30, min: 10, max: 45 }, { id: "overbought", label: "Overbought threshold", default: 70, min: 55, max: 90 } ] },
  { id: "momentum", name: "Price Momentum", type: "technical", origin: "Jegadeesh & Titman, 1993",
    desc: "Buy when price is up >5% over lookback period, sell when down >5%.",
    params: [ { id: "lookback", label: "Lookback (days)", default: 90, min: 20, max: 252 } ] },
  { id: "earnings_momentum", name: "Earnings Surprise Momentum", type: "fundamental", origin: "Post-earnings drift (PEAD) — Bernard & Thomas, 1989",
    desc: "Buy within days of a positive earnings surprise. Captures the drift where markets under-react to beats. Hold for a set period then exit.",
    dataNote: "Earnings history and surprise % come from Yahoo Finance (last 4 reported quarters — that's all Yahoo exposes for analyst estimates). Yahoo dates quarters by fiscal period end, so buys are modeled ~40 days later to approximate the real announcement date — no trading on numbers before they were public.",
    params: [ { id: "surpriseThreshold", label: "Min surprise (%)", default: 5, min: 1, max: 30 }, { id: "holdDays", label: "Hold period (trading days)", default: 60, min: 10, max: 180 } ] },
  { id: "pe_threshold", name: "P/E Value Threshold", type: "fundamental", origin: "Benjamin Graham — The Intelligent Investor, 1949",
    desc: "Buy when trailing P/E falls below a value threshold. Sell when it rises into expensive territory. Graham-style: only buy when the price is objectively cheap.",
    dataNote: "Computes trailing P/E from quarterly EPS sourced from SEC filings — typically years of history. Signals only fire once a quarter's 10-Q was actually filed (real SEC filing date, or a conservative 45-day lag when unknown) — no look-ahead.",
    params: [ { id: "buyPE", label: "Buy when P/E below", default: 15, min: 5, max: 30 }, { id: "sellPE", label: "Sell when P/E above", default: 25, min: 15, max: 60 } ] },
  { id: "revenue_acceleration", name: "Revenue Growth Acceleration", type: "fundamental", origin: "Peter Lynch / growth investing, popularised 1980s–90s",
    desc: "Buy when YoY revenue growth accelerates quarter-over-quarter. Exit when growth decelerates. Captures the early stage of a growth inflection before the market fully prices it in.",
    dataNote: "Needs 8+ quarters of revenue history to compute YoY acceleration — sourced from SEC filings (usually years of quarters). Signals fire on the SEC filing date (or a conservative 45-day lag when unknown), never on the quarter-end date itself — no look-ahead.",
    params: [ { id: "minGrowth", label: "Min YoY growth to buy (%)", default: 0, min: -20, max: 30 } ] },
  { id: "dividend_reversion", name: "Dividend Yield Reversion", type: "fundamental", origin: "Dogs of the Dow / income investing, 1970s–present",
    desc: "Buy when dividend yield spikes above its historical average — which happens when the price falls. Sell when yield normalises. Classic income investor entry signal.",
    dataNote: "Uses full dividend payment history. Only works for dividend-paying stocks (e.g. JNJ, KO, T).",
    params: [ { id: "yieldPremium", label: "Buy when yield above avg by (%)", default: 25, min: 10, max: 75 } ] },
  { id: "dca", name: "Dollar-Cost Averaging", type: "passive", origin: "Passive investing classic",
    desc: "Invest a fixed amount every month, regardless of price, instead of a lump sum on day one. Removes market-timing risk — you're always buying at the average price over time. The question most long-term investors actually have.",
    params: [ { id: "monthlyAmount", label: "Monthly contribution", default: 500, min: 50, max: 5000 } ] },
];
const RANGES = [ { value: "1y", label: "1Y" }, { value: "2y", label: "2Y" }, { value: "5y", label: "5Y" }, { value: "10y", label: "10Y" } ];

// Hoisted (not defined inside the render body) so React reconciles instead of remounting the
// whole strategy list on every parent state change.
function StratBtn({ s, on, onSelect }) {
  return (
    <button onClick={onSelect} className="atlas-btn" aria-pressed={on}
      style={{ textAlign: "left", padding: "9px 12px", borderRadius: radius.sm, cursor: "pointer", width: "100%",
        border: `1px solid ${on ? c.accentBorder : c.hairline}`, background: on ? c.accentSoft : "transparent" }}>
      <div style={{ ...type.bodyStrong, fontSize: 13, color: on ? c.accent : c.text }}>{s.name}</div>
      <div style={{ ...type.caption, color: c.text3 }}>{s.origin}</div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Backtester({ initialTicker } = {}) {
  const [ticker, setTicker] = useState(initialTicker || "");
  const [range, setRange] = useState("5y");
  const [stratId, setStratId] = useState("sma_crossover");
  const [costPct, setCostPct] = useState("0.1");
  const [cash, setCash] = useState("10000");
  const [paramVals, setParamVals] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [multiTickers, setMultiTickers] = useState("");
  const [multiResult, setMultiResult] = useState(null);
  const [multiLoading, setMultiLoading] = useState(false);
  const [resTab, setResTab] = useState("trades");

  // The component stays mounted across tab switches now — adopt a new suggested ticker (e.g.
  // "Explore in Backtester" from a fresh dossier) only while nothing has been run yet, so a
  // finished backtest is never clobbered.
  useEffect(() => { if (initialTicker && !result && !loading) setTicker(initialTicker); }, [initialTicker]); // eslint-disable-line react-hooks/exhaustive-deps

  const strat = STRATEGIES.find(s => s.id === stratId);
  const getParam = id => paramVals[stratId + "_" + id] ?? strat.params.find(p => p.id === id)?.default;
  const setParam = (id, v) => setParamVals(prev => ({ ...prev, [stratId + "_" + id]: Number(v) }));
  const isFundamental = strat.type === "fundamental";
  const isDCA = strat.type === "passive";

  async function fetchPrices(t, r = range) {
    const resp = await fetch(apiUrl(`/api/history?ticker=${encodeURIComponent(t)}&range=${r}`));
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return normalizePriceData(data);
  }
  async function fetchFundamentals(t) {
    const resp = await fetch(apiUrl(`/api/fundamentals?ticker=${encodeURIComponent(t)}`));
    const data = await resp.json();
    if (data.error) throw new Error(`Fundamentals: ${data.error}`);
    return data;
  }

  async function runBacktest() {
    if (!ticker.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const t = ticker.trim().toUpperCase();
      const fetchRange = isFundamental ? "10y" : range;
      const [priceData, fundamentals] = await Promise.all([
        fetchPrices(t, fetchRange),
        isFundamental ? fetchFundamentals(t) : Promise.resolve(null),
      ]);
      if (priceData.prices.length < 60) throw new Error("Not enough price history for this range.");
      let prices = priceData.prices;
      let dataWindow = null;
      if (isFundamental && fundamentals) {
        const qf = (fundamentals.quarterlyFinancials || []).filter(q => q.eps != null || q.totalRevenue != null);
        const earningsDates = (fundamentals.earnings || []).map(e => e.date).sort();
        const divDates = (fundamentals.dividends || []).map(d => d.date).sort();
        let clipFrom = null;
        if (stratId === "pe_threshold") { const epsQ = qf.filter(q => q.eps != null); clipFrom = epsQ.length >= 4 ? quarterKnownDate(epsQ[3]) : (epsQ[0] ? quarterKnownDate(epsQ[0]) : null); }
        else if (stratId === "revenue_acceleration") { const revQ = qf.filter(q => q.totalRevenue != null); clipFrom = revQ.length >= 8 ? quarterKnownDate(revQ[7]) : (revQ[0] ? quarterKnownDate(revQ[0]) : null); }
        else if (stratId === "earnings_momentum") { clipFrom = earningsDates[0] ?? null; }
        else if (stratId === "dividend_reversion") { clipFrom = divDates[0] ?? null; }
        const rangeYears = { "1y": 1, "2y": 2, "5y": 5, "10y": 10 };
        const yearsBack = rangeYears[range] ?? 5;
        const rangeStart = new Date(); rangeStart.setFullYear(rangeStart.getFullYear() - yearsBack);
        const rangeStartStr = rangeStart.toISOString().slice(0, 10);
        const effectiveStart = clipFrom && clipFrom > rangeStartStr ? clipFrom : rangeStartStr;
        const clipped = prices.filter(p => p.date >= effectiveStart);
        if (clipped.length >= 60) {
          prices = clipped;
          dataWindow = { from: prices[0].date, to: prices[prices.length - 1].date, clipped: prices.length < priceData.prices.length };
        } else if (clipFrom) {
          const looseClip = prices.filter(p => p.date >= clipFrom);
          if (looseClip.length >= 30) { prices = looseClip; dataWindow = { from: prices[0].date, to: prices[prices.length - 1].date, clipped: true, warning: `Only ${looseClip.length} trading days of fundamental data available` }; }
        }
      }
      const params = {};
      strat.params.forEach(p => { params[p.id] = getParam(p.id); });
      const cost = parseFloat(costPct) / 100;
      let bh, equity, trades, invested = null;
      if (isDCA) {
        // DCA isn't "start with $X lump sum" — it's "commit $X every month". The honest comparison
        // is against a lump sum of the SAME total amount actually contributed, not the Capital field
        // (which doesn't apply here), so buy-and-hold is built from the DCA run's own invested total.
        const dca = runDCA(prices, params.monthlyAmount, cost);
        equity = dca.equity; trades = dca.trades; invested = dca.invested;
        bh = runBuyAndHold(prices, invested, cost);
      } else {
        const initialCash = parseFloat(cash) || 10000;
        bh = runBuyAndHold(prices, initialCash, cost);
        ({ equity, trades } = runStrategy(prices, stratId, params, initialCash, cost, fundamentals));
      }
      if (equity.length < 2) throw new Error("Strategy produced no equity curve — try a longer range or different parameters.");
      const stratStats = isDCA ? calcDCAStats({ equity, trades, invested }) : calcStats(equity);
      const bhStats = calcStats(bh);
      const stratCAGR = parseFloat(stratStats.cagr);
      const bhCAGR = parseFloat(bhStats.cagr);
      const ci = isDCA ? bootstrapDcaCagrDiffCI(prices, params.monthlyAmount, cost) : bootstrapCagrDiffCI(equity, bh);
      setResult({
        ticker: priceData.ticker, name: priceData.name, currency: priceData.currency || "USD", equity, bh, trades, stratStats, bhStats,
        beats: stratCAGR > bhCAGR, margin: Math.abs(stratCAGR - bhCAGR).toFixed(2),
        totalTrades: trades.length, fundamentals, dataWindow, invested,
        ci, lowSample: !isDCA && trades.length < MIN_TRADES,
      });
      setResTab(fundamentals ? "fundamentals" : "trades");
    } catch (e) { setError(e.message || "Something went wrong."); }
    finally { setLoading(false); }
  }

  async function runMultiStress() {
    const tickers = multiTickers.split(/[\s,]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (!tickers.length) return;
    setMultiLoading(true); setMultiResult(null);
    // "max" range silently returns quarterly (not daily) candles from Yahoo despite requesting
    // interval=1d — that broke the date-based clip below (too few points to pass its length
    // check) and let 42 years of quarterly data flow into calcStats(), which assumes daily rows
    // (years = n/252) and produced a "13,752,097% CAGR". "10y" reliably returns daily data,
    // matching the single-ticker path in runBacktest() above.
    const fetchRange = isFundamental ? "10y" : range;
    const rangeYears = { "1y": 1, "2y": 2, "5y": 5, "10y": 10 };
    const yearsBack = rangeYears[range] ?? 5;
    const rangeStartStr = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - yearsBack); return d.toISOString().slice(0, 10); })();
    // All tickers fetched concurrently — a sequential loop made an 8-ticker fundamental stress
    // test take 8× the single-ticker latency for no reason.
    const results = await Promise.all(tickers.slice(0, 8).map(async (t) => {
      try {
        const [priceData, fundamentals] = await Promise.all([
          fetchPrices(t, fetchRange),
          isFundamental ? fetchFundamentals(t) : Promise.resolve(null),
        ]);
        if (priceData.prices.length < 60) return { ticker: t, error: "Not enough data" };
        let prices = priceData.prices;
        if (isFundamental && fundamentals) {
          const qf = (fundamentals.quarterlyFinancials || []).filter(q => q.eps != null || q.totalRevenue != null);
          let clipFrom = null;
          if (stratId === "pe_threshold") { const epsQ = qf.filter(q => q.eps != null); clipFrom = epsQ.length >= 4 ? quarterKnownDate(epsQ[3]) : (epsQ[0] ? quarterKnownDate(epsQ[0]) : null); }
          else if (stratId === "revenue_acceleration") { const revQ = qf.filter(q => q.totalRevenue != null); clipFrom = revQ.length >= 8 ? quarterKnownDate(revQ[7]) : (revQ[0] ? quarterKnownDate(revQ[0]) : null); }
          else if (stratId === "earnings_momentum") { clipFrom = (fundamentals.earnings || [])[0]?.date ?? null; }
          else if (stratId === "dividend_reversion") { clipFrom = (fundamentals.dividends || [])[0]?.date ?? null; }
          const effectiveStart = clipFrom && clipFrom > rangeStartStr ? clipFrom : rangeStartStr;
          const clipped = prices.filter(p => p.date >= effectiveStart);
          if (clipped.length >= 30) prices = clipped;
        }
        const params = {};
        strat.params.forEach(p => { params[p.id] = getParam(p.id); });
        const cost = parseFloat(costPct) / 100;
        let bh, equity, ss, tradeList, ci;
        if (isDCA) {
          const dca = runDCA(prices, params.monthlyAmount, cost);
          equity = dca.equity; tradeList = dca.trades;
          bh = runBuyAndHold(prices, dca.invested, cost);
          ss = calcDCAStats(dca);
          ci = bootstrapDcaCagrDiffCI(prices, params.monthlyAmount, cost);
        } else {
          const initialCash = parseFloat(cash) || 10000;
          bh = runBuyAndHold(prices, initialCash, cost);
          ({ equity, trades: tradeList } = runStrategy(prices, stratId, params, initialCash, cost, fundamentals));
          ss = calcStats(equity);
          ci = bootstrapCagrDiffCI(equity, bh);
        }
        const bs = calcStats(bh);
        return {
          ticker: t, name: priceData.name, stratCAGR: parseFloat(ss.cagr), bhCAGR: parseFloat(bs.cagr), beats: parseFloat(ss.cagr) > parseFloat(bs.cagr), sharpe: ss.sharpe, maxDD: ss.maxDrawdown,
          trades: tradeList.length, ci, lowSample: !isDCA && tradeList.length < MIN_TRADES,
        };
      } catch (e) { return { ticker: t, error: e.message }; }
    }));
    setMultiResult(results);
    setMultiLoading(false);
  }

  const technical = STRATEGIES.filter(s => s.type === "technical");
  const fundamental = STRATEGIES.filter(s => s.type === "fundamental");
  const passive = STRATEGIES.filter(s => s.type === "passive");

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ ...type.displayL, fontSize: 30, color: c.text, margin: "0 0 6px" }}>Strategy Backtester</h2>
        <p style={{ ...type.body, color: c.text3, margin: 0 }}>Does this strategy actually beat buy-and-hold after costs — or does it just look like it does?</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 340px) 1fr", gap: 16, alignItems: "start" }} className="bt-grid">
        {/* ── Config rail ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 16 }}>
          <Card pad={18}>
            <Overline color={c.accent} style={{ marginBottom: 14 }}>Setup</Overline>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Ticker">
                <Input mono value={ticker} onChange={e => setTicker(e.target.value)} onKeyDown={e => e.key === "Enter" && runBacktest()} placeholder="e.g. AAPL"
                  style={{ color: c.accent, fontWeight: 700, fontSize: 16, textTransform: "uppercase" }} />
              </Field>
              <Field label="Historical range">
                <SegmentedControl value={range} onChange={setRange} options={RANGES} size="sm" style={{ width: "100%", justifyContent: "stretch" }} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: isDCA ? "1fr" : "1fr 1fr", gap: 10 }}>
                {!isDCA && <Field label="Capital"><Input mono value={cash} onChange={e => setCash(e.target.value)} inputMode="decimal" /></Field>}
                <Field label="Cost (%)"><Input mono value={costPct} onChange={e => setCostPct(e.target.value)} inputMode="decimal" placeholder="0.1" /></Field>
              </div>
              {isDCA && <p style={{ ...type.caption, color: c.text3, margin: 0 }}>DCA ignores the Capital field — it invests the monthly amount below on a recurring schedule instead of a lump sum.</p>}
            </div>
          </Card>

          <Card pad={18}>
            <Overline color={c.text3} style={{ marginBottom: 10 }}>Technical</Overline>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>{technical.map(s => <StratBtn key={s.id} s={s} on={stratId === s.id} onSelect={() => setStratId(s.id)} />)}</div>
            <Overline color={c.warning} style={{ marginBottom: 10 }}>Fundamental</Overline>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>{fundamental.map(s => <StratBtn key={s.id} s={s} on={stratId === s.id} onSelect={() => setStratId(s.id)} />)}</div>
            <Overline color={c.positive} style={{ marginBottom: 10 }}>Passive</Overline>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{passive.map(s => <StratBtn key={s.id} s={s} on={stratId === s.id} onSelect={() => setStratId(s.id)} />)}</div>
          </Card>
        </div>

        {/* ── Results canvas ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {/* Strategy detail + params */}
          <Card pad={18} accentEdge style={{ borderLeftColor: isFundamental ? c.warning : isDCA ? c.positive : c.accent }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ ...type.heading, color: c.text }}>{strat.name}</span>
              <Badge tone={isFundamental ? "warning" : isDCA ? "positive" : "accent"}>{isFundamental ? "Fundamental" : isDCA ? "Passive" : "Technical"}</Badge>
            </div>
            <p style={{ ...type.small, color: c.text3, margin: "0 0 6px" }}>{strat.desc}</p>
            {strat.dataNote && <p style={{ ...type.caption, color: c.text3, margin: "0 0 8px", fontStyle: "italic" }}>{strat.dataNote}</p>}
            {isFundamental && <p style={{ ...type.caption, color: c.warning, margin: "0 0 12px" }}>Fundamental data availability varies by ticker and strategy (see the note above) — the backtest is automatically clipped to the period where data actually exists, so your selected range is a maximum, not a guarantee.</p>}
            {isFundamental && <p style={{ ...type.caption, color: c.text3, margin: "0 0 12px" }}>Point-in-time: signals fire on the SEC filing date each quarter became public, using first-reported values (not later restatements). Earnings Surprise Momentum uses approximate report dating due to limited data depth.</p>}
            {strat.params.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10, marginTop: 12 }}>
                {strat.params.map(p => (
                  <Field key={p.id} label={p.label}>
                    <Input mono type="number" value={getParam(p.id)} min={p.min} max={p.max} onChange={e => setParam(p.id, e.target.value)} />
                  </Field>
                ))}
              </div>
            )}
            <Button size="lg" full glow loading={loading} disabled={!ticker.trim()} onClick={runBacktest} style={{ marginTop: 16, background: isFundamental ? c.warning : isDCA ? c.positive : c.accent, borderColor: isFundamental ? c.warning : isDCA ? c.positive : c.accent, color: "#0B0B10" }}>
              {loading ? (isFundamental ? "Fetching fundamentals…" : "Running backtest…") : "Run Backtest"}
            </Button>
          </Card>

          {error && <ErrorBanner msg={error} onRetry={runBacktest} />}

          {!result && !loading && !error && (
            <Card><EmptyState title="No backtest yet" hint="Pick a strategy, enter a ticker, and run it to see whether it beats a simple buy-and-hold after trading costs." /></Card>
          )}

          {result && (
            <>
              {/* Verdict — a low-sample run gets a warning card instead of a confident call */}
              <Card accentEdge pad={18} style={{ borderLeftColor: result.lowSample ? c.warning : result.beats ? c.positive : c.negative, background: result.lowSample ? c.warningSoft : result.beats ? c.positiveSoft : c.negativeSoft }}>
                <Overline color={result.lowSample ? c.warning : result.beats ? c.positive : c.negative} style={{ marginBottom: 6 }}>
                  {result.lowSample ? "Not enough trades for a verdict" : "Honest verdict"}
                </Overline>
                {result.lowSample ? (
                  <>
                    <p style={{ ...type.bodyL, fontWeight: 600, color: c.text, margin: "0 0 4px" }}>
                      Only {result.totalTrades} trade{result.totalTrades === 1 ? "" : "s"} on {result.ticker} over {range} — not enough data to draw a reliable conclusion.
                    </p>
                    <p style={{ ...type.small, color: c.text3, margin: 0 }}>
                      Point estimate: {result.beats ? `${strat.name} beat buy-and-hold` : `buy-and-hold beat ${strat.name}`} by {result.margin}% CAGR{result.ci ? ` (${ciInHeadlineDirection(result.ci, result.beats)})` : ""} — but below {MIN_TRADES} trades that gap rides on a handful of entries and exits, i.e. mostly luck.
                      {result.totalTrades === 0 && " No signals triggered at all."} Try a longer range or looser parameters before trusting it.
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ ...type.bodyL, fontWeight: 600, color: c.text, margin: "0 0 4px" }}>
                      {isDCA
                        ? (result.beats
                          ? `Dollar-cost averaging ${fmtMoney(getParam("monthlyAmount"), result.currency, 0)}/month beat a lump sum of the same ${result.invested ? fmtMoney(result.invested, result.currency, 0) : "total"} by ${result.margin}% CAGR${result.ci ? ` (${ciInHeadlineDirection(result.ci, result.beats)})` : ""} on ${result.ticker} over ${range}.`
                          : `A lump sum of the same ${result.invested ? fmtMoney(result.invested, result.currency, 0) : "total"} beat dollar-cost averaging ${fmtMoney(getParam("monthlyAmount"), result.currency, 0)}/month by ${result.margin}% CAGR${result.ci ? ` (${ciInHeadlineDirection(result.ci, result.beats)})` : ""} on ${result.ticker} over ${range}.`)
                        : (result.beats
                          ? `${strat.name} beat buy-and-hold by ${result.margin}% CAGR${result.ci ? ` (${ciInHeadlineDirection(result.ci, result.beats)})` : ""} on ${result.ticker} over ${range}.`
                          : `Buy-and-hold beat ${strat.name} by ${result.margin}% CAGR${result.ci ? ` (${ciInHeadlineDirection(result.ci, result.beats)})` : ""} on ${result.ticker} over ${range}.`)}
                    </p>
                    <p style={{ ...type.small, color: c.text3, margin: 0 }}>
                      {isDCA
                        ? `${result.totalTrades} monthly contributions · ${parseFloat(costPct)}% cost per buy · ${result.invested ? fmtMoney(result.invested, result.currency, 0) : fmtMoney(0, result.currency, 0)} total invested`
                        : <>
                            {result.totalTrades} trades executed · {parseFloat(costPct)}% cost per trade
                            {result.totalTrades === 0 && " · No signals triggered — try adjusting parameters or a longer range"}
                            {!result.beats && result.totalTrades > 0 && " · Most active strategies underperform simple buy-and-hold after costs"}
                          </>}
                    </p>
                  </>
                )}
                {result.ci && (
                  <p style={{ ...type.caption, color: c.text3, margin: "8px 0 0" }}>
                    90% CI = middle 90% of the CAGR gap across {result.ci.iterations} block-bootstrap resamples of this run's daily returns
                    {result.ci.lo < 0 && result.ci.hi > 0 ? <span style={{ color: c.warning }}> — it spans zero, so this result is not statistically distinguishable from no edge</span> : ""}.
                  </p>
                )}
              </Card>

              {/* Stats — greyed down on low-sample runs so precise-looking numbers don't oversell 2 trades */}
              {result.lowSample && (
                <div style={{ ...type.caption, color: c.warning, margin: "2px 0 -4px" }}>
                  Stats greyed out — {result.totalTrades} trade{result.totalTrades === 1 ? "" : "s"} is too few to separate skill from noise.
                </div>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", ...(result.lowSample ? { opacity: 0.45, filter: "saturate(0.35)" } : {}) }}>
                <StatCard label="CAGR" strategy={result.stratStats.cagr} buyhold={result.bhStats.cagr} baseLabel={isDCA ? "Lump" : "B&H"} />
                <StatCard label="Total Return" strategy={result.stratStats.totalReturn} buyhold={result.bhStats.totalReturn} baseLabel={isDCA ? "Lump" : "B&H"} />
                <StatCard label="Max Drawdown" strategy={result.stratStats.maxDrawdown} buyhold={result.bhStats.maxDrawdown} good="low" baseLabel={isDCA ? "Lump" : "B&H"} />
                <StatCard label="Sharpe Ratio" strategy={result.stratStats.sharpe} buyhold={result.bhStats.sharpe} unit="" baseLabel={isDCA ? "Lump" : "B&H"} />
                <StatCard label="Volatility" strategy={result.stratStats.volatility} buyhold={result.bhStats.volatility} good="low" baseLabel={isDCA ? "Lump" : "B&H"} />
              </div>

              {result.dataWindow && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: c.warningSoft, border: `1px solid rgba(251,184,69,0.32)`, borderRadius: radius.sm, flexWrap: "wrap" }}>
                  <Badge tone="warning">Data window</Badge>
                  <span style={{ ...type.caption, color: c.text2 }}>
                    Clipped to <strong style={{ fontFamily: font.mono, color: c.text }}>{result.dataWindow.from}</strong> → <strong style={{ fontFamily: font.mono, color: c.text }}>{result.dataWindow.to}</strong> — the period covered by available fundamental data.
                    {result.dataWindow.warning && <span style={{ color: c.warning }}> {result.dataWindow.warning}.</span>}
                  </span>
                </div>
              )}

              {/* Chart */}
              <Card pad={18}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <Overline color={c.text3}>Equity curve — {result.ticker}</Overline>
                  <div style={{ display: "flex", gap: 14, ...type.caption, color: c.text3 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 2, background: c.accent, display: "inline-block" }} /> {isDCA ? "DCA" : "Strategy"}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 2, background: c.seriesAlt, display: "inline-block" }} /> {isDCA ? "Lump sum (same total)" : "Buy & hold"}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: c.positive, display: "inline-block" }} /> {isDCA ? "Monthly buy" : "Buy"}</span>
                    {!isDCA && <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: c.negative, display: "inline-block" }} /> Sell</span>}
                  </div>
                </div>
                <EquityChart strategy={result.equity} buyhold={result.bh} trades={result.trades} currency={result.currency} />
              </Card>

              {/* Trade log + fundamentals tabs */}
              {(result.trades.length > 0 || result.fundamentals) && (
                <Card pad={18}>
                  <Tabs value={resTab} onChange={setResTab} style={{ marginBottom: 16 }}
                    items={[
                      ...(result.fundamentals ? [{ value: "fundamentals", label: "Fundamentals" }] : []),
                      ...(result.trades.length ? [{ value: "trades", label: `Trade log (${result.trades.length})` }] : []),
                    ]} />
                  {resTab === "fundamentals" && result.fundamentals && <FundamentalsPanel f={result.fundamentals} />}
                  {resTab === "trades" && result.trades.length > 0 && (
                    <div style={{ maxHeight: 280, overflowY: "auto" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "120px 60px 100px 80px 1fr", gap: 8, padding: "6px 0", borderBottom: `1px solid ${c.hairline}`, marginBottom: 4 }}>
                        {["Date", "Type", "Price", "Shares", "Signal"].map(h => <span key={h} style={{ ...type.overline, color: c.text3 }}>{h}</span>)}
                      </div>
                      {result.trades.map((t, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 60px 100px 80px 1fr", gap: 8, padding: "6px 0", borderBottom: `1px solid ${c.hairline}` }}>
                          <span style={{ fontFamily: font.mono, fontSize: 12, color: c.text3 }}>{t.date}</span>
                          <span style={{ ...type.bodyStrong, fontSize: 12, color: t.type === "BUY" ? c.positive : c.negative }}>{t.type}</span>
                          <span style={{ fontFamily: font.mono, fontSize: 12, color: c.text }}>{fmtMoney(t.price, result.currency)}</span>
                          <span style={{ fontFamily: font.mono, fontSize: 12, color: c.text3 }}>{t.shares.toFixed(4)}</span>
                          <span style={{ ...type.caption, color: c.text3 }}>{t.note || ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}
            </>
          )}

          {/* Stress test */}
          <Card pad={18}>
            <Overline color={c.accent} style={{ marginBottom: 6 }}>Stress test — does it work everywhere?</Overline>
            <p style={{ ...type.small, color: c.text3, margin: "0 0 12px" }}>
              Run the same strategy across multiple tickers. If it only wins on some, that's overfitting.
              {isFundamental ? " Fundamental strategies fetch extra data per ticker — allow extra time." : ""}
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Tickers (comma or space separated, max 8)" style={{ flex: "1 1 240px" }}>
                <Input mono value={multiTickers} onChange={e => setMultiTickers(e.target.value)} placeholder="AAPL MSFT TSLA AMZN GOOGL" />
              </Field>
              <Button loading={multiLoading} disabled={!multiTickers.trim()} onClick={runMultiStress}>Run stress test</Button>
            </div>
            {multiResult && (
              <div style={{ marginTop: 16, overflowX: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 86px 86px 118px 62px 70px 80px 82px", gap: 8, padding: "6px 0", borderBottom: `1px solid ${c.hairline}`, minWidth: 720 }}>
                  {["Ticker", "Name", "Strat CAGR", "B&H CAGR", "Δ 90% CI", "Trades", "Sharpe", "Max DD", "Result"].map(h => <span key={h} style={{ ...type.overline, color: c.text3 }}>{h}</span>)}
                </div>
                {multiResult.map((r, i) => r.error ? (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, padding: "8px 0", borderBottom: `1px solid ${c.hairline}`, minWidth: 720 }}>
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: c.accent }}>{r.ticker}</span>
                    <span style={{ ...type.caption, color: c.negative }}>{r.error}</span>
                  </div>
                ) : (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr 86px 86px 118px 62px 70px 80px 82px", gap: 8, padding: "8px 0", borderBottom: `1px solid ${c.hairline}`, minWidth: 720, alignItems: "center" }}>
                    <span style={{ fontFamily: font.mono, fontWeight: 700, fontSize: 12, color: c.accent }}>{r.ticker}</span>
                    <span style={{ ...type.caption, color: c.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                    {/* Low-sample rows keep their numbers but faded, with the Result cell flagging why */}
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: r.stratCAGR >= 0 ? c.positive : c.negative, opacity: r.lowSample ? 0.5 : 1 }}>{r.stratCAGR.toFixed(1)}%</span>
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: c.text2, opacity: r.lowSample ? 0.5 : 1 }}>{r.bhCAGR.toFixed(1)}%</span>
                    <span style={{ fontFamily: font.mono, fontSize: 11, color: r.ci && r.ci.lo < 0 && r.ci.hi > 0 ? c.text3 : c.text2, opacity: r.lowSample ? 0.5 : 1 }}>
                      {r.ci ? `${r.ci.lo >= 0 ? "+" : ""}${r.ci.lo.toFixed(1)} … ${r.ci.hi >= 0 ? "+" : ""}${r.ci.hi.toFixed(1)}%` : "—"}
                    </span>
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: r.lowSample ? c.warning : c.text3 }}>{r.trades}</span>
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: c.text3, opacity: r.lowSample ? 0.5 : 1 }}>{r.sharpe}</span>
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: c.warning, opacity: r.lowSample ? 0.5 : 1 }}>{r.maxDD}%</span>
                    {r.lowSample
                      ? <span style={{ ...type.bodyStrong, fontSize: 11, color: c.warning }}>⚠ Low N</span>
                      : <span style={{ ...type.bodyStrong, fontSize: 11, color: r.beats ? c.positive : c.negative }}>{r.beats ? "Beats" : "Loses"}</span>}
                  </div>
                ))}
                {(() => {
                  const wins = multiResult.filter(r => !r.error && r.beats).length;
                  const total = multiResult.filter(r => !r.error).length;
                  const lowN = multiResult.filter(r => !r.error && r.lowSample).length;
                  const rate = total > 0 ? wins / total : 0;
                  const tone = rate < 0.5 ? c.negative : rate < 0.75 ? c.warning : c.positive;
                  return total > 1 && (
                    <div style={{ marginTop: 12, padding: "10px 14px", background: `${tone}1a`, border: `1px solid ${tone}55`, borderRadius: radius.sm, ...type.small, color: tone }}>
                      {rate < 0.5 ? `Beats buy-and-hold on only ${wins}/${total} tickers — likely overfit to specific conditions.`
                        : rate < 0.75 ? `Mixed results: beats B&H on ${wins}/${total} tickers. Strategy is sensitive to the asset.`
                        : `Strong consistency: beats buy-and-hold on ${wins}/${total} tickers.`}
                      {lowN > 0 && <span style={{ color: c.warning }}> {lowN} of {total} ran fewer than {MIN_TRADES} trades — treat those rows as unreliable, not evidence.</span>}
                    </div>
                  );
                })()}
              </div>
            )}
          </Card>
        </div>
      </div>
      <style>{`@media (max-width: 900px){ .bt-grid{ grid-template-columns: 1fr !important; } .bt-grid > div:first-child{ position: static !important; } }`}</style>
    </div>
  );
}
