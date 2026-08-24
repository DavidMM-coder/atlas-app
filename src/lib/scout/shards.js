// Scout refresh scheduling — pure logic only (no IO, no Date.now() defaults) so every rule
// here is unit-testable. Implements the burst-mitigation spec from docs/scout-data-sourcing.md:
// sharded weekday refresh, stale-only fetching, monthly demotion for out-of-band names, and
// the pause-and-resume circuit breaker with a persisted cursor.

// hash(ticker) % 7 assigns each name a stable weekday shard. djb2 — stable across sessions
// and platforms (no reliance on JS engine string hashing), cheap, and spreads well enough
// that each shard lands within a few percent of universe/7.
export function shardOf(ticker) {
  let h = 5381;
  const s = String(ticker).toUpperCase();
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % 7;
}

// <= 1 request / 1.2s with 0-800ms random jitter. rand is injected (0..1) for testability.
export const PACE_BASE_MS = 1200;
export function paceDelayMs(rand) {
  return PACE_BASE_MS + Math.floor((rand ?? Math.random()) * 800);
}

// Stale-only refresh: skip names fetched < 6 days ago. Names demoted out of the cap band
// recheck monthly (27d — just under 4 weeks so a demoted name still lands on its weekday).
export const STALE_DAYS = 6;
export const DEMOTED_STALE_DAYS = 27;
export function isStale(fetchedAtMs, nowMs, { demoted = false } = {}) {
  if (!Number.isFinite(fetchedAtMs)) return true; // never fetched
  const days = (nowMs - fetchedAtMs) / 86400000;
  return days >= (demoted ? DEMOTED_STALE_DAYS : STALE_DAYS);
}

// Refusal signals per the spec: HTTP 429/403/999, crumb failure, empty-with-error body.
// `body` is the parsed JSON (or null) of a non-ok or suspicious response.
export function isRefusal(status, body) {
  if (status === 429 || status === 403 || status === 999) return true;
  const err = String(body?.error || "");
  if (/crumb/i.test(err)) return true;
  // Yahoo sometimes 200s with an empty result plus an error description.
  if (status >= 500 && err) return true;
  return false;
}

// Circuit breaker as a pure reducer. State shape (persisted to scout_refresh_state):
//   { consecutiveRefusals, pausedAt, pauseReason, resumeAttempts, cursor: {shard, index} }
// After 3 consecutive refusals: pause immediately, persist cursor. Resume backoff
// 30min -> 2h -> next day; give up for the day after 3 failed resumes.
export const REFUSALS_TO_PAUSE = 3;
export const RESUME_BACKOFF_MS = [30 * 60000, 2 * 3600000, 22 * 3600000];
export const MAX_RESUME_ATTEMPTS = 3;

export function initialBreaker() {
  return { consecutiveRefusals: 0, pausedAt: null, pauseReason: null, resumeAttempts: 0 };
}

export function breakerStep(state, event, { nowMs, reason } = {}) {
  const s = { ...(state || initialBreaker()) };
  if (event === "success") {
    s.consecutiveRefusals = 0;
    if (s.pausedAt != null) { s.pausedAt = null; s.pauseReason = null; s.resumeAttempts = 0; }
    return s;
  }
  if (event === "refusal") {
    s.consecutiveRefusals += 1;
    if (s.consecutiveRefusals >= REFUSALS_TO_PAUSE && s.pausedAt == null) {
      s.pausedAt = nowMs;
      s.pauseReason = reason || "repeated refusals";
    } else if (s.pausedAt != null) {
      // A refusal on a resume attempt: count it and re-stamp the pause.
      s.resumeAttempts += 1;
      s.pausedAt = nowMs;
    }
    return s;
  }
  throw new Error(`unknown breaker event: ${event}`);
}

// When may a paused run resume? null = not paused (run freely); false = still backing off
// or given up for the day; true = attempt a resume from the persisted cursor now.
export function canResume(state, nowMs) {
  if (!state || state.pausedAt == null) return null;
  if (state.resumeAttempts >= MAX_RESUME_ATTEMPTS) return false; // give up for the day
  const wait = RESUME_BACKOFF_MS[Math.min(state.resumeAttempts, RESUME_BACKOFF_MS.length - 1)];
  return nowMs - state.pausedAt >= wait;
}

// Per-shard lastCompletedAt heartbeats -> UI staleness banner once the OLDEST heartbeat
// passes 9 days. Returns {stale, oldestDays, reason} — reason carries the persisted pause
// reason verbatim so blockage surfaces as a banner, never as silently missing data.
export const BANNER_STALE_DAYS = 9;
export function stalenessBanner(heartbeats, breaker, nowMs) {
  const stamps = [];
  for (let i = 0; i < 7; i++) stamps.push(Number(heartbeats?.[i]) || 0);
  const oldest = Math.min(...stamps);
  const oldestDays = (nowMs - oldest) / 86400000;
  return {
    stale: oldestDays > BANNER_STALE_DAYS,
    oldestDays: Math.floor(oldestDays),
    reason: breaker?.pauseReason || null,
  };
}
