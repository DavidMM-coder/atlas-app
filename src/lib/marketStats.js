// Shared, pure price-history math — this IS Atlas's backtest engine. Used by both the
// Backtester screen and the AI analysis calls (Research dossier, Portfolio review) so that
// technicals/risk/performance numbers fed to the model are real computed values, not
// something the model has to search for or estimate itself.
import { apiUrl } from "./api.js";

// Rolling sum, O(n) — the naive slice-and-reduce version is O(n·window), which adds up fast
// when the stress test runs a 200-day SMA over 10 years of prices for 8 tickers back to back.
export function sma(prices, window) {
  const out = Array(prices.length).fill(null);
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i >= window) sum -= prices[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

export function rsiCalc(prices, period = 14) {
  const result = Array(prices.length).fill(null);
  if (prices.length < period + 1) return result;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  // Wilder's RSI. The zero-loss guard must be RELATIVE, not a fixed 0.0001 floor: with an
  // absolute floor, a low-priced stock whose average gain is itself ~1e-4 in price units gets
  // ag/0.0001 ≈ 1, collapsing RSI toward 50 during a clean uptrend that should read ~100. Handle
  // the no-loss / no-gain cases directly so the result is price-scale-independent.
  const rsiFrom = (ag, al) => (al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al));
  let ag = gains / period, al = losses / period;
  result[period] = rsiFrom(ag, al);
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    result[i] = rsiFrom(ag, al);
  }
  return result;
}

// costPct: the buy-and-hold benchmark should pay the same one-off entry cost the strategies
// pay per trade — a zero-cost benchmark biases every comparison against it, however slightly.
export function runBuyAndHold(prices, cash = 10000, costPct = 0) {
  const shares = (cash * (1 - costPct)) / prices[0].close;
  return prices.map(p => ({ date: p.date, value: shares * p.close }));
}

export function calcStats(equityCurve, riskFreeRate = 0.05) {
  const values = equityCurve.map(e => e.value);
  const n = values.length;
  if (n < 2) return {};
  const start = values[0], end = values[n - 1];
  // Years from actual calendar dates, not row count — assuming every row is one trading day
  // (years = n/252) silently breaks if the data isn't actually daily (verified: a stress-test
  // path that fetched Yahoo's "max" range got quarterly candles back despite requesting
  // interval=1d, and 168 quarterly rows treated as 168 "trading days" collapsed 42 real years
  // into 0.67 computed years, producing a "13,752,097% CAGR"). Floor avoids a same-day divide.
  const years = Math.max((new Date(equityCurve[n - 1].date) - new Date(equityCurve[0].date)) / (365.25 * 86400000), 1 / 365.25);
  const cagr = (Math.pow(end / start, 1 / years) - 1) * 100;
  const totalReturn = ((end - start) / start) * 100;
  let peak = values[0], maxDD = 0;
  for (const v of values) { if (v > peak) peak = v; const dd = (peak - v) / peak; if (dd > maxDD) maxDD = dd; }
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

// Computes a ground-truth technicals/performance snapshot for one ticker from real price
// history (fetched via /api/history, the same Yahoo-backed data source the Backtester uses).
// Returns null if the ticker can't be resolved or there isn't enough history — callers should
// fall back gracefully (the AI can still search for this on its own in that case).
export async function fetchHistoricalStats(tickerGuess, { range = "2y" } = {}) {
  if (!tickerGuess) return null;
  try {
    const r = await fetch(apiUrl(`/api/history?ticker=${encodeURIComponent(tickerGuess)}&range=${range}&interval=1d`));
    if (!r.ok) return null;
    const d = await r.json();
    const prices = d.prices;
    if (!prices || prices.length < 60) return null;
    const closes = prices.map(p => p.close);
    const lastClose = closes[closes.length - 1];
    const sma50Arr = sma(closes, 50), sma200Arr = sma(closes, 200);
    const lastSma50 = sma50Arr[sma50Arr.length - 1], lastSma200 = sma200Arr[sma200Arr.length - 1];
    const rsiArr = rsiCalc(closes, 14);
    const lastRsi = rsiArr[rsiArr.length - 1];
    // Use an actual 1-calendar-year window, not the last 252 rows: the "252 rows == 1 year"
    // assumption silently breaks whenever Yahoo returns non-daily candles (the same failure mode
    // calcStats guards against for CAGR). Fall back to the full series if a year of dates isn't
    // available.
    const lastDateMs = new Date(prices[prices.length - 1].date).getTime();
    const yearAgoMs = lastDateMs - 365 * 86400000;
    const oneYearWin = prices.filter(p => new Date(p.date).getTime() >= yearAgoMs);
    const oneYear = oneYearWin.length ? oneYearWin : prices;
    const high52w = Math.max(...oneYear.map(p => p.high ?? p.close));
    const low52w = Math.min(...oneYear.map(p => p.low ?? p.close));
    const retOver = (n) => { const idx = closes.length - 1 - n; return idx >= 0 ? ((lastClose - closes[idx]) / closes[idx]) * 100 : null; };
    const lastYear = new Date(prices[prices.length - 1].date).getFullYear();
    const ytdIdx = prices.findIndex(p => p.date >= `${lastYear}-01-01`);
    const stats = calcStats(runBuyAndHold(prices, 10000));
    return {
      ticker: d.ticker, name: d.name, currency: d.currency, lastClose,
      sma50: lastSma50, sma200: lastSma200, rsi14: lastRsi,
      high52w, low52w,
      ret1m: retOver(21), ret3m: retOver(63), ret6m: retOver(126),
      retYtd: ytdIdx >= 0 ? ((lastClose - closes[ytdIdx]) / closes[ytdIdx]) * 100 : null,
      periodYears: (Math.max(lastDateMs - new Date(prices[0].date).getTime(), 0) / (365.25 * 86400000)).toFixed(1),
      cagr: stats.cagr, maxDrawdown: stats.maxDrawdown, sharpe: stats.sharpe, volatility: stats.volatility,
      prices, // raw series, so callers (e.g. the research dossier's backtest snapshot) don't need a second fetch
    };
  } catch (_) { return null; }
}

// Runs the exact same SMA-crossover engine the Backtest tab uses, so the Research dossier can show
// "would simple trend-following have beaten buy-and-hold on this stock historically" as a real
// computed data point rather than something the AI has to guess at or search for.
export function backtestSmaCrossover(prices, fast = 50, slow = 200, cash = 10000, costPct = 0.001) {
  if (!prices || prices.length < slow + 10) return null;
  const closes = prices.map(p => p.close);
  const fastSMA = sma(closes, fast), slowSMA = sma(closes, slow);
  const equity = [{ date: prices[0].date, value: cash }];
  let position = 0, cashHeld = cash, trades = 0;
  for (let i = 1; i < closes.length; i++) {
    if (fastSMA[i] == null || slowSMA[i] == null) { equity.push({ date: prices[i].date, value: cashHeld + position * closes[i] }); continue; }
    const goldenCross = fastSMA[i] > slowSMA[i] && fastSMA[i - 1] <= slowSMA[i - 1];
    const deathCross = fastSMA[i] < slowSMA[i] && fastSMA[i - 1] >= slowSMA[i - 1];
    if (goldenCross && position === 0 && cashHeld > 0) { position = (cashHeld * (1 - costPct)) / closes[i]; cashHeld = 0; trades++; }
    else if (deathCross && position > 0) { cashHeld = position * closes[i] * (1 - costPct); position = 0; trades++; }
    equity.push({ date: prices[i].date, value: cashHeld + position * closes[i] });
  }
  const strategyStats = calcStats(equity);
  const buyHoldStats = calcStats(runBuyAndHold(prices, cash, costPct));
  return {
    fast, slow, trades, periodYears: (prices.length / 252).toFixed(1),
    strategyStats, buyHoldStats,
    beats: parseFloat(strategyStats.cagr) > parseFloat(buyHoldStats.cagr),
  };
}

// Simulates investing a fixed amount on a recurring monthly schedule instead of a lump sum on day
// one — the question most long-term investors actually have, versus the signal-driven strategies
// above which are built for active traders.
export function runDCA(prices, monthlyAmount = 500, costPct = 0.001) {
  let shares = 0, invested = 0;
  const equity = [];
  const trades = [];
  let lastMonth = null;
  for (const p of prices) {
    const month = p.date.slice(0, 7);
    if (month !== lastMonth) {
      const boughtShares = (monthlyAmount * (1 - costPct)) / p.close;
      shares += boughtShares;
      invested += monthlyAmount;
      trades.push({ date: p.date, type: "BUY", price: p.close, shares: boughtShares, amount: monthlyAmount, note: `Monthly buy #${trades.length + 1}` });
      lastMonth = month;
    }
    equity.push({ date: p.date, value: shares * p.close });
  }
  return { equity, trades, invested };
}

// Bisection solver for the money-weighted annualized return (XIRR) of a series of dated cash
// flows. Needed because plain CAGR — (end/start)^(1/years)-1 — is only valid for a single lump-sum
// investment; applying it to a DCA equity curve treats month one's tiny balance as "starting
// capital" and produces a wildly inflated, meaningless number (verified: naive calcStats() gave a
// "149% CAGR" on a real 5-year AAPL DCA run that a proper XIRR shows is actually ~19%).
// Uses bisection rather than Newton-Raphson: DCA cashflows are always "many negative contributions,
// then one final positive value" — exactly one sign change — which guarantees a single real root
// for r > -1 (the standard IRR uniqueness result). Newton-Raphson can overshoot into nonsense
// territory on volatile price series (verified: a 10y DCA run on a stock that spiked ~20x then
// crashed produced a "1,359,841,480,052% CAGR" from Newton's method); bisection can't diverge since
// it only ever narrows a bracket known to contain the root.
function xirr(cashflows) {
  if (cashflows.length < 2) return 0;
  const day0 = new Date(cashflows[0].date).getTime();
  const t = cashflows.map((cf) => (new Date(cf.date).getTime() - day0) / (365.25 * 86400000));
  const npv = (r) => cashflows.reduce((s, cf, i) => s + cf.amount / Math.pow(1 + r, t[i]), 0);
  // Floor is just above -1 (not -0.9999) so genuine roots between -100% and -99.99% are actually
  // bracketed and found by bisection rather than falling through to the sentinel below.
  let lo = -0.999999, hi = 100;
  let fLo = npv(lo), fHi = npv(hi);
  while (fLo * fHi > 0 && hi < 1e9) { hi *= 10; fHi = npv(hi); }
  if (fLo * fHi > 0) {
    // No sign change bracketable across (-1, hi]. For a near-total-loss DCA (final value tiny
    // versus everything contributed) NPV stays negative across the whole domain, so there's no
    // root and the money-weighted return is effectively -100%. Returning 0 here (the old
    // behavior) told a user who lost almost everything that their strategy broke even — the exact
    // opposite of the truth. Report ~-100% for that case; the positive-sign case means a gain
    // beyond our bracket, so report the high bound.
    return fLo < 0 ? -100 : hi * 100;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6 || (hi - lo) < 1e-9) return mid * 100;
    if ((fMid > 0) === (fLo > 0)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return ((lo + hi) / 2) * 100;
}

// Stats for a DCA run. CAGR and total return are money-weighted, anchored to what was actually
// invested, since the naive equity[0]-based versions in calcStats() are wrong for a recurring-
// contribution series. Max drawdown uses the raw account value (a DCA investor's intuitive "how
// far did my balance ever fall from its peak" — still meaningful even though the balance is
// growing from new money, not just price moves). Volatility/Sharpe do NOT reuse calcStats() on
// the raw equity curve — verified that produces a nonsensical result: a $500 contribution landing
// on a $500 balance reads as a same-day +100% "return", which inflated a real AAPL DCA run's
// volatility to 61% against a 28% buy-and-hold baseline for the identical stock. Each contribution
// day's value increase is netted out first, isolating the return actually driven by price.
export function calcDCAStats(dca) {
  const finalValue = dca.equity.length ? dca.equity[dca.equity.length - 1].value : 0;
  const lastDate = dca.equity.length ? dca.equity[dca.equity.length - 1].date : null;
  const cashflows = lastDate
    ? [...dca.trades.map((t) => ({ date: t.date, amount: -t.amount })), { date: lastDate, amount: finalValue }]
    : [];
  const totalReturn = dca.invested > 0 ? ((finalValue - dca.invested) / dca.invested) * 100 : 0;

  const values = dca.equity.map(e => e.value);
  let peak = values[0] ?? 0, maxDD = 0;
  for (const v of values) { if (v > peak) peak = v; const dd = peak > 0 ? (peak - v) / peak : 0; if (dd > maxDD) maxDD = dd; }

  const contribByDate = Object.fromEntries(dca.trades.map(t => [t.date, t.amount]));
  const rets = [];
  for (let i = 1; i < dca.equity.length; i++) {
    const prev = values[i - 1];
    if (prev <= 0) continue;
    const contrib = contribByDate[dca.equity[i].date] || 0;
    rets.push((values[i] - contrib - prev) / prev);
  }
  const avgRet = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((a, b) => a + Math.pow(b - avgRet, 2), 0) / rets.length : 0;
  const stdDev = Math.sqrt(variance) * Math.sqrt(252);
  const sharpe = stdDev > 0 ? ((avgRet * 252) - 0.05) / stdDev : 0;

  return {
    cagr: xirr(cashflows).toFixed(2), totalReturn: totalReturn.toFixed(2), finalValue: finalValue.toFixed(2),
    maxDrawdown: (maxDD * 100).toFixed(2), sharpe: sharpe.toFixed(2), volatility: (stdDev * 100).toFixed(2),
  };
}

export function historicalStatsText(s) {
  if (!s) return null;
  const pct = (v) => v == null ? "N/A" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const num = (v) => v == null || Number.isNaN(v) ? "N/A" : v.toFixed(2);
  return `Ticker resolved: ${s.ticker}${s.name ? ` (${s.name})` : ""}
Last close: ${s.currency || ""} ${num(s.lastClose)}
50d SMA: ${num(s.sma50)} | 200d SMA: ${num(s.sma200)} | vs 50d MA: ${s.sma50 ? pct((s.lastClose / s.sma50 - 1) * 100) : "N/A"} | vs 200d MA: ${s.sma200 ? pct((s.lastClose / s.sma200 - 1) * 100) : "N/A"}
RSI(14): ${s.rsi14 != null ? s.rsi14.toFixed(1) : "N/A"}
52w high: ${num(s.high52w)} | 52w low: ${num(s.low52w)} | % off 52w high: ${s.high52w ? pct((s.lastClose / s.high52w - 1) * 100) : "N/A"}
1m return: ${pct(s.ret1m)} | 3m return: ${pct(s.ret3m)} | 6m return: ${pct(s.ret6m)} | YTD return: ${pct(s.retYtd)}
${s.periodYears}-year buy-and-hold stats: CAGR ${s.cagr}% | Max drawdown ${s.maxDrawdown}% | Annualised volatility ${s.volatility}% | Sharpe ratio ${s.sharpe}`;
}
