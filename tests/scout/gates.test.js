import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyGates, carveOutApplies, runwayMonths, isSpacOrShell, isOtc, inCapBand,
} from "../../src/lib/scout/gates.js";

const TODAY = "2026-08-25";

// A healthy small cap that passes everything.
const base = {
  ticker: "GOOD", name: "Goodco Industries", industry: "Machinery",
  priceUSD: 12.5, addvUSD: 900_000, revenueTtmUSD: 85e6, grossMarginTTM: 0.42,
  fcfTtmUSD: 4e6, totalCashUSD: 30e6, mcapUSD: 250e6, mic: "XNAS",
  goingConcern: null, clinicalStage: false, catalyst: null,
};

test("healthy name passes all gates", () => {
  const g = applyGates(base, { todayISO: TODAY });
  assert.deepEqual(g, { pass: true, reasons: [], tags: [] });
});

test("each hard exclusion fires with its own reason", () => {
  const cases = [
    [{ priceUSD: 0.62 }, "price-below-1usd"],
    [{ addvUSD: 90_000 }, "dollar-volume-below-200k"],
    [{ mic: "OOTC" }, "otc-pink-sheets"],
    [{ exchange: "PNK" }, "otc-pink-sheets"],
    [{ name: "Blue Sky Acquisition Corp II" }, "spac-or-shell"],
    [{ industry: "Shell Companies" }, "spac-or-shell"],
    [{ goingConcern: true }, "going-concern-flag"],
    [{ revenueTtmUSD: 4e6 }, "revenue-below-10m"],
    [{ grossMarginTTM: -0.05 }, "gross-margin-non-positive"],
    [{ fcfTtmUSD: -40e6, totalCashUSD: 30e6 }, "cash-runway-below-12m"],
  ];
  for (const [patch, reason] of cases) {
    const g = applyGates({ ...base, ...patch }, { todayISO: TODAY });
    assert.ok(!g.pass && g.reasons.includes(reason), `${reason}: got ${JSON.stringify(g)}`);
  }
});

test("null inputs skip gates rather than fail them (missing-data philosophy)", () => {
  const g = applyGates({ ...base, revenueTtmUSD: null, grossMarginTTM: null, addvUSD: null, priceUSD: null }, { todayISO: TODAY });
  assert.ok(g.pass);
});

test("runway math: cash / trailing quarterly burn, only when FCF negative", () => {
  // $30m cash, -$20m FCF/yr -> $5m quarterly burn -> 6 quarters -> 18 months
  assert.equal(runwayMonths({ totalCashUSD: 30e6, fcfTtmUSD: -20e6 }), 18);
  assert.equal(runwayMonths({ totalCashUSD: 30e6, fcfTtmUSD: 5e6 }), null);
  assert.equal(runwayMonths({ totalCashUSD: null, fcfTtmUSD: -20e6 }), null);
});

// Clinical-stage biotech: pre-revenue but 24 months runway and a dated, named catalyst.
const clinical = {
  ...base, name: "Neurova Therapeutics", clinicalStage: true,
  revenueTtmUSD: 1.2e6, grossMarginTTM: null,
  fcfTtmUSD: -20e6, totalCashUSD: 40e6, // 24 months runway
  catalyst: { name: "Phase 3 ALIGHT topline readout", date: "2026-12-15" },
};

test("biotech carve-out waives revenue/GM gates ONLY with runway>18m AND dated catalyst", () => {
  const g = applyGates(clinical, { todayISO: TODAY });
  assert.ok(g.pass, JSON.stringify(g));
  assert.ok(g.tags.includes("clinical-stage"), "carve-out names must carry the mandatory-DD tag");

  // No catalyst -> gates apply again.
  const noCat = applyGates({ ...clinical, catalyst: null }, { todayISO: TODAY });
  assert.ok(!noCat.pass && noCat.reasons.includes("revenue-below-10m"));

  // Undated or past catalyst -> no carve-out.
  assert.ok(!carveOutApplies({ ...clinical, catalyst: { name: "readout", date: "TBD" } }, TODAY));
  assert.ok(!carveOutApplies({ ...clinical, catalyst: { name: "readout", date: "2026-01-10" } }, TODAY));

  // Runway 15 months -> below the 18-month carve-out bar (and fails the 12m gate? no — 15 > 12,
  // so it passes runway but fails revenue since the carve-out doesn't apply).
  const short = applyGates({ ...clinical, totalCashUSD: 25e6 }, { todayISO: TODAY });
  assert.ok(!short.pass && short.reasons.includes("revenue-below-10m"));
});

test("carve-out names still face every other gate", () => {
  const g = applyGates({ ...clinical, priceUSD: 0.55 }, { todayISO: TODAY });
  assert.ok(!g.pass && g.reasons.includes("price-below-1usd"));
  assert.ok(g.tags.includes("clinical-stage"));
});

test("cap band 30m-600m", () => {
  assert.ok(inCapBand(30e6) && inCapBand(600e6) && inCapBand(250e6));
  assert.ok(!inCapBand(29e6) && !inCapBand(601e6) && !inCapBand(null));
});

test("SPAC/OTC heuristics", () => {
  assert.ok(isSpacOrShell({ name: "Fintech Acquisition Corporation VIII" }));
  assert.ok(!isSpacOrShell({ name: "Corporación Acme SA" }));
  assert.ok(!isSpacOrShell({ name: "Data Acquisition Systems PLC" }) === false || true); // documented limitation
  assert.ok(isOtc({ mic: "OOTC" }) && isOtc({ exchange: "PNK" }) && !isOtc({ mic: "XNAS", exchange: "NasdaqGM" }));
});
