// Universe assembly — normalizes each venue's instrument feed into one shape and merges,
// dedupes, and shard-assigns. Pure: raw payloads in, rows out (fetching lives in the API
// layer / runner). Row shape:
//   { ticker (Yahoo-resolvable), name, mic, region: "US"|"EU", currency, isin?, cik?, segment? }

import { shardOf } from "./shards.js";

// MIC -> Yahoo suffix for the European venues the investigation confirmed.
export const MIC_SUFFIX = {
  XPAR: ".PA", ALXP: ".PA", XMLI: ".PA",          // Paris + Growth + Access
  XAMS: ".AS",                                     // Amsterdam
  XBRU: ".BR", ALXB: ".BR", MLXB: ".BR",          // Brussels
  XLIS: ".LS", ALXL: ".LS",                        // Lisbon
  XOSL: ".OL", XOAS: ".OL", MERK: ".OL",           // Oslo Børs + Expand + Merkur
  XLON: ".L",                                      // London
  XETR: ".DE",                                     // XETRA
  XSTO: ".ST", XHEL: ".HE", XCSE: ".CO",           // Nasdaq Nordic
};

// Euronext market label -> MIC (their CSV reports display names, not MICs).
const EURONEXT_MARKET_MIC = [
  [/growth paris|access paris/i, "XPAR"], [/paris/i, "XPAR"],
  [/amsterdam/i, "XAMS"],
  [/growth brussels|access brussels/i, "XBRU"], [/brussels/i, "XBRU"],
  [/growth lisbon|access lisbon/i, "XLIS"], [/lisbon/i, "XLIS"],
  [/growth oslo|expand oslo|oslo/i, "XOSL"],
];

const cleanName = (s) => String(s || "").replace(/^"|"$/g, "").trim();

// Euronext equities CSV (semicolon-separated, 4 preamble/junk lines, quoted fields):
// Name;ISIN;Symbol;Market;Currency;...
export function normalizeEuronext(csvText) {
  const out = [];
  for (const line of String(csvText).split(/\r?\n/)) {
    const parts = line.split(";").map(cleanName);
    if (parts.length < 5) continue;
    const [name, isin, symbol, market, currency] = parts;
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) continue; // header/preamble rows
    if (!symbol || /expert market/i.test(market)) continue; // Expert Market = unlisted/auction
    const micEntry = EURONEXT_MARKET_MIC.find(([re]) => re.test(market));
    if (!micEntry) continue; // multi-listing rows like "Brussels, Paris" resolve via first market later
    const mic = micEntry[1];
    out.push({ ticker: symbol.toUpperCase() + MIC_SUFFIX[mic], name, mic, region: "EU", currency, isin });
  }
  return out;
}

// XETRA t7-xetr-allTradableInstruments.CSV: 2 metadata lines, then a semicolon header row.
// Filter to instrument type CS (common stock) AND German/Austrian ISINs — the file lists
// ~700 US and other foreign cross-listings as CS too, and those names' home listings come in
// through the other legs. (Austrian names are kept: Wiener Börse isn't an evaluated venue,
// so their XETRA line is the covered listing — same "key to XETRA" logic as gettex names.)
// Mnemonic is the Yahoo symbol on .DE.
export function normalizeXetra(csvText) {
  const lines = String(csvText).split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^Product Status;/i.test(l));
  if (headerIdx < 0) return [];
  const header = lines[headerIdx].split(";");
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const cIsin = col("ISIN"), cName = col("Instrument"), cMnem = col("Mnemonic"),
    cType = col("Instrument Type"), cCcy = col("Settlement Currency"), cStatus = 0;
  const out = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const p = line.split(";");
    if (p.length < header.length - 2) continue;
    if (!/^active$/i.test(String(p[cStatus] || "").trim())) continue;
    if (cType >= 0 && String(p[cType]).trim() !== "CS") continue;
    const mnem = String(p[cMnem] || "").trim();
    const isin = String(p[cIsin] || "").trim();
    if (!mnem || !/^(DE|AT)[A-Z0-9]{9}\d$/.test(isin)) continue;
    out.push({
      ticker: mnem.toUpperCase() + ".DE", name: cleanName(p[cName]), mic: "XETR",
      region: "EU", currency: cCcy >= 0 && p[cCcy] ? String(p[cCcy]).trim() : "EUR", isin,
    });
  }
  return out;
}

// LSE "Instrument list_N.xlsx", sheet "1.1 Shares", as row-arrays (header row located by
// TIDM). Includes a Security Mkt Cap (£m) column we keep as a pre-filter hint.
export function normalizeLse(sheetRows) {
  const headerIdx = sheetRows.findIndex((r) => Array.isArray(r) && r[0] === "TIDM");
  if (headerIdx < 0) return [];
  const header = sheetRows[headerIdx].map((h) => String(h || "").trim());
  const col = (re) => header.findIndex((h) => re.test(h));
  const cTidm = 0, cIssuer = col(/^Issuer Name$/i), cIsin = col(/^ISIN$/i),
    cCcy = col(/Trading Currency/i), cCap = col(/Mkt Cap/i), cMarket = col(/^LSE Market$/i);
  const out = [];
  for (const r of sheetRows.slice(headerIdx + 1)) {
    if (!Array.isArray(r) || !r[cTidm]) continue;
    const tidm = String(r[cTidm]).trim().toUpperCase();
    if (!tidm || tidm.length > 4) continue;
    const isin = String(r[cIsin] || "").trim();
    out.push({
      // Yahoo drops trailing dots from TIDMs like "BP." -> BP.L
      ticker: tidm.replace(/\.+$/, "") + ".L",
      name: cleanName(r[cIssuer]), mic: "XLON", region: "EU",
      currency: String(r[cCcy] || "GBX").trim(), isin,
      mktCapHintGBPm: Number(r[cCap]) || null,
      segment: cMarket >= 0 ? String(r[cMarket] || "").trim() : null,
    });
  }
  return out;
}

// Nasdaq Nordic screener/shares JSON rows for one (market, category) query. The API omits
// venue info on rows, so the caller passes the market it queried (STO/HEL/CPH).
const NORDIC_MARKET_MIC = { STO: "XSTO", HEL: "XHEL", CPH: "XCSE" };
export function normalizeNordic(rows, market) {
  const mic = NORDIC_MARKET_MIC[market];
  if (!mic) return [];
  const out = [];
  for (const r of rows || []) {
    const sym = String(r.symbol || "").trim();
    if (!sym) continue;
    out.push({
      // Yahoo encodes Nordic share-class spaces as dashes: "ACRI B" -> ACRI-B.ST
      ticker: sym.replace(/ /g, "-").toUpperCase() + MIC_SUFFIX[mic],
      name: cleanName(r.fullName), mic, region: "EU",
      currency: String(r.currency || "").trim() || null, isin: r.isin || null,
      segment: r.segment || null,
    });
  }
  return out;
}

// US: Finnhub /stock/symbol filtered to listed common stock, CIKs joined from EDGAR
// company_tickers(_exchange).json for the Form 4 pipeline.
export function normalizeUs(finnhubSymbols, edgarTickers) {
  const cikByTicker = {};
  // EDGAR ships two shapes: {fields, data:[[cik,name,ticker,exchange]]} or {N:{cik_str,ticker,title}}.
  if (edgarTickers?.fields && Array.isArray(edgarTickers.data)) {
    const ti = edgarTickers.fields.indexOf("ticker"), ci = edgarTickers.fields.indexOf("cik");
    for (const row of edgarTickers.data) cikByTicker[String(row[ti]).toUpperCase()] = row[ci];
  } else if (edgarTickers) {
    for (const e of Object.values(edgarTickers)) {
      if (e?.ticker) cikByTicker[String(e.ticker).toUpperCase()] = e.cik_str;
    }
  }
  const out = [];
  for (const s of finnhubSymbols || []) {
    if (s.type !== "Common Stock") continue;
    if (!s.mic || s.mic === "OOTC") continue; // OTC/pink excluded at the door
    const t = String(s.symbol || "").toUpperCase();
    if (!t || /[+=^]/.test(t)) continue;
    out.push({
      ticker: t, name: cleanName(s.description), mic: s.mic, region: "US",
      currency: s.currency || "USD", isin: s.isin || null, cik: cikByTicker[t] ?? null,
    });
  }
  return out;
}

// Cross-venue dedupe by ISIN, preferring the listing whose venue matches the ISIN's home
// country (a German name also tradable on XETRA keys to its home venue; gettex isn't covered
// anywhere, so German names key to XETRA per the design doc).
const ISIN_HOME_MIC = {
  FR: ["XPAR"], NL: ["XAMS"], BE: ["XBRU"], PT: ["XLIS"], NO: ["XOSL"],
  GB: ["XLON"], DE: ["XETR"], SE: ["XSTO"], FI: ["XHEL"], DK: ["XCSE"],
};
export function dedupeByIsin(rows) {
  const byIsin = new Map();
  const noIsin = [];
  for (const r of rows) {
    if (!r.isin) { noIsin.push(r); continue; }
    const prev = byIsin.get(r.isin);
    if (!prev) { byIsin.set(r.isin, r); continue; }
    const home = ISIN_HOME_MIC[r.isin.slice(0, 2)] || [];
    const rHome = home.includes(r.mic), pHome = home.includes(prev.mic);
    if (rHome && !pHome) byIsin.set(r.isin, r);
  }
  return [...byIsin.values(), ...noIsin];
}

// Final assembly: merge regions, dedupe, attach shard assignment.
export function assembleUniverse({ us = [], eu = [] }) {
  const merged = [...us, ...dedupeByIsin(eu)];
  const seen = new Set();
  const out = [];
  for (const r of merged) {
    if (seen.has(r.ticker)) continue;
    seen.add(r.ticker);
    out.push({ ...r, shard: shardOf(r.ticker) });
  }
  return out;
}
