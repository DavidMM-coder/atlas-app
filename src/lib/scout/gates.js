// Scout hard exclusions — what makes this a BUSINESS screener, not a lottery-ticket screener.
// Pure functions over a normalized fundamentals row; every gate returns a machine-readable
// reason so the snapshot diff (and later the alerts feature) can say exactly why a name left.
//
// Normalized row fields used here (null = structurally unavailable, see missing-data rule):
//   priceUSD, addvUSD, revenueTtmUSD, grossMarginTTM (fraction), fcfTtmUSD, totalCashUSD,
//   mcapUSD, exchange/mic, name, industry, goingConcern (bool|null),
//   clinicalStage (bool), catalyst ({name, date:"YYYY-MM-DD"}|null)

export const CAP_MIN_USD = 30e6;
export const CAP_MAX_USD = 600e6;
export function inCapBand(mcapUSD) {
  return Number.isFinite(mcapUSD) && mcapUSD >= CAP_MIN_USD && mcapUSD <= CAP_MAX_USD;
}

// Cash runway in months = cash ÷ trailing quarterly burn, only meaningful when FCF is
// negative. Returns null when FCF is missing, non-negative, or cash is unknown.
export function runwayMonths({ totalCashUSD, fcfTtmUSD }) {
  if (!Number.isFinite(fcfTtmUSD) || fcfTtmUSD >= 0) return null;
  if (!Number.isFinite(totalCashUSD)) return null;
  const quarterlyBurn = -fcfTtmUSD / 4;
  if (quarterlyBurn <= 0) return null;
  return (totalCashUSD / quarterlyBurn) * 3;
}

// SPAC / blank-check / shell heuristics: name patterns plus source-provided industry tags.
// (No SIC feed in the free stack; EDGAR SIC 6770 can be added later if this under-catches.)
const SPAC_NAME_RE = /\b(acquisition\s+(corp|co|company|corporation|holdings?)|blank\s+check|SPAC)\b/i;
const SHELL_INDUSTRY_RE = /(shell|blank\s*check)/i;
export function isSpacOrShell({ name, industry }) {
  if (SPAC_NAME_RE.test(String(name || ""))) return true;
  if (SHELL_INDUSTRY_RE.test(String(industry || ""))) return true;
  return false;
}

// OTC / pink sheets: Finnhub MIC OOTC, Yahoo exchange codes PNK/OTC/OEM/OQB/OQX, or a
// venue string that spells it out.
const OTC_MIC = new Set(["OOTC", "OTCM", "PINX", "PSGM", "OTCB", "OTCQ"]);
const OTC_EXCH_RE = /^(PNK|OTC|OEM|OQB|OQX)$/i;
export function isOtc({ mic, exchange }) {
  if (mic && OTC_MIC.has(String(mic).toUpperCase())) return true;
  if (exchange && (OTC_EXCH_RE.test(String(exchange)) || /\b(OTC|pink)\b/i.test(String(exchange)))) return true;
  return false;
}

export const MIN_PRICE_USD = 1.0;
export const MIN_ADDV_USD = 200_000;
export const MIN_REVENUE_TTM_USD = 10e6;
export const MIN_RUNWAY_MONTHS = 12;
export const CARVEOUT_MIN_RUNWAY_MONTHS = 18;

// The biotech/medtech carve-out: revenue + gross-margin gates are waived for clinical-stage
// names ONLY with >18 months runway AND a dated, named catalyst that is not already in the
// past. Every other gate still applies. `todayISO` injected for testability.
export function carveOutApplies(row, todayISO) {
  if (!row.clinicalStage) return false;
  const rw = runwayMonths(row);
  if (!(Number.isFinite(rw) && rw > CARVEOUT_MIN_RUNWAY_MONTHS)) {
    // A clinical-stage name with POSITIVE FCF has no burn to outrun — runway is effectively
    // infinite, which satisfies the runway arm.
    const fcfPositive = Number.isFinite(row.fcfTtmUSD) && row.fcfTtmUSD >= 0 && Number.isFinite(row.totalCashUSD);
    if (!fcfPositive) return false;
  }
  const c = row.catalyst;
  if (!c || !c.name || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.date || ""))) return false;
  if (todayISO && String(c.date) < todayISO) return false; // stale catalyst
  return true;
}

// Applies every hard exclusion. Returns {pass, reasons, tags}. Gates whose input is null
// SKIP rather than fail — a company is never excluded for data its market doesn't publish
// (same philosophy as the scoring missing-data rule); the screen scores it with nulls.
export function applyGates(row, { todayISO } = {}) {
  const reasons = [];
  const tags = [];
  const carve = carveOutApplies(row, todayISO);

  if (Number.isFinite(row.priceUSD) && row.priceUSD < MIN_PRICE_USD) reasons.push("price-below-1usd");
  if (Number.isFinite(row.addvUSD) && row.addvUSD < MIN_ADDV_USD) reasons.push("dollar-volume-below-200k");
  if (isOtc(row)) reasons.push("otc-pink-sheets");
  if (isSpacOrShell(row)) reasons.push("spac-or-shell");
  if (row.goingConcern === true) reasons.push("going-concern-flag");

  if (carve) {
    tags.push("clinical-stage"); // dossier stage treats this as mandatory extended DD
  } else {
    if (Number.isFinite(row.revenueTtmUSD) && row.revenueTtmUSD < MIN_REVENUE_TTM_USD) reasons.push("revenue-below-10m");
    if (Number.isFinite(row.grossMarginTTM) && row.grossMarginTTM <= 0) reasons.push("gross-margin-non-positive");
  }

  // Runway gate applies to everyone (carve-out names already proved >18mo to get the tag).
  const rw = runwayMonths(row);
  if (rw != null && rw < MIN_RUNWAY_MONTHS) reasons.push("cash-runway-below-12m");

  return { pass: reasons.length === 0, reasons, tags };
}
