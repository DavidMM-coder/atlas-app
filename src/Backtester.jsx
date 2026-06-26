import React, { useState } from "react";

const P = {
  paper: "#060a06", card: "#0b110b", ink: "#e8f5e9", slate: "#a5d6a7",
  faint: "#4a7a4a", line: "#163016", accent: "#00e676", red: "#ff5252",
  amber: "#ffab40", wash: "#080d08", cardBorder: "#1a301a", dim: "#1e3a1e",
};
const F = { sans: "Inter, sans-serif", mono: "'IBM Plex Mono', monospace" };

const GLOSSARY = {
  "CAGR": "Compound Annual Growth Rate. The smoothed yearly return if your investment grew at a steady pace. $10,000 becoming $16,000 in 5 years = 9.9% CAGR.",
  "Total Return": "How much your investment grew overall. The most honest single number — but doesn't account for how long it took.",
  "Max Drawdown": "The biggest drop from a peak before recovering. If your portfolio hit $15k then fell to $9k, that's a 40% drawdown. Shows the worst pain you'd have felt holding this strategy.",
  "Sharpe Ratio": "Return per unit of risk. Above 1.0 is decent, above 2.0 is excellent. A high Sharpe means you're getting good returns without wild swings.",
  "Volatility": "How wildly the portfolio value swings day to day. High = bigger ups and downs. Low = steadier ride. Annualised as a percentage.",
};

function BtTooltip({ term, children }) {
  const [visible, setVisible] = useState(false);
  const def = GLOSSARY[term];
  if (!def) return <>{children || term}</>;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 3 }}>
      {children || term}
      <span
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", border: `1px solid ${P.faint}`, fontFamily: F.sans, fontSize: 8, fontWeight: 700, color: P.faint, cursor: "default", flexShrink: 0 }}
      >?</span>
      {visible && (
        <span style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", width: 240, background: P.card, border: `1px solid ${P.accent}55`, borderRadius: 8, padding: "10px 12px", zIndex: 999, boxShadow: "0 4px 20px #000a", pointerEvents: "none" }}>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: P.accent, marginBottom: 4 }}>{term}</span>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: 11, color: P.slate, lineHeight: 1.5 }}>{def}</span>
        </span>
      )}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysBetween(dateA, dateB) {
  return Math.round((new Date(dateB) - new Date(dateA)) / 86400000);
}

function sma(prices, window) {
  return prices.map((_, i) => {
    if (i < window - 1) return null;
    const slice = prices.slice(i - window + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / window;
  });
}

function rsiCalc(prices, period = 14) {
  const result = Array(prices.length).fill(null);
  if (prices.length < period + 1) return result;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  result[period] = 100 - 100 / (1 + ag / (al || 0.0001));
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    result[i] = 100 - 100 / (1 + ag / (al || 0.0001));
  }
  return result;
}

// ── Backtesting engines ───────────────────────────────────────────────────────

function runBuyAndHold(prices, cash = 10000) {
  const shares = cash / prices[0].close;
  return prices.map(p => ({ date: p.date, value: shares * p.close }));
}

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
    for (let i = params.lookback; i < closes.length; i++) {
      const ret = (closes[i] - closes[i - params.lookback]) / closes[i - params.lookback];
      if (ret > 0.05 && position === 0) signals[i] = 1;
      if (ret < -0.05 && position > 0) signals[i] = -1;
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
    const earningsDates = (fundamentals.earnings || []).filter(e => e.surprisePct != null);
    let holdUntil = -1;

    for (let i = 1; i < prices.length; i++) {
      const priceDate = prices[i].date;

      if (position === 0 && cashHeld > 0) {
        const hit = earningsDates.find(e => {
          const d = daysBetween(e.date, priceDate);
          return d >= 0 && d <= 5 && e.surprisePct >= surpriseThreshold;
        });
        if (hit) {
          const shares = (cashHeld * (1 - costPct)) / prices[i].close;
          position = shares;
          cashHeld = 0;
          holdUntil = i + holdDays;
          trades.push({ date: priceDate, type: "BUY", price: prices[i].close, shares, note: `${hit.surprisePct.toFixed(1)}% surprise` });
        }
      }

      if (position > 0 && i >= holdUntil && holdUntil > 0) {
        cashHeld = position * prices[i].close * (1 - costPct);
        trades.push({ date: priceDate, type: "SELL", price: prices[i].close, shares: position });
        position = 0;
        holdUntil = -1;
      }

      equity.push({ date: priceDate, value: cashHeld + position * prices[i].close });
    }

  } else if (strategy === "pe_threshold") {
    const { buyPE, sellPE } = params;
    const qf = (fundamentals.quarterlyFinancials || []).filter(q => q.eps != null);

    for (let i = 1; i < prices.length; i++) {
      const priceDate = prices[i].date;
      const knownQ = qf.filter(q => q.date <= priceDate);

      if (knownQ.length >= 4) {
        const trailingEPS = knownQ.slice(-4).reduce((s, q) => s + q.eps, 0);
        if (trailingEPS > 0) {
          const pe = prices[i].close / trailingEPS;
          if (pe < buyPE && position === 0 && cashHeld > 0) {
            const shares = (cashHeld * (1 - costPct)) / prices[i].close;
            position = shares;
            cashHeld = 0;
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
      if (curr && yearAgo && yearAgo > 0) {
        growthRates.push({ date: qf[i].date, yoy: (curr - yearAgo) / yearAgo * 100 });
      }
    }

    let lastSignalDate = null;
    for (let i = 1; i < prices.length; i++) {
      const priceDate = prices[i].date;
      const knownRates = growthRates.filter(r => r.date <= priceDate);

      if (knownRates.length >= 2) {
        const latest = knownRates[knownRates.length - 1];
        const prev = knownRates[knownRates.length - 2];
        const accelerating = latest.yoy > prev.yoy && latest.yoy >= minGrowth;
        const daysFromReport = daysBetween(latest.date, priceDate);

        if (daysFromReport >= 0 && daysFromReport <= 10 && latest.date !== lastSignalDate) {
          lastSignalDate = latest.date;
          if (accelerating && position === 0 && cashHeld > 0) {
            const shares = (cashHeld * (1 - costPct)) / prices[i].close;
            position = shares;
            cashHeld = 0;
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
    const divs = fundamentals.dividends || [];
    const yieldHistory = [];

    for (let i = 1; i < prices.length; i++) {
      const priceDate = prices[i].date;
      const yearAgo = new Date(priceDate);
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      const yearAgoStr = yearAgo.toISOString().slice(0, 10);

      const trailing = divs.filter(d => d.date > yearAgoStr && d.date <= priceDate);
      const annualDiv = trailing.reduce((s, d) => s + d.amount, 0);

      if (annualDiv > 0 && prices[i].close > 0) {
        const yld = annualDiv / prices[i].close;
        yieldHistory.push(yld);

        if (yieldHistory.length >= 60) {
          const window = yieldHistory.slice(-252);
          const avgYield = window.reduce((a, b) => a + b, 0) / window.length;
          const threshold = avgYield * (1 + yieldPremium / 100);

          if (yld >= threshold && position === 0 && cashHeld > 0) {
            const shares = (cashHeld * (1 - costPct)) / prices[i].close;
            position = shares;
            cashHeld = 0;
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
  if (FUNDAMENTAL_IDS.includes(strategy)) {
    return runFundamentalStrategy(prices, strategy, params, cash, costPct, fundamentals || {});
  }
  return runTechnicalStrategy(prices, strategy, params, cash, costPct);
}

function calcStats(equityCurve, riskFreeRate = 0.05) {
  const values = equityCurve.map(e => e.value);
  const n = values.length;
  if (n < 2) return {};
  const start = values[0], end = values[n - 1];
  const years = n / 252;
  const cagr = (Math.pow(end / start, 1 / years) - 1) * 100;
  const totalReturn = ((end - start) / start) * 100;
  let peak = values[0], maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  const dailyRets = [];
  for (let i = 1; i < values.length; i++) dailyRets.push((values[i] - values[i - 1]) / values[i - 1]);
  const avgRet = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
  const variance = dailyRets.reduce((a, b) => a + Math.pow(b - avgRet, 2), 0) / dailyRets.length;
  const stdDev = Math.sqrt(variance) * Math.sqrt(252);
  const sharpe = stdDev > 0 ? ((avgRet * 252) - riskFreeRate) / stdDev : 0;
  return {
    cagr: cagr.toFixed(2), totalReturn: totalReturn.toFixed(2),
    maxDrawdown: (maxDD * 100).toFixed(2), sharpe: sharpe.toFixed(2),
    volatility: (stdDev * 100).toFixed(2), finalValue: end.toFixed(2),
  };
}

// ── SVG Chart ─────────────────────────────────────────────────────────────────

function EquityChart({ strategy, buyhold, trades = [], width = 700, height = 320 }) {
  const pad = { top: 20, right: 20, bottom: 40, left: 70 };
  const W = width - pad.left - pad.right;
  const H = height - pad.top - pad.bottom;
  const allVals = [...strategy.map(e => e.value), ...buyhold.map(e => e.value)];
  const minV = Math.min(...allVals) * 0.98;
  const maxV = Math.max(...allVals) * 1.02;
  const n = strategy.length;
  const x = i => (i / (n - 1)) * W;
  const y = v => H - ((v - minV) / (maxV - minV)) * H;
  const toPath = arr => arr.map((e, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(e.value).toFixed(1)}`).join(" ");
  const yLabels = Array.from({ length: 5 }, (_, i) => { const v = minV + ((maxV - minV) * i) / 4; return { v, y: y(v) }; });
  const xLabels = Array.from({ length: 6 }, (_, i) => { const idx = Math.min(Math.floor(i * n / 6), n - 1); return { idx, date: strategy[idx]?.date?.slice(0, 7) }; });
  const buyTrades = trades.filter(t => t.type === "BUY").map(t => { const idx = strategy.findIndex(e => e.date >= t.date); return idx >= 0 ? { idx, v: strategy[idx]?.value } : null; }).filter(Boolean);
  const sellTrades = trades.filter(t => t.type === "SELL").map(t => { const idx = strategy.findIndex(e => e.date >= t.date); return idx >= 0 ? { idx, v: strategy[idx]?.value } : null; }).filter(Boolean);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <g transform={`translate(${pad.left},${pad.top})`}>
        {yLabels.map((l, i) => <line key={i} x1={0} y1={l.y.toFixed(1)} x2={W} y2={l.y.toFixed(1)} stroke={P.dim} strokeWidth="1" strokeDasharray="4,4" />)}
        {yLabels.map((l, i) => <text key={i} x={-8} y={l.y + 4} textAnchor="end" style={{ fontFamily: F.mono, fontSize: 10, fill: P.faint }}>${(l.v / 1000).toFixed(1)}k</text>)}
        {xLabels.map((l, i) => <text key={i} x={x(l.idx)} y={H + 18} textAnchor="middle" style={{ fontFamily: F.mono, fontSize: 9, fill: P.faint }}>{l.date}</text>)}
        <path d={toPath(buyhold)} fill="none" stroke={P.slate} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.6" />
        <path d={toPath(strategy)} fill="none" stroke={P.accent} strokeWidth="2" />
        {buyTrades.slice(0, 60).map((t, i) => <circle key={i} cx={x(t.idx).toFixed(1)} cy={y(t.v).toFixed(1)} r="4" fill={P.accent} opacity="0.8" />)}
        {sellTrades.slice(0, 60).map((t, i) => <circle key={i} cx={x(t.idx).toFixed(1)} cy={y(t.v).toFixed(1)} r="4" fill={P.red} opacity="0.8" />)}
        <line x1={W - 160} y1={10} x2={W - 140} y2={10} stroke={P.accent} strokeWidth="2" />
        <text x={W - 135} y={14} style={{ fontFamily: F.sans, fontSize: 11, fill: P.ink }}>Strategy</text>
        <line x1={W - 60} y1={10} x2={W - 40} y2={10} stroke={P.slate} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.6" />
        <text x={W - 35} y={14} style={{ fontFamily: F.sans, fontSize: 11, fill: P.faint }}>B&H</text>
      </g>
    </svg>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, strategy, buyhold, good = "high", unit = "%" }) {
  const sVal = parseFloat(strategy), bVal = parseFloat(buyhold);
  const stratWins = good === "high" ? sVal > bVal : sVal < bVal;
  const diff = sVal - bVal;
  return (
    <div style={{ background: P.wash, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "14px 16px", minWidth: 130 }}>
      <div style={{ fontFamily: F.sans, fontSize: 11, color: P.faint, marginBottom: 8 }}><BtTooltip term={label}>{label}</BtTooltip></div>
      <div style={{ fontFamily: F.mono, fontSize: 22, fontWeight: 700, color: stratWins ? P.accent : P.red, marginBottom: 4 }}>{strategy}{unit}</div>
      <div style={{ fontFamily: F.sans, fontSize: 11, color: P.faint }}>
        B&H: <span style={{ color: P.slate, fontFamily: F.mono }}>{buyhold}{unit}</span>
        {" "}<span style={{ color: stratWins ? P.accent : P.red, fontFamily: F.mono }}>{diff > 0 ? "+" : ""}{diff.toFixed(2)}{unit}</span>
      </div>
    </div>
  );
}

// ── Fundamentals context panel ────────────────────────────────────────────────

function FundamentalsPanel({ f }) {
  if (!f) return null;
  return (
    <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "16px 20px", marginBottom: 14 }}>
      <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.faint, marginBottom: 14 }}>FUNDAMENTAL DATA USED</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        {[
          ["Trailing P/E", f.trailingPE != null ? f.trailingPE.toFixed(1) + "×" : "—"],
          ["Forward P/E", f.forwardPE != null ? f.forwardPE.toFixed(1) + "×" : "—"],
          ["Price / Book", f.pb != null ? f.pb.toFixed(2) + "×" : "—"],
          ["Div Yield", f.dividendYield != null ? (f.dividendYield * 100).toFixed(2) + "%" : "—"],
          ["Rev Growth", f.revenueGrowth != null ? (f.revenueGrowth * 100).toFixed(1) + "%" : "—"],
          ["EPS Growth", f.earningsGrowth != null ? (f.earningsGrowth * 100).toFixed(1) + "%" : "—"],
        ].map(([label, val]) => (
          <div key={label} style={{ background: P.wash, borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: F.mono, fontSize: 14, fontWeight: 700, color: P.ink }}>{val}</div>
          </div>
        ))}
      </div>

      {f.earnings?.length > 0 && (
        <div style={{ marginBottom: f.quarterlyFinancials?.length ? 14 : 0 }}>
          <div style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: P.faint, marginBottom: 8 }}>Earnings surprise history</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {f.earnings.map((e, i) => (
              <div key={i} style={{ background: P.wash, borderRadius: 6, padding: "6px 10px", border: `1px solid ${e.surprisePct >= 5 ? P.accent + "44" : e.surprisePct < 0 ? P.red + "44" : P.dim}` }}>
                <div style={{ fontFamily: F.mono, fontSize: 10, color: P.faint }}>{e.date}</div>
                <div style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 700, color: e.surprisePct >= 5 ? P.accent : e.surprisePct < 0 ? P.red : P.amber }}>
                  {e.surprisePct != null ? (e.surprisePct > 0 ? "+" : "") + e.surprisePct.toFixed(1) + "%" : "—"}
                </div>
                <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint }}>A: {e.actual?.toFixed(2)} / E: {e.estimate?.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {f.quarterlyFinancials?.length > 0 && (
        <div>
          <div style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: P.faint, marginBottom: 8 }}>Quarterly revenue</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {f.quarterlyFinancials.map((q, i) => (
              <div key={i} style={{ background: P.wash, borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ fontFamily: F.mono, fontSize: 10, color: P.faint }}>{q.date}</div>
                <div style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 700, color: P.ink }}>{q.totalRevenue ? `$${(q.totalRevenue / 1e9).toFixed(1)}B` : "—"}</div>
                <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint }}>EPS: {q.eps?.toFixed(2) ?? "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {f.dividends?.length > 0 && (
        <div style={{ marginTop: 12, fontFamily: F.sans, fontSize: 12, color: P.faint }}>
          {f.dividends.length} dividend payments on record · latest ${f.dividends[f.dividends.length - 1]?.amount?.toFixed(4)} on {f.dividends[f.dividends.length - 1]?.date}
        </div>
      )}
    </div>
  );
}

// ── Strategy definitions ──────────────────────────────────────────────────────

const STRATEGIES = [
  {
    id: "sma_crossover", name: "SMA Crossover", type: "technical",
    origin: "Wall Street, mid-1900s",
    desc: "Buy on golden cross (fast MA crosses above slow MA), sell on death cross.",
    params: [
      { id: "fast", label: "Fast SMA (days)", default: 50, min: 5, max: 100 },
      { id: "slow", label: "Slow SMA (days)", default: 200, min: 20, max: 400 },
    ],
  },
  {
    id: "rsi_mean_reversion", name: "RSI Mean Reversion", type: "technical",
    origin: "J. Welles Wilder Jr., 1978",
    desc: "Buy when RSI dips into oversold territory, sell when it reaches overbought.",
    params: [
      { id: "period", label: "RSI Period", default: 14, min: 5, max: 30 },
      { id: "oversold", label: "Oversold threshold", default: 30, min: 10, max: 45 },
      { id: "overbought", label: "Overbought threshold", default: 70, min: 55, max: 90 },
    ],
  },
  {
    id: "momentum", name: "Price Momentum", type: "technical",
    origin: "Jegadeesh & Titman, 1993",
    desc: "Buy when price is up >5% over lookback period, sell when down >5%.",
    params: [
      { id: "lookback", label: "Lookback (days)", default: 90, min: 20, max: 252 },
    ],
  },
  {
    id: "earnings_momentum", name: "Earnings Surprise Momentum", type: "fundamental",
    origin: "Post-earnings drift (PEAD) — Bernard & Thomas, 1989",
    desc: "Buy within days of a positive earnings surprise. Captures the drift where markets under-react to beats. Hold for a set period then exit.",
    dataNote: "Uses last 4 quarters of earnings data from Yahoo Finance.",
    params: [
      { id: "surpriseThreshold", label: "Min surprise (%)", default: 5, min: 1, max: 30 },
      { id: "holdDays", label: "Hold period (trading days)", default: 60, min: 10, max: 180 },
    ],
  },
  {
    id: "pe_threshold", name: "P/E Value Threshold", type: "fundamental",
    origin: "Benjamin Graham — The Intelligent Investor, 1949",
    desc: "Buy when trailing P/E falls below a value threshold. Sell when it rises into expensive territory. Graham-style: only buy when the price is objectively cheap.",
    dataNote: "Computes trailing P/E from quarterly EPS. Needs 4+ quarters of data to activate.",
    params: [
      { id: "buyPE", label: "Buy when P/E below", default: 15, min: 5, max: 30 },
      { id: "sellPE", label: "Sell when P/E above", default: 25, min: 15, max: 60 },
    ],
  },
  {
    id: "revenue_acceleration", name: "Revenue Growth Acceleration", type: "fundamental",
    origin: "Peter Lynch / growth investing, popularised 1980s–90s",
    desc: "Buy when YoY revenue growth accelerates quarter-over-quarter. Exit when growth decelerates. Captures the early stage of a growth inflection before the market fully prices it in.",
    dataNote: "Needs 8+ quarters of revenue history to compute YoY acceleration.",
    params: [
      { id: "minGrowth", label: "Min YoY growth to buy (%)", default: 0, min: -20, max: 30 },
    ],
  },
  {
    id: "dividend_reversion", name: "Dividend Yield Reversion", type: "fundamental",
    origin: "Dogs of the Dow / income investing, 1970s–present",
    desc: "Buy when dividend yield spikes above its historical average — which happens when the price falls. Sell when yield normalises. Classic income investor entry signal.",
    dataNote: "Uses full dividend payment history. Only works for dividend-paying stocks (e.g. JNJ, KO, T).",
    params: [
      { id: "yieldPremium", label: "Buy when yield above avg by (%)", default: 25, min: 10, max: 75 },
    ],
  },
];

const RANGES = [
  { v: "1y", label: "1Y" }, { v: "2y", label: "2Y" },
  { v: "5y", label: "5Y" }, { v: "10y", label: "10Y" },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function Backtester() {
  const [ticker, setTicker] = useState("");
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

  const strat = STRATEGIES.find(s => s.id === stratId);
  const getParam = id => paramVals[stratId + "_" + id] ?? strat.params.find(p => p.id === id)?.default;
  const setParam = (id, v) => setParamVals(prev => ({ ...prev, [stratId + "_" + id]: Number(v) }));
  const isFundamental = strat.type === "fundamental";

  async function fetchPrices(t, r = range) {
    const resp = await fetch(`/api/history?ticker=${encodeURIComponent(t)}&range=${r}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function fetchFundamentals(t) {
    const resp = await fetch(`/api/fundamentals?ticker=${encodeURIComponent(t)}`);
    const data = await resp.json();
    if (data.error) throw new Error(`Fundamentals: ${data.error}`);
    return data;
  }

  async function runBacktest() {
    if (!ticker.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const t = ticker.trim().toUpperCase();
      // Always fetch max range for fundamental strategies so we get all available fundamental data,
      // then clip prices to the window covered by that data.
      const fetchRange = isFundamental ? "10y" : range;
      const [priceData, fundamentals] = await Promise.all([
        fetchPrices(t, fetchRange),
        isFundamental ? fetchFundamentals(t) : Promise.resolve(null),
      ]);

      if (priceData.prices.length < 60) throw new Error("Not enough price history for this range.");

      let prices = priceData.prices;
      let dataWindow = null;

      if (isFundamental && fundamentals) {
        // Determine the earliest price date where we have enough fundamental data
        const qf = (fundamentals.quarterlyFinancials || []).filter(q => q.eps != null || q.totalRevenue != null);
        const earningsDates = (fundamentals.earnings || []).map(e => e.date).sort();
        const divDates = (fundamentals.dividends || []).map(d => d.date).sort();

        let clipFrom = null;

        if (stratId === "pe_threshold") {
          // Need 4 quarters of EPS before we can compute trailing P/E
          const epsQ = qf.filter(q => q.eps != null);
          clipFrom = epsQ.length >= 4 ? epsQ[3].date : epsQ[0]?.date ?? null;
        } else if (stratId === "revenue_acceleration") {
          // Need 8 quarters for YoY + acceleration comparison
          const revQ = qf.filter(q => q.totalRevenue != null);
          clipFrom = revQ.length >= 8 ? revQ[7].date : revQ[0]?.date ?? null;
        } else if (stratId === "earnings_momentum") {
          clipFrom = earningsDates[0] ?? null;
        } else if (stratId === "dividend_reversion") {
          clipFrom = divDates[0] ?? null;
        }

        // Also apply the user-selected range as an additional constraint
        const rangeYears = { "1y": 1, "2y": 2, "5y": 5, "10y": 10 };
        const yearsBack = rangeYears[range] ?? 5;
        const rangeStart = new Date();
        rangeStart.setFullYear(rangeStart.getFullYear() - yearsBack);
        const rangeStartStr = rangeStart.toISOString().slice(0, 10);

        // Use the later of clipFrom and rangeStart
        const effectiveStart = clipFrom && clipFrom > rangeStartStr ? clipFrom : rangeStartStr;
        const clipped = prices.filter(p => p.date >= effectiveStart);

        if (clipped.length >= 60) {
          prices = clipped;
          dataWindow = { from: prices[0].date, to: prices[prices.length - 1].date, clipped: prices.length < priceData.prices.length };
        } else if (clipFrom) {
          // Relax: just use available fundamental data period regardless of user range
          const looseClip = prices.filter(p => p.date >= clipFrom);
          if (looseClip.length >= 30) {
            prices = looseClip;
            dataWindow = { from: prices[0].date, to: prices[prices.length - 1].date, clipped: true, warning: `Only ${looseClip.length} trading days of fundamental data available` };
          }
        }
      }

      const params = {};
      strat.params.forEach(p => { params[p.id] = getParam(p.id); });
      const initialCash = parseFloat(cash) || 10000;
      const cost = parseFloat(costPct) / 100;

      const bh = runBuyAndHold(prices, initialCash);
      const { equity, trades } = runStrategy(prices, stratId, params, initialCash, cost, fundamentals);

      if (equity.length < 2) throw new Error("Strategy produced no equity curve — try a longer range or different parameters.");

      const stratStats = calcStats(equity);
      const bhStats = calcStats(bh);
      const stratCAGR = parseFloat(stratStats.cagr);
      const bhCAGR = parseFloat(bhStats.cagr);

      setResult({
        ticker: priceData.ticker, name: priceData.name,
        equity, bh, trades, stratStats, bhStats,
        beats: stratCAGR > bhCAGR,
        margin: Math.abs(stratCAGR - bhCAGR).toFixed(2),
        totalTrades: trades.length,
        fundamentals,
        dataWindow,
      });
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function runMultiStress() {
    const tickers = multiTickers.split(/[\s,]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (!tickers.length) return;
    setMultiLoading(true); setMultiResult(null);
    const results = [];
    const fetchRange = isFundamental ? "max" : range;
    const rangeYears = { "1y": 1, "2y": 2, "5y": 5, "10y": 10 };
    const yearsBack = rangeYears[range] ?? 5;
    const rangeStartStr = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - yearsBack); return d.toISOString().slice(0, 10); })();

    for (const t of tickers.slice(0, 8)) {
      try {
        const [priceData, fundamentals] = await Promise.all([
          fetchPrices(t, fetchRange),
          isFundamental ? fetchFundamentals(t) : Promise.resolve(null),
        ]);
        if (priceData.prices.length < 60) { results.push({ ticker: t, error: "Not enough data" }); continue; }

        let prices = priceData.prices;
        if (isFundamental && fundamentals) {
          const qf = (fundamentals.quarterlyFinancials || []).filter(q => q.eps != null || q.totalRevenue != null);
          let clipFrom = null;
          if (stratId === "pe_threshold") { const epsQ = qf.filter(q => q.eps != null); clipFrom = epsQ.length >= 4 ? epsQ[3].date : epsQ[0]?.date ?? null; }
          else if (stratId === "revenue_acceleration") { const revQ = qf.filter(q => q.totalRevenue != null); clipFrom = revQ.length >= 8 ? revQ[7].date : revQ[0]?.date ?? null; }
          else if (stratId === "earnings_momentum") { clipFrom = (fundamentals.earnings || [])[0]?.date ?? null; }
          else if (stratId === "dividend_reversion") { clipFrom = (fundamentals.dividends || [])[0]?.date ?? null; }
          const effectiveStart = clipFrom && clipFrom > rangeStartStr ? clipFrom : rangeStartStr;
          const clipped = prices.filter(p => p.date >= effectiveStart);
          if (clipped.length >= 30) prices = clipped;
        }

        const params = {};
        strat.params.forEach(p => { params[p.id] = getParam(p.id); });
        const initialCash = parseFloat(cash) || 10000;
        const cost = parseFloat(costPct) / 100;
        const bh = runBuyAndHold(prices, initialCash);
        const { equity } = runStrategy(prices, stratId, params, initialCash, cost, fundamentals);
        const ss = calcStats(equity), bs = calcStats(bh);
        results.push({ ticker: t, name: priceData.name, stratCAGR: parseFloat(ss.cagr), bhCAGR: parseFloat(bs.cagr), beats: parseFloat(ss.cagr) > parseFloat(bs.cagr), sharpe: ss.sharpe, maxDD: ss.maxDrawdown });
      } catch (e) {
        results.push({ ticker: t, error: e.message });
      }
    }
    setMultiResult(results);
    setMultiLoading(false);
  }

  const inputStyle = { width: "100%", boxSizing: "border-box", fontFamily: F.mono, fontSize: 14, color: P.ink, background: P.wash, border: `1px solid ${P.dim}`, borderRadius: 6, padding: "9px 12px" };
  const labelStyle = { fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: P.faint, marginBottom: 5, display: "block" };
  const technical = STRATEGIES.filter(s => s.type === "technical");
  const fundamental = STRATEGIES.filter(s => s.type === "fundamental");

  return (
    <div style={{ paddingBottom: 60 }}>
      <style>{`.bt-btn{transition:all .15s}.bt-btn:hover{filter:brightness(1.15)}.bt-input:focus{outline:none;border-color:${P.accent}!important;box-shadow:0 0 0 2px ${P.accent}22}`}</style>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 22, color: P.ink, margin: "0 0 4px" }}>Strategy Backtester</h2>
        <p style={{ fontFamily: F.sans, fontSize: 13, color: P.faint, margin: 0 }}>Does this strategy actually beat buy-and-hold after costs — or does it just look like it does?</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        {/* Setup */}
        <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "18px 20px" }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.accent, opacity: 0.7, marginBottom: 14, textTransform: "uppercase" }}>Setup</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={labelStyle}>Ticker</label>
              <input className="bt-input" style={{ ...inputStyle, color: P.accent, fontWeight: 700, fontSize: 16, textTransform: "uppercase" }}
                value={ticker} onChange={e => setTicker(e.target.value)} onKeyDown={e => e.key === "Enter" && runBacktest()} placeholder="e.g. AAPL" />
            </div>
            <div>
              <label style={labelStyle}>Historical range</label>
              <div style={{ display: "flex", gap: 6 }}>
                {RANGES.map(r => (
                  <button key={r.v} onClick={() => setRange(r.v)} className="bt-btn" style={{ flex: 1, padding: "8px 4px", borderRadius: 6, border: `1.5px solid ${range === r.v ? P.accent : P.dim}`, background: range === r.v ? `${P.accent}18` : "transparent", fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: range === r.v ? P.accent : P.slate, cursor: "pointer" }}>{r.label}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Starting capital ($)</label>
                <input className="bt-input" style={inputStyle} value={cash} onChange={e => setCash(e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <label style={labelStyle}>Transaction cost (%)</label>
                <input className="bt-input" style={inputStyle} value={costPct} onChange={e => setCostPct(e.target.value)} inputMode="decimal" placeholder="0.1" />
              </div>
            </div>
          </div>
        </div>

        {/* Strategy picker */}
        <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", maxHeight: 420 }}>
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.slate, marginBottom: 8, textTransform: "uppercase" }}>Technical</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {technical.map(s => (
                <button key={s.id} onClick={() => setStratId(s.id)} className="bt-btn" style={{ textAlign: "left", padding: "8px 12px", borderRadius: 6, border: `1.5px solid ${stratId === s.id ? P.accent : P.dim}`, background: stratId === s.id ? `${P.accent}18` : "transparent", cursor: "pointer" }}>
                  <div style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 13, color: stratId === s.id ? P.accent : P.ink }}>{s.name}</div>
                  <div style={{ fontFamily: F.sans, fontSize: 11, color: P.faint }}>{s.origin}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.amber, marginBottom: 8, textTransform: "uppercase" }}>Fundamental</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {fundamental.map(s => (
                <button key={s.id} onClick={() => setStratId(s.id)} className="bt-btn" style={{ textAlign: "left", padding: "8px 12px", borderRadius: 6, border: `1.5px solid ${stratId === s.id ? P.amber : P.dim}`, background: stratId === s.id ? `${P.amber}18` : "transparent", cursor: "pointer" }}>
                  <div style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 13, color: stratId === s.id ? P.amber : P.ink }}>{s.name}</div>
                  <div style={{ fontFamily: F.sans, fontSize: 11, color: P.faint }}>{s.origin}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Strategy detail + params */}
      <div style={{ background: P.card, border: `1px solid ${isFundamental ? P.amber + "55" : P.cardBorder}`, borderRadius: 8, padding: "16px 20px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 15, color: P.ink }}>{strat.name}</span>
          <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: isFundamental ? `${P.amber}22` : `${P.accent}18`, color: isFundamental ? P.amber : P.accent }}>
            {isFundamental ? "Fundamental" : "Technical"}
          </span>
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 13, color: P.faint, margin: "0 0 6px" }}>{strat.desc}</p>
        {strat.dataNote && <p style={{ fontFamily: F.sans, fontSize: 12, color: P.faint, margin: "0 0 8px", fontStyle: "italic" }}>{strat.dataNote}</p>}
        {isFundamental && (
          <p style={{ fontFamily: F.sans, fontSize: 12, color: P.amber, margin: "0 0 14px" }}>
            ⚠ Yahoo Finance only provides ~4–8 quarters of fundamental data. The backtest will be automatically clipped to the period where data is available — your selected range is used as a maximum, not a guarantee.
          </p>
        )}
        {strat.params.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginTop: strat.dataNote ? 0 : 14 }}>
            {strat.params.map(p => (
              <div key={p.id}>
                <label style={labelStyle}>{p.label}</label>
                <input className="bt-input" style={inputStyle} type="number" value={getParam(p.id)} min={p.min} max={p.max} onChange={e => setParam(p.id, e.target.value)} />
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={runBacktest} disabled={loading || !ticker.trim()} className="bt-btn"
        style={{ width: "100%", padding: "13px", fontFamily: F.sans, fontWeight: 700, fontSize: 15, color: "#000", background: isFundamental ? P.amber : P.accent, border: "none", borderRadius: 8, cursor: loading || !ticker.trim() ? "default" : "pointer", opacity: loading || !ticker.trim() ? 0.6 : 1, marginBottom: 20 }}>
        {loading ? (isFundamental ? "Fetching fundamentals + running backtest…" : "Running backtest…") : "▶ Run Backtest"}
      </button>

      {error && <div style={{ padding: "12px 16px", background: `${P.red}11`, border: `1px solid ${P.red}44`, borderLeft: `3px solid ${P.red}`, borderRadius: 6, marginBottom: 16, fontFamily: F.sans, fontSize: 13, color: P.red }}>⚠ {error}</div>}

      {result && (
        <div>
          <div style={{ padding: "16px 20px", marginBottom: 14, background: result.beats ? `${P.accent}12` : `${P.red}12`, border: `1px solid ${result.beats ? P.accent : P.red}44`, borderLeft: `3px solid ${result.beats ? P.accent : P.red}`, borderRadius: 8 }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 2, color: result.beats ? P.accent : P.red, marginBottom: 6 }}>HONEST VERDICT</div>
            <p style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: P.ink, margin: "0 0 4px" }}>
              {result.beats
                ? `✓ ${strat.name} beat buy-and-hold by ${result.margin}% CAGR on ${result.ticker} over ${range}.`
                : `✗ Buy-and-hold beat ${strat.name} by ${result.margin}% CAGR on ${result.ticker} over ${range}.`}
            </p>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: P.faint, margin: 0 }}>
              {result.totalTrades} trades executed · {parseFloat(costPct)}% cost per trade
              {result.totalTrades === 0 && " · No signals triggered — try adjusting parameters or using a longer range"}
              {!result.beats && result.totalTrades > 0 && " · Most active strategies underperform simple buy-and-hold after costs"}
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <StatCard label="CAGR" strategy={result.stratStats.cagr} buyhold={result.bhStats.cagr} />
            <StatCard label="Total Return" strategy={result.stratStats.totalReturn} buyhold={result.bhStats.totalReturn} />
            <StatCard label="Max Drawdown" strategy={result.stratStats.maxDrawdown} buyhold={result.bhStats.maxDrawdown} good="low" />
            <StatCard label="Sharpe Ratio" strategy={result.stratStats.sharpe} buyhold={result.bhStats.sharpe} unit="" />
            <StatCard label="Volatility" strategy={result.stratStats.volatility} buyhold={result.bhStats.volatility} good="low" />
          </div>

          {result.dataWindow && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 10, background: `${P.amber}10`, border: `1px solid ${P.amber}44`, borderRadius: 7 }}>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: P.amber }}>DATA WINDOW</span>
              <span style={{ fontFamily: F.sans, fontSize: 12, color: P.slate }}>
                Backtest clipped to <strong style={{ fontFamily: F.mono, color: P.ink }}>{result.dataWindow.from}</strong> → <strong style={{ fontFamily: F.mono, color: P.ink }}>{result.dataWindow.to}</strong> — this is the period covered by available fundamental data.
                {result.dataWindow.warning && <span style={{ color: P.amber }}> {result.dataWindow.warning}.</span>}
              </span>
            </div>
          )}

          <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "16px 20px", marginBottom: 14 }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.faint, marginBottom: 12 }}>
              EQUITY CURVE — {result.ticker} · {result.dataWindow ? `${result.dataWindow.from.slice(0,7)} → ${result.dataWindow.to.slice(0,7)}` : range} · ● buy  ● sell  ╌ buy-and-hold
            </div>
            <EquityChart strategy={result.equity} buyhold={result.bh} trades={result.trades} />
          </div>

          {result.fundamentals && <FundamentalsPanel f={result.fundamentals} />}

          {result.trades.length > 0 && (
            <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "16px 20px", marginBottom: 14 }}>
              <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.faint, marginBottom: 12 }}>TRADE LOG ({result.trades.length} trades)</div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "120px 60px 100px 80px 1fr", gap: 8, padding: "6px 0", borderBottom: `1px solid ${P.dim}`, marginBottom: 4 }}>
                  {["Date", "Type", "Price", "Shares", "Signal"].map(h => <span key={h} style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase" }}>{h}</span>)}
                </div>
                {result.trades.map((t, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 60px 100px 80px 1fr", gap: 8, padding: "5px 0", borderBottom: `1px solid ${P.dim}33` }}>
                    <span style={{ fontFamily: F.mono, fontSize: 12, color: P.faint }}>{t.date}</span>
                    <span style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 12, color: t.type === "BUY" ? P.accent : P.red }}>{t.type}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 12, color: P.ink }}>${t.price.toFixed(2)}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 12, color: P.faint }}>{t.shares.toFixed(4)}</span>
                    <span style={{ fontFamily: F.sans, fontSize: 11, color: P.faint }}>{t.note || ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stress test */}
      <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "18px 20px" }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.accent, opacity: 0.7, marginBottom: 6, textTransform: "uppercase" }}>Stress Test — does it work everywhere?</div>
        <p style={{ fontFamily: F.sans, fontSize: 13, color: P.faint, margin: "0 0 12px" }}>
          Run the same strategy across multiple tickers. If it only wins on some, that's overfitting.
          {isFundamental ? " Fundamental strategies fetch extra data per ticker — allow extra time." : ""}
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Tickers (comma or space separated, max 8)</label>
            <input className="bt-input" style={inputStyle} value={multiTickers} onChange={e => setMultiTickers(e.target.value)} placeholder="AAPL MSFT TSLA AMZN GOOGL" />
          </div>
          <button onClick={runMultiStress} disabled={multiLoading || !multiTickers.trim()} className="bt-btn"
            style={{ padding: "9px 20px", fontFamily: F.sans, fontWeight: 700, fontSize: 13, color: "#000", background: P.accent, border: "none", borderRadius: 6, cursor: multiLoading || !multiTickers.trim() ? "default" : "pointer", opacity: multiLoading || !multiTickers.trim() ? 0.6 : 1, whiteSpace: "nowrap" }}>
            {multiLoading ? "Testing…" : "Run stress test"}
          </button>
        </div>
        {multiResult && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px 90px 90px 90px 80px", gap: 8, padding: "6px 0", borderBottom: `1px solid ${P.dim}` }}>
              {["Ticker", "Name", "Strat CAGR", "B&H CAGR", "Sharpe", "Max DD", "Result"].map(h => (
                <span key={h} style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase" }}>{h}</span>
              ))}
            </div>
            {multiResult.map((r, i) => r.error ? (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 8, padding: "8px 0", borderBottom: `1px solid ${P.dim}22` }}>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: P.accent }}>{r.ticker}</span>
                <span style={{ fontFamily: F.sans, fontSize: 12, color: P.red }}>{r.error}</span>
              </div>
            ) : (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px 90px 90px 90px 80px", gap: 8, padding: "8px 0", borderBottom: `1px solid ${P.dim}22` }}>
                <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 12, color: P.accent }}>{r.ticker}</span>
                <span style={{ fontFamily: F.sans, fontSize: 12, color: P.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: r.stratCAGR >= 0 ? P.accent : P.red }}>{r.stratCAGR.toFixed(1)}%</span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: P.slate }}>{r.bhCAGR.toFixed(1)}%</span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: P.faint }}>{r.sharpe}</span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: P.amber }}>{r.maxDD}%</span>
                <span style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 11, color: r.beats ? P.accent : P.red }}>{r.beats ? "✓ Beats" : "✗ Loses"}</span>
              </div>
            ))}
            {(() => {
              const wins = multiResult.filter(r => !r.error && r.beats).length;
              const total = multiResult.filter(r => !r.error).length;
              const rate = total > 0 ? wins / total : 0;
              return total > 1 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: rate < 0.5 ? `${P.red}11` : rate < 0.75 ? `${P.amber}11` : `${P.accent}11`, border: `1px solid ${rate < 0.5 ? P.red : rate < 0.75 ? P.amber : P.accent}44`, borderRadius: 6, fontFamily: F.sans, fontSize: 13, color: rate < 0.5 ? P.red : rate < 0.75 ? P.amber : P.accent }}>
                  {rate < 0.5 ? `⚠ Beats buy-and-hold on only ${wins}/${total} tickers — likely overfit to specific conditions.`
                    : rate < 0.75 ? `◈ Mixed results: beats B&H on ${wins}/${total} tickers. Strategy is sensitive to the asset.`
                    : `✓ Strong consistency: beats buy-and-hold on ${wins}/${total} tickers.`}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
