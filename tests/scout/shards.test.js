import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shardOf, paceDelayMs, isStale, isRefusal, breakerStep, canResume, initialBreaker,
  stalenessBanner, REFUSALS_TO_PAUSE,
} from "../../src/lib/scout/shards.js";

const DAY = 86400000;

test("shardOf is stable and spreads across 7 weekdays", () => {
  assert.equal(shardOf("AAPL"), shardOf("aapl")); // case-insensitive
  const counts = Array(7).fill(0);
  for (let i = 0; i < 3500; i++) counts[shardOf(`TICK${i}.ST`)]++;
  for (const c of counts) assert.ok(c > 350 && c < 650, `uneven shard: ${counts}`);
});

test("pacing: 1.2s base plus bounded jitter", () => {
  assert.equal(paceDelayMs(0), 1200);
  assert.equal(paceDelayMs(0.999999), 1999);
});

test("staleness: 6 days normally, 27 for demoted, never-fetched always stale", () => {
  const now = 1e12;
  assert.ok(!isStale(now - 5 * DAY, now));
  assert.ok(isStale(now - 6 * DAY, now));
  assert.ok(!isStale(now - 20 * DAY, now, { demoted: true }));
  assert.ok(isStale(now - 27 * DAY, now, { demoted: true }));
  assert.ok(isStale(null, now));
});

test("refusal signals: 429/403/999, crumb failure, server-error-with-body", () => {
  assert.ok(isRefusal(429, null) && isRefusal(403, null) && isRefusal(999, null));
  assert.ok(isRefusal(200, { error: "Failed to obtain Yahoo crumb" }));
  assert.ok(isRefusal(502, { error: "upstream sad" }));
  assert.ok(!isRefusal(404, { error: "no such ticker" }));
  assert.ok(!isRefusal(200, {}));
});

test("breaker pauses after 3 consecutive refusals and persists reason", () => {
  let s = initialBreaker();
  const now = 1e12;
  for (let i = 0; i < REFUSALS_TO_PAUSE; i++) {
    assert.equal(s.pausedAt, null);
    s = breakerStep(s, "refusal", { nowMs: now, reason: "HTTP 429" });
  }
  assert.equal(s.pausedAt, now);
  assert.equal(s.pauseReason, "HTTP 429");

  // Success fully resets.
  const r = breakerStep(s, "success");
  assert.equal(r.pausedAt, null);
  assert.equal(r.consecutiveRefusals, 0);
});

test("resume backoff: 30min -> 2h -> next day, give up after 3 failed resumes", () => {
  const t0 = 1e12;
  let s = initialBreaker();
  for (let i = 0; i < 3; i++) s = breakerStep(s, "refusal", { nowMs: t0, reason: "HTTP 999" });
  assert.equal(canResume(s, t0 + 10 * 60000), false);       // 10 min: still backing off
  assert.equal(canResume(s, t0 + 31 * 60000), true);        // 31 min: attempt resume
  s = breakerStep(s, "refusal", { nowMs: t0 + 31 * 60000 }); // resume refused (1st)
  assert.equal(canResume(s, t0 + 32 * 60000 + 3600000), false);
  assert.equal(canResume(s, t0 + 31 * 60000 + 2 * 3600000 + 1000), true);
  s = breakerStep(s, "refusal", { nowMs: t0 + 3 * 3600000 }); // 2nd failed resume
  s = breakerStep(s, "refusal", { nowMs: t0 + 4 * 3600000 }); // 3rd failed resume
  assert.equal(canResume(s, t0 + 50 * 3600000), false);      // given up for the day
  assert.equal(canResume(initialBreaker(), t0), null);       // not paused
});

test("staleness banner triggers when the OLDEST heartbeat passes 9 days, carries pause reason", () => {
  const now = 1e12;
  const fresh = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, now - i * DAY]));
  assert.equal(stalenessBanner(fresh, null, now).stale, false);
  const oneOld = { ...fresh, 3: now - 10 * DAY };
  const b = stalenessBanner(oneOld, { pauseReason: "HTTP 429 x3" }, now);
  assert.ok(b.stale);
  assert.equal(b.oldestDays, 10);
  assert.equal(b.reason, "HTTP 429 x3");
  // Missing heartbeats (never completed) read as maximally stale.
  assert.ok(stalenessBanner({}, null, now).stale);
});
