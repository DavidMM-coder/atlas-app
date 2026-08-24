import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEuronext, normalizeXetra, normalizeLse, normalizeNordic, normalizeUs,
  dedupeByIsin, assembleUniverse,
} from "../../src/lib/scout/universe.js";

test("Euronext CSV: quoted fields, market->suffix mapping, Expert Market dropped", () => {
  const csv = [
    '﻿Name;ISIN;Symbol;Market;Currency;"Open Price"',
    '"European Equities"', '"24 Aug 2026"',
    '"2020 BULKERS";BMG9156K1018;2020;"Oslo Børs";NOK;4.46',
    '74SOFTWARE;FR0011040500;74SW;"Euronext Paris";EUR;39.40',
    '"AALBERTS NV";NL0000852564;AALB;"Euronext Amsterdam";EUR;42.78',
    '"GROWTHCO";FR0000000001;GRW;"Euronext Growth Paris";EUR;5.0',
    '"DEADCO";BE0000000002;DED;"Euronext Expert Market";EUR;1.0',
  ].join("\n");
  const rows = normalizeEuronext(csv);
  const tickers = rows.map((r) => r.ticker);
  assert.deepEqual(tickers, ["2020.OL", "74SW.PA", "AALB.AS", "GRW.PA"]);
  assert.equal(rows[0].currency, "NOK");
  assert.equal(rows[1].mic, "XPAR");
});

test("XETRA CSV: CS type + DE/AT ISINs only, mnemonic + .DE", () => {
  const hdr = ["Product Status","Instrument Status","Instrument","ISIN","Product ID","Instrument ID","WKN","Mnemonic","MIC Code","CCP eligible Code","Trading Model Type","Product Assignment Group","Product Assignment Group Description","Designated Sponsor Member ID","Designated Sponsor","Price Range Value","Price Range Percentage","Minimum Quote Size","Instrument Type","Tick Size 1"];
  const mk = (name, isin, mnem, type) => {
    const r = Array(hdr.length).fill("");
    r[0] = "Active"; r[1] = "Active"; r[2] = name; r[3] = isin; r[7] = mnem; r[8] = "XETR"; r[18] = type;
    return r.join(";");
  };
  const csv = ["Market:;XETR", "Date Last Update:;24.08.2026", hdr.join(";"),
    mk("UNITED INTERNET", "DE0005089031", "UTDI", "CS"),
    mk("APPLE INC", "US0378331005", "APC", "CS"),      // foreign cross-listing -> dropped
    mk("STRABAG SE", "AT000000STR1", "XD4", "CS"),     // Austrian home -> kept
    mk("SOME ETF", "DE0001234561", "ETF1", "EXTF"),    // not common stock
  ].join("\n");
  const rows = normalizeXetra(csv);
  assert.deepEqual(rows.map((r) => r.ticker), ["UTDI.DE", "XD4.DE"]);
});

test("LSE sheet rows: header located by TIDM, trailing-dot TIDMs cleaned, cap hint kept", () => {
  const rows = normalizeLse([
    [], ["Equity Instruments - Shares"], ["As at 31 July 2026"], [],
    ["TIDM", "Issuer Name", "Instrument Name", "ISIN", "MiFIR Identifier Code", "ICB Industry", "ICB Super-Sector Name", "Start Date", "Country of Incorporation", "Trading Currency", "Security Mkt Cap (in £m)", "LSE Market"],
    ["OPM", "1PM PLC", "ORD 10P", "GB00BCDBXK43", "SHRS", "Financials", "Fin Svcs", 41505, "United Kingdom", "GBX", 14.9, "AIM"],
    ["BP.", "BP PLC", "ORD $0.25", "GB0007980591", "SHRS", "Energy", "Energy", 30000, "United Kingdom", "GBX", 80000, "MAIN MARKET"],
  ]);
  assert.deepEqual(rows.map((r) => r.ticker), ["OPM.L", "BP.L"]);
  assert.equal(rows[0].mktCapHintGBPm, 14.9);
  assert.equal(rows[0].segment, "AIM");
});

test("Nordic rows: share-class spaces become dashes, market decides suffix", () => {
  const rows = normalizeNordic(
    [{ symbol: "ACRI B", fullName: "Acrinova AB ser. B", currency: "SEK", isin: "SE0007740680", segment: "Small Cap" }],
    "STO"
  );
  assert.deepEqual(rows.map((r) => r.ticker), ["ACRI-B.ST"]);
  assert.equal(normalizeNordic([{ symbol: "X" }], "ICE").length, 0); // Iceland not covered
});

test("US: Finnhub common stock non-OTC, CIK joined from either EDGAR shape", () => {
  const fh = [
    { symbol: "STIM", description: "NEURONETICS INC", type: "Common Stock", mic: "XNAS", currency: "USD" },
    { symbol: "PINKO", description: "PINK CO", type: "Common Stock", mic: "OOTC" },
    { symbol: "SPY", description: "SPDR S&P 500", type: "ETP", mic: "ARCX" },
  ];
  const viaExchange = normalizeUs(fh, { fields: ["cik", "name", "ticker", "exchange"], data: [[1227636, "NEURONETICS, INC.", "STIM", "Nasdaq"]] });
  assert.equal(viaExchange.length, 1);
  assert.equal(viaExchange[0].cik, 1227636);
  const viaPlain = normalizeUs(fh, { 0: { cik_str: 1227636, ticker: "STIM", title: "Neuronetics" } });
  assert.equal(viaPlain[0].cik, 1227636);
});

test("ISIN dedupe prefers the home venue; assembly attaches stable shards", () => {
  const dupes = [
    { ticker: "SAP.DE", mic: "XETR", isin: "DE0007164600", region: "EU" },
    { ticker: "SAP.PA", mic: "XPAR", isin: "DE0007164600", region: "EU" }, // cross-listing
    { ticker: "AIR.PA", mic: "XPAR", isin: "NL0000235190", region: "EU" }, // Airbus: NL isin, Paris kept (first)
  ];
  const out = dedupeByIsin(dupes);
  assert.deepEqual(out.map((r) => r.ticker).sort(), ["AIR.PA", "SAP.DE"]);

  const uni = assembleUniverse({ us: [{ ticker: "STIM", region: "US" }], eu: dupes });
  assert.equal(uni.length, 3);
  for (const r of uni) assert.ok(r.shard >= 0 && r.shard <= 6);
});
