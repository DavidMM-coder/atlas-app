import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots, flagShortlistGraduations, appendDiffLedger, GRADUATED_FLAG } from "../../src/lib/scout/diff.js";

const prev = [{ ticker: "GRAD" }, { ticker: "GONE" }, { ticker: "GATED" }, { ticker: "STAYS" }, { ticker: "SANK" }];
const next = [{ ticker: "STAYS" }, { ticker: "FRESH" }];
const context = {
  GRAD: { enumerated: true, mcapUSD: 750e6 },
  GONE: { enumerated: false },
  GATED: { enumerated: true, mcapUSD: 200e6, gateReasons: ["dollar-volume-below-200k"] },
  SANK: { enumerated: true, mcapUSD: 12e6 },
};

test("diff classifies graduated / delisted / gate-failed / left-band-low", () => {
  const d = diffSnapshots(prev, next, context);
  assert.deepEqual(d.added, ["FRESH"]);
  const byTicker = Object.fromEntries(d.removed.map((r) => [r.ticker, r.reason]));
  assert.equal(byTicker.GRAD, "graduated");
  assert.equal(byTicker.GONE, "delisted");
  assert.equal(byTicker.GATED, "gate-failed:dollar-volume-below-200k");
  assert.equal(byTicker.SANK, "left-band-low");
  assert.deepEqual(d.graduated, ["GRAD"]);
});

test("shortlisted graduates are flagged, never dropped", () => {
  const d = diffSnapshots(prev, next, context);
  const shortlist = [{ ticker: "GRAD", note: "thesis A" }, { ticker: "STAYS" }];
  const flagged = flagShortlistGraduations(shortlist, d);
  assert.equal(flagged.length, 2);                       // nothing removed
  assert.equal(flagged[0].flag, GRADUATED_FLAG);
  assert.equal(flagged[0].note, "thesis A");             // entry preserved
  assert.equal(flagged[1].flag, undefined);
});

test("diff ledger accumulates newest-first and caps", () => {
  const d = diffSnapshots(prev, next, context);
  let ledger = appendDiffLedger([], d, "2026-08-25");
  assert.equal(ledger.length, 4);
  assert.equal(ledger[0].date, "2026-08-25");
  ledger = appendDiffLedger(ledger, d, "2026-09-01", 6);
  assert.equal(ledger.length, 6);                        // capped
  assert.equal(ledger[0].date, "2026-09-01");
});
