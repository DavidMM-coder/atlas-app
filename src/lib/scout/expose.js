// Console/debug surface for the Scout data layer — the batch runner is driven from the
// browser (signed in, so Firestore rules apply) until the Scout UI ships. No UI imports
// this; it only hangs the runner off window, same pattern as atlasDebugCloudDoc.
//
//   await atlasScout.probe()                          — verify Firestore rules allow scout_*
//   await atlasScout.enumerate()                      — (re)build the enumerated universe
//   await atlasScout.runShard({ shard: 3, maxNames: 25 })  — refresh one weekday shard
//   await atlasScout.runForm4Batch({ days: 7 })       — EDGAR insider batch (US)
//   await atlasScout.rescore()                        — gates + scores from cache only
//   await atlasScout.status()                         — heartbeats, breaker, snapshot sizes
import * as runner from "./runner.js";

if (typeof window !== "undefined") {
  window.atlasScout = {
    probe: runner.probe,
    enumerate: runner.enumerate,
    runShard: runner.runShard,
    runForm4Batch: runner.runForm4Batch,
    rescore: runner.rescore,
    status: runner.status,
  };
}
