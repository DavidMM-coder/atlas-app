// Scout Score (0-100) — pure scoring math, percentile-ranked WITHIN the screened small-cap
// universe (never against large-cap benchmarks). Component weights are the owner's stated
// priorities; see the session brief and docs/scout-data-sourcing.md.
//
// MISSING-DATA RULE (applies at both levels): a sub-metric or component that is null for a
// name is redistributed proportionally across its siblings and the name is tagged — a company
// is never zero-scored for data its market doesn't publish (most EU listings have no insider
// flow; many report semi-annually).

export const COMPONENT_WEIGHTS = { growth: 0.40, insider: 0.25, quality: 0.20, neglect: 0.15 };

// Intra-component sub-metric weights. Directions are normalized in deriveMetrics so that
// HIGHER IS ALWAYS BETTER for every metric listed here.
export const SUB_WEIGHTS = {
  growth:  { revGrowthTTM: 0.35, revCagr3y: 0.20, opMarginTraj: 0.30, fcfTrend: 0.15 },
  insider: { level: 0.40, flow: 0.60 },
  quality: { grossMargin: 0.30, grossMarginTrend: 0.20, netCashPctMcap: 0.15, invNetDebtEbitda: 0.10, antiDilution: 0.25 },
  neglect: { fewAnalysts: 0.60, lowInstitutional: 0.40 },
};

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const fin = (v) => (Number.isFinite(v) ? v : null);

// Midrank percentile (0-100) of each value within `values` (nulls excluded from the pool).
// Midrank so heavily-tied distributions (e.g. analyst counts of 0/1/2) behave sensibly.
export function percentileRank(pool, v) {
  const vals = pool.filter(Number.isFinite);
  if (!vals.length || !Number.isFinite(v)) return null;
  let below = 0, ties = 0;
  for (const x of vals) {
    if (x < v) below++;
    else if (x === v) ties++;
  }
  return ((below + 0.5 * ties) / vals.length) * 100;
}

// ---- metric derivation --------------------------------------------------------------------

// Trailing-window average of the last n quarters' values minus the previous n — the
// trajectory signal that catches "operating margin went from -40% to -12%".
function windowDelta(points, n = 4) {
  const vals = points.filter(Number.isFinite);
  if (vals.length < 3) return null;
  const recent = vals.slice(-Math.min(n, Math.ceil(vals.length / 2)));
  const prior = vals.slice(0, vals.length - recent.length).slice(-n);
  if (!prior.length) return null;
  return mean(recent) - mean(prior);
}

// Annualized share-count growth between the oldest and newest diluted share counts that are
// at least ~15 months apart (5 quarters) — persistent heavy dilution shows up here.
function shareCagr(quarters) {
  const pts = quarters.filter((q) => Number.isFinite(q.sharesDiluted) && q.sharesDiluted > 0);
  if (pts.length < 5) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const years = (new Date(last.date) - new Date(first.date)) / (365.25 * 86400000);
  if (years < 1.2) return null;
  return Math.pow(last.sharesDiluted / first.sharesDiluted, 1 / years) - 1;
}

// 3yr revenue CAGR from the quarters series when the provider didn't give one (EU names):
// TTM revenue now vs TTM revenue three years earlier; tolerates 12-16 available quarters.
function revCagrFromQuarters(quarters) {
  const revs = quarters.filter((q) => Number.isFinite(q.rev));
  if (revs.length < 16) return null;
  const ttm = (arr) => arr.reduce((s, q) => s + q.rev, 0);
  const now = ttm(revs.slice(-4));
  const then = ttm(revs.slice(-16, -12));
  if (then <= 0 || now <= 0) return null;
  return Math.pow(now / then, 1 / 3) - 1;
}

// Insider FLOW from stored Form 4 transactions (US only — EDGAR daily-index batch).
// Open-market buys (code P) weigh far above option exercises/awards (M/A at 0.15); sales
// (S) count fully against; F (tax withholding) lightly against; G (gifts) ignored.
export const TXN_WEIGHTS = { P: 1.0, S: -1.0, M: 0.15, A: 0.15, F: -0.15, G: 0 };
export function deriveInsiderFlow(transactions, { sinceISO, mcapUSD }) {
  if (!Array.isArray(transactions)) return null;
  const win = transactions.filter((t) => t.date && t.date >= sinceISO);
  if (!win.length) return { netBuyPctMcap: 0, clusterBuy: false, openMarketBuyers: 0 };
  let netUSD = 0;
  const pBuyers = new Set();
  for (const t of win) {
    const w = TXN_WEIGHTS[t.code] ?? 0;
    const value = (Number(t.shares) || 0) * (Number(t.price) || 0);
    // A disposed open-market row (code P with D flag) shouldn't happen, but trust the
    // acquired/disposed flag when present.
    const dir = t.ad === "D" && t.code !== "S" ? -1 : 1;
    netUSD += w * value * dir;
    if (t.code === "P" && w * value * dir > 0 && t.owner) pBuyers.add(t.owner);
  }
  return {
    netBuyPctMcap: Number.isFinite(mcapUSD) && mcapUSD > 0 ? netUSD / mcapUSD : null,
    clusterBuy: pBuyers.size >= 3,
    openMarketBuyers: pBuyers.size,
  };
}

// Turns a stored scout_fundamentals doc (+ optional insider flow) into the flat, direction-
// normalized metric set the percentile scorer consumes. Null = structurally missing.
export function deriveMetrics(doc, insiderFlow) {
  const quarters = Array.isArray(doc.quarters) ? doc.quarters : [];
  const opSeries = quarters.map((q) => fin(q.opMargin)).filter((v) => v != null);
  const gmSeries = quarters.map((q) => fin(q.grossMargin)).filter((v) => v != null);
  const fcfSeries = quarters.map((q) => fin(q.fcfMargin)).filter((v) => v != null);

  const netCash = fin(doc.totalCashUSD) != null || fin(doc.totalDebtUSD) != null
    ? (fin(doc.totalCashUSD) ?? 0) - (fin(doc.totalDebtUSD) ?? 0)
    : null;
  const ebitda = fin(doc.ebitdaUSD);
  const sc = shareCagr(quarters);

  return {
    growth: {
      revGrowthTTM: fin(doc.revenueGrowthTTM),
      revCagr3y: fin(doc.revenueCagr3y) ?? revCagrFromQuarters(quarters),
      opMarginTraj: windowDelta(opSeries, 4),
      fcfTrend: fcfSeries.length >= 2 ? fcfSeries[fcfSeries.length - 1] - mean(fcfSeries.slice(0, -1)) : null,
    },
    insider: {
      level: fin(doc.heldPctInsiders),
      flow: insiderFlow ? fin(insiderFlow.netBuyPctMcap) : null,
    },
    clusterBuy: !!insiderFlow?.clusterBuy,
    quality: {
      grossMargin: fin(doc.grossMarginTTM) ?? (gmSeries.length ? mean(gmSeries.slice(-4)) : null),
      grossMarginTrend: windowDelta(gmSeries, 4),
      netCashPctMcap: netCash != null && Number.isFinite(doc.mcapUSD) && doc.mcapUSD > 0 ? netCash / doc.mcapUSD : null,
      invNetDebtEbitda: ebitda != null && ebitda > 0 && netCash != null ? -(-netCash / ebitda) : null,
      antiDilution: sc != null ? -sc : null,
    },
    neglect: {
      fewAnalysts: fin(doc.analystCount) != null ? -doc.analystCount : null,
      lowInstitutional: fin(doc.heldPctInstitutions) != null ? -doc.heldPctInstitutions : null,
    },
  };
}

// ---- universe scoring ---------------------------------------------------------------------

// rows: [{ticker, metrics}] where metrics came from deriveMetrics. Returns per-row
// {ticker, score, components, tags} with component scores stored so the UI can show WHY a
// company ranks where it does.
export function scoreUniverse(rows) {
  // Build the percentile pools per sub-metric across the whole screened universe.
  const pools = {};
  for (const comp of Object.keys(SUB_WEIGHTS)) {
    pools[comp] = {};
    for (const key of Object.keys(SUB_WEIGHTS[comp])) {
      pools[comp][key] = rows.map((r) => r.metrics?.[comp]?.[key]).filter(Number.isFinite);
    }
  }

  return rows.map((r) => {
    const components = {};
    const tags = [];
    for (const comp of Object.keys(SUB_WEIGHTS)) {
      let acc = 0, wsum = 0;
      const missing = [];
      for (const [key, w] of Object.entries(SUB_WEIGHTS[comp])) {
        const pct = percentileRank(pools[comp][key], r.metrics?.[comp]?.[key]);
        if (pct == null) { missing.push(key); continue; }
        acc += pct * w;
        wsum += w;
      }
      // Sub-metric redistribution: dividing by the surviving weight-sum spreads the missing
      // weight proportionally across what IS known.
      components[comp] = wsum > 0 ? acc / wsum : null;
      if (comp === "insider" && components.insider != null && missing.includes("flow")) {
        tags.push("insider flow n/a"); // EU: level kept, flow structurally missing
      }
    }

    // Cluster buys (3+ distinct open-market buyers) are a bonus signal on top of flow.
    if (r.metrics?.clusterBuy && components.insider != null) {
      components.insider = Math.min(100, components.insider + 5);
      tags.push("cluster-buy");
    }

    // Component-level redistribution + tags for structurally missing components.
    let acc = 0, wsum = 0;
    for (const [comp, w] of Object.entries(COMPONENT_WEIGHTS)) {
      if (components[comp] == null) {
        tags.push(`${comp === "insider" ? "insider data" : comp + " data"} n/a`);
        continue;
      }
      acc += components[comp] * w;
      wsum += w;
    }
    const score = wsum > 0 ? acc / wsum : null;

    return {
      ticker: r.ticker,
      score: score != null ? Math.round(score * 10) / 10 : null,
      components: Object.fromEntries(
        Object.entries(components).map(([k, v]) => [k, v != null ? Math.round(v * 10) / 10 : null])
      ),
      tags,
    };
  });
}
