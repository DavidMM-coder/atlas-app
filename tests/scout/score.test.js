// Scout Score acceptance tests. The decisive ones feed in historical-style fundamentals
// resembling STIM (Neuronetics) and TOI/STLN (The Oncology Institute) in their PRE-RERATING
// state, embedded in a synthetic-but-realistic screened small-cap universe, and require them
// to land in the top decile. If these fail, the weights or component math are wrong — the
// brief says to surface that, not tune it away silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreUniverse, deriveMetrics, deriveInsiderFlow, percentileRank, COMPONENT_WEIGHTS,
} from "../../src/lib/scout/score.js";

// Deterministic LCG so the synthetic universe is identical on every run.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// A typical screen-survivor small cap: modest growth, flattish margins, some coverage.
// These are POST-GATE names (real businesses), so the bar for "top decile" is meaningful.
function typicalName(i, r) {
  return {
    ticker: `TYP${i}`,
    metrics: {
      growth: {
        revGrowthTTM: -0.05 + r() * 0.25,          // -5%..+20%
        revCagr3y: -0.02 + r() * 0.17,             // -2%..+15%
        opMarginTraj: -0.06 + r() * 0.12,          // -6pp..+6pp drift
        fcfTrend: r() < 0.4 ? null : -0.05 + r() * 0.1,
      },
      insider: {
        level: 0.02 + r() * 0.28,                  // 2%..30% held
        flow: r() < 0.3 ? null : (r() - 0.55) * 0.004, // slight net selling bias
      },
      clusterBuy: r() < 0.04,
      quality: {
        grossMargin: 0.2 + r() * 0.45,
        grossMarginTrend: -0.04 + r() * 0.08,
        netCashPctMcap: -0.3 + r() * 0.5,
        invNetDebtEbitda: r() < 0.5 ? null : -2 + r() * 4,
        antiDilution: -(0.0 + r() * 0.12),         // 0..12%/yr dilution
      },
      neglect: {
        fewAnalysts: -Math.floor(r() * 9),         // 0..8 analysts
        lowInstitutional: -(0.1 + r() * 0.7),
      },
    },
  };
}

// STIM-like pre-rerating: revenue reaccelerating, operating losses improving sharply
// (-40% -> -12%), decent gross margin, cluster insider buying, 1 analyst, ignored.
const STIM_LIKE = {
  ticker: "STIMX",
  metrics: {
    growth: { revGrowthTTM: 0.30, revCagr3y: 0.18, opMarginTraj: 0.24, fcfTrend: 0.06 },
    insider: { level: 0.14, flow: 0.006 },
    clusterBuy: true,
    quality: { grossMargin: 0.72, grossMarginTrend: 0.02, netCashPctMcap: 0.12, invNetDebtEbitda: null, antiDilution: -0.03 },
    neglect: { fewAnalysts: -1, lowInstitutional: -0.22 },
  },
};

// TOI/STLN-like pre-rerating: strong top-line growth, big loss narrowing, majority-holder
// conviction, essentially no coverage. Thin gross margin (care delivery) — the growth and
// neglect components must carry it, which is exactly the 40/15 weighting's job.
const TOI_LIKE = {
  ticker: "TOIX",
  metrics: {
    growth: { revGrowthTTM: 0.24, revCagr3y: 0.21, opMarginTraj: 0.15, fcfTrend: 0.09 },
    insider: { level: 0.55, flow: 0.012 },
    clusterBuy: true,
    quality: { grossMargin: 0.17, grossMarginTrend: 0.03, netCashPctMcap: -0.05, invNetDebtEbitda: null, antiDilution: -0.05 },
    neglect: { fewAnalysts: 0, lowInstitutional: -0.30 },
  },
};

function rankOf(scored, ticker) {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return sorted.findIndex((s) => s.ticker === ticker) / sorted.length;
}

test("STIM-like pre-rerating profile scores in the top decile", () => {
  const r = lcg(42);
  const rows = Array.from({ length: 120 }, (_, i) => typicalName(i, r));
  rows.push(STIM_LIKE);
  const scored = scoreUniverse(rows);
  const frac = rankOf(scored, "STIMX");
  assert.ok(frac < 0.10, `STIM-like ranked at ${(frac * 100).toFixed(1)}pctile from top — not top decile`);
});

test("TOI-like pre-rerating profile scores in the top decile", () => {
  const r = lcg(1234);
  const rows = Array.from({ length: 120 }, (_, i) => typicalName(i, r));
  rows.push(TOI_LIKE);
  const scored = scoreUniverse(rows);
  const frac = rankOf(scored, "TOIX");
  assert.ok(frac < 0.10, `TOI-like ranked at ${(frac * 100).toFixed(1)}pctile from top — not top decile`);
});

test("improving heavy losses outrank flat mediocre profitability on the growth component", () => {
  const rows = [
    { ticker: "IMPROVER", metrics: { growth: { revGrowthTTM: 0.18, revCagr3y: 0.15, opMarginTraj: 0.28, fcfTrend: 0.05 }, insider: { level: 0.1, flow: 0 }, quality: { grossMargin: 0.5, grossMarginTrend: 0, netCashPctMcap: 0, invNetDebtEbitda: null, antiDilution: 0 }, neglect: { fewAnalysts: -2, lowInstitutional: -0.3 } } },
    { ticker: "FLAT", metrics: { growth: { revGrowthTTM: 0.03, revCagr3y: 0.03, opMarginTraj: -0.01, fcfTrend: 0.0 }, insider: { level: 0.1, flow: 0 }, quality: { grossMargin: 0.5, grossMarginTrend: 0, netCashPctMcap: 0, invNetDebtEbitda: null, antiDilution: 0 }, neglect: { fewAnalysts: -2, lowInstitutional: -0.3 } } },
  ];
  const [imp, flat] = scoreUniverse(rows);
  assert.ok(imp.components.growth > flat.components.growth);
  assert.ok(imp.score > flat.score);
});

test("missing insider data redistributes weight and tags, never zero-scores", () => {
  const mk = (t, insider) => ({
    ticker: t,
    metrics: {
      growth: { revGrowthTTM: 0.1, revCagr3y: 0.1, opMarginTraj: 0.05, fcfTrend: 0.01 },
      insider,
      quality: { grossMargin: 0.4, grossMarginTrend: 0.01, netCashPctMcap: 0.05, invNetDebtEbitda: null, antiDilution: -0.02 },
      neglect: { fewAnalysts: -1, lowInstitutional: -0.2 },
    },
  });
  const rows = [mk("US1", { level: 0.1, flow: 0.001 }), mk("EU1", { level: 0.1, flow: null }), mk("EU2", { level: null, flow: null })];
  const scored = scoreUniverse(rows);
  const eu1 = scored.find((s) => s.ticker === "EU1");
  const eu2 = scored.find((s) => s.ticker === "EU2");
  // EU1: flow missing -> level carries the component, tagged.
  assert.ok(eu1.tags.includes("insider flow n/a"));
  assert.ok(eu1.components.insider != null);
  // EU2: whole component missing -> null component, tagged, composite still computed from
  // the other three (identical inputs to EU1 elsewhere, so scores stay in a sane band).
  assert.ok(eu2.tags.includes("insider data n/a"));
  assert.equal(eu2.components.insider, null);
  assert.ok(eu2.score != null && eu2.score > 0);
});

test("cluster buys add a bonus to the insider component", () => {
  const base = {
    growth: { revGrowthTTM: 0.1, revCagr3y: 0.1, opMarginTraj: 0, fcfTrend: 0 },
    quality: { grossMargin: 0.4, grossMarginTrend: 0, netCashPctMcap: 0, invNetDebtEbitda: null, antiDilution: 0 },
    neglect: { fewAnalysts: -1, lowInstitutional: -0.2 },
  };
  const rows = [
    { ticker: "CLU", metrics: { ...base, insider: { level: 0.1, flow: 0.002 }, clusterBuy: true } },
    { ticker: "NOC", metrics: { ...base, insider: { level: 0.1, flow: 0.002 }, clusterBuy: false } },
  ];
  const scored = scoreUniverse(rows);
  const clu = scored.find((s) => s.ticker === "CLU"), noc = scored.find((s) => s.ticker === "NOC");
  assert.ok(clu.components.insider > noc.components.insider);
  assert.ok(clu.tags.includes("cluster-buy"));
});

test("percentileRank uses midranks for ties", () => {
  assert.equal(percentileRank([0, 0, 0, 0], 0), 50);
  assert.equal(percentileRank([1, 2, 3, 4], 4), 87.5);
  assert.equal(percentileRank([1, 2, 3, 4], 0.5), 0);
  assert.equal(percentileRank([1, 2], null), null);
});

test("deriveMetrics: op-margin trajectory catches -40% -> -12% pattern from quarters", () => {
  const quarters = [-0.42, -0.40, -0.38, -0.35, -0.28, -0.22, -0.16, -0.12].map((v, i) => ({
    date: `202${Math.floor(i / 4) + 4}-0${(i % 4) * 3 + 1}-01`, opMargin: v, rev: 10e6 + i * 1e6,
  }));
  const m = deriveMetrics({ quarters, mcapUSD: 100e6 }, null);
  assert.ok(m.growth.opMarginTraj > 0.15, `expected strongly positive trajectory, got ${m.growth.opMarginTraj}`);
});

test("deriveMetrics: dilution penalty from share series", () => {
  const quarters = Array.from({ length: 9 }, (_, i) => ({
    date: `202${4 + Math.floor(i / 4)}-0${(i % 4) * 3 + 1}-01`,
    rev: 5e6, sharesDiluted: 50e6 * Math.pow(1.25, i / 4),
  }));
  const m = deriveMetrics({ quarters, mcapUSD: 100e6 }, null);
  assert.ok(m.quality.antiDilution < -0.2, `expected ~-25%/yr dilution, got ${m.quality.antiDilution}`);
});

test("deriveInsiderFlow: open-market buys dominate option exercises; cluster detection", () => {
  const since = "2026-02-25";
  const txns = [
    { date: "2026-03-01", code: "P", shares: 10000, price: 5, owner: "A" },
    { date: "2026-04-01", code: "P", shares: 8000, price: 5, owner: "B" },
    { date: "2026-05-01", code: "P", shares: 6000, price: 5, owner: "C" },
    { date: "2026-05-02", code: "M", shares: 100000, price: 5, owner: "D" }, // exercise, damped
    { date: "2026-05-03", code: "S", shares: 5000, price: 5, owner: "E" },
    { date: "2025-01-01", code: "S", shares: 900000, price: 5, owner: "F" }, // outside window
  ];
  const flow = deriveInsiderFlow(txns, { sinceISO: since, mcapUSD: 10e6 });
  assert.ok(flow.clusterBuy, "3 distinct P buyers should flag a cluster");
  assert.equal(flow.openMarketBuyers, 3);
  // P total = 120k + 0.15*500k(M) = 75k... net = 120k + 75k - 25k = 170k -> /10m = 0.017
  assert.ok(Math.abs(flow.netBuyPctMcap - 0.017) < 1e-9, String(flow.netBuyPctMcap));
});

test("component weights sum to 1", () => {
  const sum = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
});
