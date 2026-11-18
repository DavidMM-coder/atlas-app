// Real multi-asset risk math for the portfolio review: correlation/covariance from the SAME
// 1y daily price series the review already fetches per holding (zero extra API calls).
// Until this existed, every correlation/beta/diversification statement in the review was the
// model's qualitative estimate; these numbers are computed, and the prompt pins the model to them.
//
// Method notes (deliberate choices, don't "fix" casually):
// - Returns are DAILY LOG returns on the intersection of trading dates. Mixed US/EU portfolios
//   have different market calendars and holidays; intersecting dates is the standard way to get
//   comparable same-day moves. A 1y US+EU mix still leaves ~230+ shared days.
// - FX is intentionally NOT applied to the return series: correlation of local-currency returns
//   measures how the BUSINESSES co-move, not how EURUSD moved that year. Weights (market values)
//   DO use FX, because exposure is what the investor actually holds.
// - Covariance is annualized with 252 trading days; portfolio volatility is sqrt(w' Σ w).
// - Pairs with fewer than MIN_OVERLAP shared days are excluded (recent IPOs, data gaps) rather
//   than reported on noise; excluded tickers are listed so the UI/prompt can say so honestly.

const MIN_OVERLAP = 60;

// prices: [{date: "YYYY-MM-DD", close}] (as served by /api/history) → Map(date → close)
function toCloseMap(prices) {
  const m = new Map();
  for (const p of prices || []) if (p && p.close != null && p.date) m.set(p.date, p.close);
  return m;
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }

// Aligned daily log returns for two close-maps over their shared dates.
function pairReturns(mapA, mapB) {
  const shared = [...mapA.keys()].filter((d) => mapB.has(d)).sort();
  const ra = [], rb = [];
  for (let i = 1; i < shared.length; i++) {
    const a0 = mapA.get(shared[i - 1]), a1 = mapA.get(shared[i]);
    const b0 = mapB.get(shared[i - 1]), b1 = mapB.get(shared[i]);
    if (a0 > 0 && a1 > 0 && b0 > 0 && b1 > 0) { ra.push(Math.log(a1 / a0)); rb.push(Math.log(b1 / b0)); }
  }
  return { ra, rb };
}

function covCorr(ra, rb) {
  const n = ra.length;
  if (n < 2) return null;
  const ma = mean(ra), mb = mean(rb);
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const da = ra[i] - ma, db = rb[i] - mb; cov += da * db; va += da * da; vb += db * db; }
  cov /= n - 1; va /= n - 1; vb /= n - 1;
  const denom = Math.sqrt(va * vb);
  return { cov, corr: denom > 0 ? cov / denom : 0 };
}

// seriesByTicker: { TICKER: prices[] } — raw /api/history series per holding.
// valueByTicker:  { TICKER: marketValueUSD|null } — FX-converted exposure; null = unknown FX.
// Returns null when fewer than 2 tickers have usable series.
export function computePortfolioRisk(seriesByTicker, valueByTicker) {
  const maps = {};
  const excluded = [];
  for (const [t, prices] of Object.entries(seriesByTicker)) {
    const m = toCloseMap(prices);
    if (m.size >= MIN_OVERLAP) maps[t] = m;
    else excluded.push(t);
  }
  const tickers = Object.keys(maps).sort();
  const n = tickers.length;
  if (n < 2) return null;

  // Pairwise annualized covariance + correlation matrices (symmetric, diagonal = own variance / 1).
  const corr = Array.from({ length: n }, () => Array(n).fill(1));
  const cov = Array.from({ length: n }, () => Array(n).fill(0));
  const pairObs = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const { ra, rb } = pairReturns(maps[tickers[i]], maps[tickers[j]]);
      const c = ra.length >= MIN_OVERLAP ? covCorr(ra, rb) : null;
      const annCov = c ? c.cov * 252 : 0;
      cov[i][j] = cov[j][i] = annCov;
      corr[i][j] = corr[j][i] = i === j ? 1 : (c ? c.corr : 0);
      pairObs[i][j] = pairObs[j][i] = ra.length;
    }
  }

  // Weights from FX-converted market values; portfolio vol only when every included ticker has one.
  const values = tickers.map((t) => valueByTicker[t]);
  const weightsOk = values.every((v) => v != null && v > 0);
  let portfolioVol = null, weightedStandaloneVol = null, diversificationBenefit = null, weights = null;
  if (weightsOk) {
    const total = values.reduce((a, b) => a + b, 0);
    weights = values.map((v) => v / total);
    let pv = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pv += weights[i] * weights[j] * cov[i][j];
    portfolioVol = Math.sqrt(Math.max(0, pv)) * 100;                       // annualized, %
    weightedStandaloneVol = tickers.reduce((a, t, i) => a + weights[i] * Math.sqrt(Math.max(0, cov[i][i])) * 100, 0);
    diversificationBenefit = weightedStandaloneVol > 0 ? (1 - portfolioVol / weightedStandaloneVol) * 100 : null;
  }

  // Summary stats the prompt and UI both use.
  const offDiag = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (pairObs[i][j] >= MIN_OVERLAP) offDiag.push({ a: tickers[i], b: tickers[j], corr: corr[i][j] });
  const avgCorr = offDiag.length ? mean(offDiag.map((p) => p.corr)) : null;
  const topPairs = [...offDiag].sort((x, y) => y.corr - x.corr).slice(0, 5);
  const avgCorrByTicker = tickers.map((t, i) => {
    const others = offDiag.filter((p) => p.a === t || p.b === t);
    return { ticker: t, avg: others.length ? mean(others.map((p) => p.corr)) : null };
  }).filter((x) => x.avg != null);
  const mostDiversifying = avgCorrByTicker.length ? [...avgCorrByTicker].sort((x, y) => x.avg - y.avg)[0] : null;

  return {
    tickers, corr, excluded,
    weights,                      // null when FX/values incomplete
    portfolioVol,                 // annualized %, null when weights incomplete
    weightedStandaloneVol,        // annualized %, same condition
    diversificationBenefit,       // % volatility saved vs sum-of-parts, same condition
    avgCorr, topPairs, mostDiversifying,
    computedAt: Date.now(),
  };
}

// Compact plain-text block for the review prompt — the model is pinned to these numbers.
export function portfolioRiskText(risk) {
  if (!risk) return "";
  const lines = [];
  if (risk.portfolioVol != null) {
    lines.push(`Portfolio annualized volatility (computed from the covariance matrix of the holdings' real daily returns, exposure-weighted): ${risk.portfolioVol.toFixed(1)}%`);
    lines.push(`Weighted average of the holdings' standalone volatilities: ${risk.weightedStandaloneVol.toFixed(1)}% → diversification currently removes ${risk.diversificationBenefit.toFixed(0)}% of the sum-of-parts volatility.`);
  }
  if (risk.avgCorr != null) lines.push(`Average pairwise correlation across the portfolio: ${risk.avgCorr.toFixed(2)}`);
  if (risk.topPairs.length) lines.push(`Most correlated pairs (1y daily returns): ${risk.topPairs.map((p) => `${p.a}–${p.b} ${p.corr.toFixed(2)}`).join(", ")}`);
  if (risk.mostDiversifying) lines.push(`Most diversifying holding (lowest average correlation to the rest): ${risk.mostDiversifying.ticker} (avg ${risk.mostDiversifying.avg.toFixed(2)})`);
  if (risk.excluded.length) lines.push(`Not enough shared price history to include: ${risk.excluded.join(", ")} (under ${MIN_OVERLAP} overlapping trading days).`);
  return lines.join("\n");
}
