// Snapshot diff — every weekly refresh records WHY each name left the ranked universe
// (graduated up, fell out of band, failed a quality gate, delisted). The alerts feature
// consumes these entries; the shortlist uses them to flag graduations instead of silently
// dropping names.

import { CAP_MAX_USD, CAP_MIN_USD } from "./gates.js";

// prev/next: survivor snapshots [{ticker, mcapUSD, ...}]. context maps a ticker that is in
// prev but NOT in next to what we know about it this refresh:
//   { enumerated: bool, mcapUSD, gateReasons: [] }
export function diffSnapshots(prev, next, context = {}) {
  const nextSet = new Set((next || []).map((r) => r.ticker));
  const prevSet = new Set((prev || []).map((r) => r.ticker));
  const added = (next || []).filter((r) => !prevSet.has(r.ticker)).map((r) => r.ticker);
  const removed = [];
  for (const r of prev || []) {
    if (nextSet.has(r.ticker)) continue;
    const c = context[r.ticker] || {};
    let reason;
    if (c.enumerated === false) reason = "delisted";
    else if (Number.isFinite(c.mcapUSD) && c.mcapUSD > CAP_MAX_USD) reason = "graduated";
    else if (Number.isFinite(c.mcapUSD) && c.mcapUSD < CAP_MIN_USD) reason = "left-band-low";
    else if (Array.isArray(c.gateReasons) && c.gateReasons.length) reason = `gate-failed:${c.gateReasons.join(",")}`;
    else reason = "unknown";
    removed.push({ ticker: r.ticker, reason, mcapUSD: c.mcapUSD ?? null });
  }
  return { added, removed, graduated: removed.filter((r) => r.reason === "graduated").map((r) => r.ticker) };
}

export const GRADUATED_FLAG = "GRADUATED — thesis may have played out, reassess";

// Shortlisted names are NEVER silently dropped: a graduation attaches the flag; the entry
// stays visible. Returns a new shortlist array (input untouched).
export function flagShortlistGraduations(shortlist, diff) {
  const grads = new Set(diff?.graduated || []);
  return (shortlist || []).map((e) =>
    grads.has(e.ticker) ? { ...e, flag: GRADUATED_FLAG, flaggedAt: diff.date || null } : e
  );
}

// Rolling exit ledger stored on the diff doc — newest first, capped so the doc stays far
// under Firestore's 1MB limit.
export function appendDiffLedger(ledger, diff, dateISO, cap = 600) {
  const entries = (diff.removed || []).map((r) => ({ date: dateISO, ...r }));
  return [...entries, ...(ledger || [])].slice(0, cap);
}
