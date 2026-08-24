// Scout Firestore persistence. Collections per docs/scout-data-sourcing.md:
//   scout_universe/{us|eu}      enumerated rows + per-name fetch/cap state
//   scout_universe/survivors    post-gate scored snapshot (what the screener renders)
//   scout_universe/diff         exit ledger (graduations, gate failures, delistings)
//   scout_fundamentals/{ticker} normalized fundamentals for screen survivors
//   scout_insiders/{ticker}     Form 4 P/S rows (US only)
//   scout_refresh_state/state   cursor + circuit breaker + per-shard heartbeats
//   scout_refresh_state/catalysts  curated {ticker: {name, date}} for the biotech carve-out
// All owner-only via firestore.rules. Every write stamps refreshedAt/fetchedAt so the
// screener can always render from cache and reason about staleness — it never blocks on a
// fetch.
import { db } from "../../firebase.js";
import {
  doc, getDoc, setDoc, getDocs, collection, deleteDoc,
} from "firebase/firestore";

const ok = () => { if (!db) throw new Error("Firestore not configured"); };

async function load(path, id) {
  ok();
  const snap = await getDoc(doc(db, path, id));
  return snap.exists() ? snap.data() : null;
}
async function save(path, id, data, { merge = false } = {}) {
  ok();
  await setDoc(doc(db, path, id), data, { merge });
  return true;
}

export const loadUniverse = (region) => load("scout_universe", region);
export const saveUniverse = (region, rows, extra = {}) =>
  save("scout_universe", region, { rows, refreshedAt: Date.now(), ...extra });

export const loadSurvivors = () => load("scout_universe", "survivors");
export const saveSurvivors = (rows, extra = {}) =>
  save("scout_universe", "survivors", { rows, refreshedAt: Date.now(), ...extra });

export const loadDiff = () => load("scout_universe", "diff");
export const saveDiff = (data) => save("scout_universe", "diff", data);

export const loadRefreshState = () => load("scout_refresh_state", "state");
export const saveRefreshState = (patch) =>
  save("scout_refresh_state", "state", { ...patch, updatedAt: Date.now() }, { merge: true });

export const loadCatalysts = async () => (await load("scout_refresh_state", "catalysts")) || {};

export const loadFundamentals = (ticker) => load("scout_fundamentals", ticker);
export const saveFundamentals = (ticker, data) =>
  save("scout_fundamentals", ticker, { ...data, fetchedAt: Date.now() });
export const deleteFundamentals = async (ticker) => { ok(); await deleteDoc(doc(db, "scout_fundamentals", ticker)); };

export async function loadAllFundamentals() {
  ok();
  const snap = await getDocs(collection(db, "scout_fundamentals"));
  const out = {};
  for (const d of snap.docs) out[d.id] = d.data();
  return out;
}

export const loadInsiders = (ticker) => load("scout_insiders", ticker);
export async function loadAllInsiders() {
  ok();
  const snap = await getDocs(collection(db, "scout_insiders"));
  const out = {};
  for (const d of snap.docs) out[d.id] = d.data();
  return out;
}

// Merge-append Form 4 transactions, deduped on (date, owner, code, shares) — the weekly
// batch re-reads recent daily indexes, so overlap is normal. Keeps a rolling 9 months:
// enough for the 6-month flow window plus slack, and bounded well under the doc cap.
export async function appendInsiders(ticker, transactions) {
  ok();
  const existing = (await loadInsiders(ticker))?.transactions || [];
  const key = (t) => `${t.date}|${t.owner}|${t.code}|${t.shares}`;
  const seen = new Set(existing.map(key));
  const fresh = (transactions || []).filter((t) => !seen.has(key(t)));
  if (!fresh.length && existing.length) {
    await save("scout_insiders", ticker, { fetchedAt: Date.now() }, { merge: true });
    return 0;
  }
  const cutoff = new Date(Date.now() - 270 * 86400000).toISOString().slice(0, 10);
  const merged = [...existing, ...fresh]
    .filter((t) => t.date && t.date >= cutoff)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  await save("scout_insiders", ticker, { transactions: merged, fetchedAt: Date.now() });
  return fresh.length;
}
