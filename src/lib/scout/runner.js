// Scout batch runner — orchestrates enumeration, the sharded weekly refresh, Form 4 batches
// and rescoring, entirely client-side (Vercel function timeouts make a serverless batch
// runner a poor fit — docs/scout-data-sourcing.md). All pacing, breaker and staleness rules
// come from the pure modules; this file is the IO glue. The screener itself only ever reads
// the cached snapshot docs — it never calls any of this on render.
import { apiFetch } from "../api.js";
import * as store from "./store.js";
import {
  normalizeEuronext, normalizeXetra, normalizeLse, normalizeNordic, normalizeUs, assembleUniverse,
} from "./universe.js";
import { applyGates, inCapBand, runwayMonths, CAP_MAX_USD, CAP_MIN_USD } from "./gates.js";
import { deriveMetrics, deriveInsiderFlow, scoreUniverse } from "./score.js";
import {
  paceDelayMs, isStale, isRefusal, breakerStep, canResume, initialBreaker, stalenessBanner,
} from "./shards.js";
import { diffSnapshots, appendDiffLedger } from "./diff.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => new Date().toISOString().slice(0, 10);

// ---- API helpers ---------------------------------------------------------------------------

// Wraps apiFetch with refusal classification for the circuit breaker. Returns
// { ok, status, data, refusal }.
async function getJson(path) {
  let resp;
  try {
    resp = await apiFetch(path);
  } catch (e) {
    return { ok: false, status: 0, data: null, refusal: false, error: String(e) };
  }
  let data = null;
  try { data = await resp.json(); } catch { /* empty body */ }
  const refusal = isRefusal(resp.status, data);
  return { ok: resp.ok, status: resp.status, data, refusal, error: data?.error || null };
}

// USD conversion. /api/fx returns frankfurter USD-base rates; GBX (LSE pence) is GBP/100.
async function loadFx() {
  const r = await getJson("/api/fx");
  const rates = r.data?.rates || {};
  return (amount, ccy) => {
    if (!Number.isFinite(amount)) return null;
    const c = String(ccy || "USD").toUpperCase();
    if (c === "USD") return amount;
    if (c === "GBX" || c === "GBP") return Number.isFinite(rates.GBP) ? (c === "GBX" ? amount / 100 : amount) / rates.GBP : null;
    return Number.isFinite(rates[c]) ? amount / rates[c] : null;
  };
}

// ---- universe enumeration ------------------------------------------------------------------

// Full (re)build of the enumerated universe: US via EDGAR+Finnhub, EU via the four venue
// feeds. Existing per-name state (lastFetchedAt, mcap, demotions) is carried over so a
// monthly rebuild doesn't reset staleness tracking.
export async function enumerate() {
  const log = [];
  const prevUs = (await store.loadUniverse("us"))?.rows || [];
  const prevEu = (await store.loadUniverse("eu"))?.rows || [];
  const carry = new Map([...prevUs, ...prevEu].map((r) => [r.ticker, r]));

  const us = await getJson("/api/scout?action=us-symbols");
  if (!us.ok) throw new Error("US enumeration failed: " + (us.error || us.status));
  const usRows = normalizeUs(us.data.finnhubSymbols, us.data.edgarTickers);
  log.push(`US: ${usRows.length} listed common stocks`);

  const euRows = [];
  const state = (await store.loadRefreshState()) || {};
  for (const venue of ["euronext", "xetra", "nordic"]) {
    const r = await getJson(`/api/scout?action=eu&venue=${venue}`);
    if (!r.ok) { log.push(`${venue}: FAILED (${r.error || r.status})`); continue; }
    if (r.data.kind === "euronext-csv") euRows.push(...normalizeEuronext(r.data.csv));
    else if (r.data.kind === "xetra-csv") euRows.push(...normalizeXetra(r.data.csv));
    else if (r.data.kind === "nordic-rows") for (const m of r.data.markets) euRows.push(...normalizeNordic(m.rows, m.market));
    log.push(`${venue}: ok (running total ${euRows.length})`);
    await sleep(1000);
  }
  const lse = await getJson(`/api/scout?action=lse${state.lseFileN ? `&hint=${state.lseFileN}` : ""}`);
  if (lse.ok) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(lse.data.b64, { type: "base64" });
    const sheet = wb.Sheets["1.1 Shares"];
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1 }) : [];
    const lseRows = normalizeLse(rows).filter(
      // Pre-trim with the workbook's own £m mkt cap column: keep sub-£600m (~$800m — loose on
      // purpose; the real USD band check happens against live quotes).
      (r) => r.mktCapHintGBPm == null || r.mktCapHintGBPm < 600
    );
    euRows.push(...lseRows);
    log.push(`lse: ok (file N=${lse.data.n}, ${lseRows.length} sub-£600m shares)`);
    await store.saveRefreshState({ lseFileN: lse.data.n });
  } else {
    log.push(`lse: FAILED (${lse.error || lse.status})`);
  }

  const uni = assembleUniverse({ us: usRows, eu: euRows }).map((r) => {
    const prev = carry.get(r.ticker);
    return prev
      ? { ...r, mcapUSD: prev.mcapUSD ?? null, mcapNative: prev.mcapNative ?? null, lastFetchedAt: prev.lastFetchedAt ?? null, demotedAt: prev.demotedAt ?? null }
      : { ...r, mcapUSD: null, mcapNative: null, lastFetchedAt: null, demotedAt: null };
  });
  // Trim names so the region docs stay far below Firestore's 1MB cap.
  for (const r of uni) if (r.name) r.name = String(r.name).slice(0, 40);
  const usU = uni.filter((r) => r.region === "US");
  const euU = uni.filter((r) => r.region === "EU");
  await store.saveUniverse("us", usU, { enumeratedAt: Date.now() });
  await store.saveUniverse("eu", euU, { enumeratedAt: Date.now() });
  log.push(`assembled: ${usU.length} US + ${euU.length} EU`);
  return { us: usU.length, eu: euU.length, log };
}

// ---- per-name fundamentals fetch -----------------------------------------------------------

const pct = (v) => (Number.isFinite(v) ? v / 100 : null);

// Merge Finnhub quarterly series into ascending {date, ...} quarter rows.
function quartersFromSeries(series, edgarQuarters) {
  const byDate = {};
  const put = (arr, key) => {
    for (const p of arr || []) {
      if (!p?.period) continue;
      (byDate[p.period] ||= { date: p.period })[key] = p.v;
    }
  };
  put(series?.operatingMargin, "opMargin");
  put(series?.grossMargin, "grossMargin");
  put(series?.netMargin, "netMargin");
  put(series?.fcfMargin, "fcfMargin");
  for (const q of edgarQuarters || []) {
    const row = (byDate[q.date] ||= { date: q.date });
    if (Number.isFinite(q.totalRevenue)) row.rev = q.totalRevenue;
    if (Number.isFinite(q.sharesDiluted)) row.sharesDiluted = q.sharesDiluted;
    if (row.opMargin == null && Number.isFinite(q.operatingIncome) && q.totalRevenue > 0) row.opMargin = q.operatingIncome / q.totalRevenue;
    if (row.grossMargin == null && Number.isFinite(q.grossProfit) && q.totalRevenue > 0) row.grossMargin = q.grossProfit / q.totalRevenue;
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).slice(-16);
}

// One US name: Finnhub metric (mcap + margin series) and — only if it's in the cap band —
// the extended Yahoo/EDGAR fundamentals. Returns {doc|null, mcapUSD, refusal, failed}.
async function fetchUs(row, fx) {
  const met = await getJson(`/api/scout?action=metric&ticker=${encodeURIComponent(row.ticker)}`);
  if (!met.ok) return { doc: null, mcapUSD: null, refusal: met.refusal, failed: true };
  const mcapM = met.data.metric?.marketCapM ?? met.data.profile?.marketCapM;
  const mcapUSD = Number.isFinite(mcapM) ? mcapM * 1e6 : null;
  if (!inCapBand(mcapUSD)) return { doc: null, mcapUSD, refusal: false, failed: false };

  const fun = await getJson(`/api/fundamentals?ticker=${encodeURIComponent(row.ticker)}`);
  const ext = fun.ok ? fun.data?.extended || {} : {};
  if (!fun.ok && fun.refusal) return { doc: null, mcapUSD, refusal: true, failed: true };
  const quarters = quartersFromSeries(met.data.series, fun.ok ? fun.data?.quarterlyFinancials?.slice(-16) : []);
  const avgVol = Number.isFinite(met.data.metric?.avgVolume10d) ? met.data.metric.avgVolume10d * 1e6 : ext.avgVolume;
  const price = ext.price ?? null;
  return {
    mcapUSD, refusal: false, failed: false,
    doc: {
      ticker: row.ticker, name: row.name, region: "US", mic: row.mic, cik: row.cik ?? null,
      currency: "USD", source: "finnhub+edgar+yahoo",
      mcapNative: mcapUSD, mcapUSD,
      priceNative: price, priceUSD: price,
      avgVolume: avgVol ?? null,
      addvUSD: Number.isFinite(avgVol) && Number.isFinite(price) ? avgVol * price : null,
      revenueTtmUSD: ext.totalRevenueTTM ?? null,
      grossMarginTTM: ext.grossMargins ?? pct(met.data.metric?.grossMarginTTM),
      operatingMarginTTM: ext.operatingMargins ?? pct(met.data.metric?.operatingMarginTTM),
      revenueGrowthTTM: ext.revenueGrowth ?? pct(met.data.metric?.revenueGrowthTTMYoy),
      revenueCagr3y: pct(met.data.metric?.revenueGrowth3Y),
      totalCashUSD: ext.totalCash ?? null, totalDebtUSD: ext.totalDebt ?? null,
      ebitdaUSD: ext.ebitda ?? null, fcfTtmUSD: ext.freeCashflow ?? null, ocfTtmUSD: ext.operatingCashflow ?? null,
      heldPctInsiders: ext.heldPercentInsiders ?? null, heldPctInstitutions: ext.heldPercentInstitutions ?? null,
      analystCount: ext.numberOfAnalystOpinions ?? null,
      industry: met.data.profile?.industry ?? null, exchange: met.data.profile?.exchange ?? null,
      quarters,
    },
  };
}

// One EU name: everything from the extended /api/fundamentals payload; mcap normalized to
// USD for the band check, native kept alongside.
async function fetchEu(row, fx) {
  const fun = await getJson(`/api/fundamentals?ticker=${encodeURIComponent(row.ticker)}`);
  if (!fun.ok) return { doc: null, mcapUSD: null, refusal: fun.refusal, failed: true };
  const ext = fun.data?.extended || {};
  const ccy = ext.currency || row.currency || null;
  const toUSD = (v) => fx(v, ccy);
  const mcapUSD = toUSD(ext.marketCap);
  if (!inCapBand(mcapUSD)) return { doc: null, mcapUSD, refusal: false, failed: false };
  const quarters = (fun.data?.quarterlyFinancials || []).slice(-16).map((q) => ({
    date: q.date, rev: q.totalRevenue ?? null,
    opMargin: Number.isFinite(q.operatingIncome) && q.totalRevenue > 0 ? q.operatingIncome / q.totalRevenue : null,
    grossMargin: Number.isFinite(q.grossProfit) && q.totalRevenue > 0 ? q.grossProfit / q.totalRevenue : null,
    sharesDiluted: q.sharesDiluted ?? null,
  }));
  const priceUSD = toUSD(ext.price);
  return {
    mcapUSD, refusal: false, failed: false,
    doc: {
      ticker: row.ticker, name: row.name, region: "EU", mic: row.mic, cik: null,
      currency: ccy, source: "yahoo",
      mcapNative: ext.marketCap ?? null, mcapUSD,
      priceNative: ext.price ?? null, priceUSD,
      avgVolume: ext.avgVolume ?? null,
      addvUSD: Number.isFinite(ext.avgVolume) && Number.isFinite(priceUSD) ? ext.avgVolume * priceUSD : null,
      revenueTtmUSD: toUSD(ext.totalRevenueTTM),
      grossMarginTTM: ext.grossMargins ?? null,
      operatingMarginTTM: ext.operatingMargins ?? null,
      revenueGrowthTTM: ext.revenueGrowth ?? null,
      revenueCagr3y: null, // derived from quarters when depth allows (deriveMetrics)
      totalCashUSD: toUSD(ext.totalCash), totalDebtUSD: toUSD(ext.totalDebt),
      ebitdaUSD: toUSD(ext.ebitda), fcfTtmUSD: toUSD(ext.freeCashflow), ocfTtmUSD: toUSD(ext.operatingCashflow),
      heldPctInsiders: ext.heldPercentInsiders ?? null, heldPctInstitutions: ext.heldPercentInstitutions ?? null,
      analystCount: ext.numberOfAnalystOpinions ?? null,
      industry: null, exchange: ext.exchangeName ?? ext.exchange ?? null,
      quarters,
    },
  };
}

// ---- the sharded refresh -------------------------------------------------------------------

// Runs (or resumes) one weekday shard: refreshes stale names, cap-filters, persists
// fundamentals for in-band names, honors the circuit breaker, then heartbeats + rescores.
// opts.maxNames caps the run (used by the acceptance test); opts.shard overrides the
// weekday-derived shard.
export async function runShard(opts = {}) {
  const shard = Number.isInteger(opts.shard) ? opts.shard : new Date().getDay() % 7;
  const state = (await store.loadRefreshState()) || {};
  let breaker = state.breaker || initialBreaker();

  const resume = canResume(breaker, Date.now());
  if (resume === false) {
    return { shard, ran: 0, paused: true, reason: `paused (${breaker.pauseReason}); backoff not elapsed` };
  }

  const fx = await loadFx();
  const uniDocs = { us: await store.loadUniverse("us"), eu: await store.loadUniverse("eu") };
  if (!uniDocs.us && !uniDocs.eu) throw new Error("universe not enumerated yet — run atlasScout.enumerate() first");
  const rows = [...(uniDocs.us?.rows || []), ...(uniDocs.eu?.rows || [])];
  const members = rows.filter((r) => r.shard === shard);

  // Work list: stale names only; names that drifted out of the band recheck monthly.
  let work = members.filter((r) =>
    isStale(r.lastFetchedAt, Date.now(), { demoted: !!r.demotedAt })
  );
  // Resume from the persisted cursor when this shard was interrupted.
  let startIdx = 0;
  if (state.cursor && state.cursor.shard === shard && Number.isInteger(state.cursor.index)) {
    startIdx = Math.min(state.cursor.index, work.length);
  }
  if (Number.isFinite(opts.maxNames)) work = work.slice(0, startIdx + opts.maxNames);

  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  let ran = 0, wrote = 0, demoted = 0, failures = 0;
  let pausedReason = null;

  for (let i = startIdx; i < work.length; i++) {
    const row = work[i];
    const res = row.region === "US" ? await fetchUs(row, fx) : await fetchEu(row, fx);

    if (res.refusal) {
      breaker = breakerStep(breaker, "refusal", { nowMs: Date.now(), reason: `refusal on ${row.region} fetch` });
      if (breaker.pausedAt != null) {
        pausedReason = breaker.pauseReason;
        await store.saveRefreshState({ breaker, cursor: { shard, index: i } });
        break;
      }
      // Single refusal below the pause threshold: one retry after a long think.
      await sleep(15000);
      continue;
    }
    breaker = breakerStep(breaker, "success");

    const u = byTicker.get(row.ticker);
    u.lastFetchedAt = Date.now();
    if (res.failed) {
      u.fetchFailedAt = Date.now();
      failures++;
    } else {
      u.fetchFailedAt = null;
      u.mcapUSD = res.mcapUSD;
      if (res.doc) {
        u.demotedAt = null;
        u.mcapNative = res.doc.mcapNative;
        await store.saveFundamentals(row.ticker, res.doc);
        wrote++;
      } else if (res.mcapUSD != null) {
        // Known cap, out of band -> demote to monthly rechecks.
        if (!u.demotedAt) demoted++;
        u.demotedAt = u.demotedAt || Date.now();
      }
    }
    ran++;
    if (ran % 10 === 0) await store.saveRefreshState({ breaker, cursor: { shard, index: i + 1 } });
    await sleep(paceDelayMs());
  }

  // Persist universe state (chunked back into region docs).
  await store.saveUniverse("us", rows.filter((r) => r.region === "US"), { enumeratedAt: uniDocs.us?.enumeratedAt ?? null });
  await store.saveUniverse("eu", rows.filter((r) => r.region === "EU"), { enumeratedAt: uniDocs.eu?.enumeratedAt ?? null });

  if (!pausedReason) {
    const heartbeats = { ...(state.heartbeats || {}), [shard]: Date.now() };
    await store.saveRefreshState({ breaker, cursor: null, heartbeats });
    const scored = await rescore();
    return { shard, ran, wrote, demoted, failures, paused: false, survivors: scored.survivors };
  }
  return { shard, ran, wrote, demoted, failures, paused: true, reason: pausedReason };
}

// ---- scoring + snapshot --------------------------------------------------------------------

// Rebuilds the scored survivor snapshot from CACHE ONLY (no fetches): gates -> component
// scores (percentile within the surviving universe) -> composite -> snapshot + exit diff.
export async function rescore() {
  const [funds, insiders, catalysts, prevSnap, prevDiff] = await Promise.all([
    store.loadAllFundamentals(), store.loadAllInsiders(), store.loadCatalysts(),
    store.loadSurvivors(), store.loadDiff(),
  ]);
  const today = todayISO();
  const sixMonthsAgo = new Date(Date.now() - 182 * 86400000).toISOString().slice(0, 10);

  const gateContext = {};
  const candidates = [];
  for (const [ticker, doc] of Object.entries(funds)) {
    const cat = catalysts[ticker] || null;
    const clinicalStage = !!(cat?.clinicalStage) ||
      (/biotech|pharma|life science|medtech|medical/i.test(String(doc.industry || "")) &&
        (doc.revenueTtmUSD == null || doc.revenueTtmUSD < 10e6));
    const row = {
      ...doc, clinicalStage, catalyst: cat, goingConcern: doc.goingConcern ?? null,
      name: doc.name, industry: doc.industry, mic: doc.mic, exchange: doc.exchange,
    };
    const g = applyGates(row, { todayISO: today });
    const inBand = inCapBand(doc.mcapUSD);
    gateContext[ticker] = { enumerated: true, mcapUSD: doc.mcapUSD, gateReasons: g.reasons };
    if (!g.pass || !inBand) continue;
    const flow = deriveInsiderFlow(insiders[ticker]?.transactions, { sinceISO: sixMonthsAgo, mcapUSD: doc.mcapUSD });
    candidates.push({ ticker, doc, gateTags: g.tags, metrics: deriveMetrics(doc, flow) });
  }

  const scored = scoreUniverse(candidates);
  const byTicker = Object.fromEntries(scored.map((s) => [s.ticker, s]));
  const survivors = candidates
    .map(({ ticker, doc, gateTags }) => ({
      ticker, name: doc.name ?? null, region: doc.region, mic: doc.mic ?? null,
      currency: doc.currency ?? null, mcapNative: doc.mcapNative ?? null, mcapUSD: doc.mcapUSD,
      runwayMonths: runwayMonths(doc) != null ? Math.round(runwayMonths(doc)) : null,
      score: byTicker[ticker].score, components: byTicker[ticker].components,
      tags: [...new Set([...gateTags, ...byTicker[ticker].tags])],
      fetchedAt: doc.fetchedAt ?? null,
    }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  // Exit tracking for the alerts feature: why did each previous survivor leave?
  const diff = diffSnapshots(prevSnap?.rows || [], survivors, gateContext);
  diff.date = today;
  await store.saveSurvivors(survivors, { count: survivors.length, capBandUSD: [CAP_MIN_USD, CAP_MAX_USD] });
  await store.saveDiff({
    latest: { date: today, added: diff.added, removed: diff.removed, graduated: diff.graduated },
    ledger: appendDiffLedger(prevDiff?.ledger, diff, today),
    updatedAt: Date.now(),
  });
  return { survivors: survivors.length, added: diff.added.length, removed: diff.removed.length, graduated: diff.graduated };
}

// ---- Form 4 weekly batch -------------------------------------------------------------------

// EDGAR daily-index batch: last `days` daily form indexes -> Form 4 filings whose CIK is in
// our US universe -> parsed transactions appended per ticker. ~60-210 requests for a full
// week; paced gently (SEC fair use is 10/s, we stay far under).
export async function runForm4Batch(opts = {}) {
  const days = opts.days ?? 7;
  const maxFilings = opts.maxFilings ?? 400;
  const uni = (await store.loadUniverse("us"))?.rows || [];
  const cikSet = new Map();
  for (const r of uni) if (r.cik && !r.demotedAt) cikSet.set(Number(r.cik), r.ticker);

  let fetched = 0, matched = 0, appended = 0;
  const log = [];
  for (let d = 1; d <= days + 2 && fetched < maxFilings; d++) {
    const date = new Date(Date.now() - d * 86400000);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue; // no indexes on weekends
    const ds = date.toISOString().slice(0, 10).replace(/-/g, "");
    const idx = await getJson(`/api/scout?action=form4-index&date=${ds}`);
    if (!idx.ok) { log.push(`${ds}: index unavailable (${idx.status})`); continue; }
    const mine = idx.data.entries.filter((e) => cikSet.has(Number(e.cik)));
    log.push(`${ds}: ${idx.data.entries.length} Form 4s, ${mine.length} in-universe`);
    for (const e of mine) {
      if (fetched >= maxFilings) break;
      const filing = await getJson(`/api/scout?action=form4&path=${encodeURIComponent(e.path)}`);
      fetched++;
      if (!filing.ok) continue;
      const ticker = cikSet.get(Number(e.cik));
      const txns = (filing.data.transactions || []).filter((t) => t.date && t.code);
      if (txns.length) {
        appended += await store.appendInsiders(ticker, txns);
        matched++;
      }
      await sleep(400);
    }
    await sleep(600);
  }
  return { fetched, matched, appended, log };
}

// ---- diagnostics ---------------------------------------------------------------------------

// Tiny write+read+delete against scout_refresh_state to prove the Firestore rules allow the
// scout collections for this account before a long batch is attempted.
export async function probe() {
  try {
    await store.saveRefreshState({ probeAt: Date.now() });
    const st = await store.loadRefreshState();
    return { ok: !!st, state: { hasBreaker: !!st?.breaker, heartbeats: st?.heartbeats || null, probeAt: st?.probeAt } };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function status() {
  const [state, us, eu, survivors, diff] = await Promise.all([
    store.loadRefreshState(), store.loadUniverse("us"), store.loadUniverse("eu"),
    store.loadSurvivors(), store.loadDiff(),
  ]);
  const banner = stalenessBanner(state?.heartbeats, state?.breaker, Date.now());
  return {
    universe: { us: us?.rows?.length ?? 0, eu: eu?.rows?.length ?? 0, enumeratedAt: us?.enumeratedAt ?? null },
    survivors: { count: survivors?.rows?.length ?? 0, refreshedAt: survivors?.refreshedAt ?? null },
    diff: diff?.latest ?? null,
    breaker: state?.breaker ?? null,
    cursor: state?.cursor ?? null,
    heartbeats: state?.heartbeats ?? null,
    banner,
  };
}
