import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";
import AuthScreen from "./Auth.jsx";
import TrackRecord from "./TrackRecord.jsx";
import { auth, onAuthStateChanged, signOut, saveUserToFirestore, loadUserData, saveUserData, savePickHistory, loadPickHistory } from "./firebase.js";
import { API_BASE, apiUrl } from "./lib/api.js";
import { color as c, font, type, radius, shadow, space, scoreColor, grade, actionColor } from "./ui/tokens.js";

// Loaded on demand: the backtester is a whole screen most sessions never open, and xlsx is a
// ~400KB parser only needed the moment a spreadsheet is actually imported. Keeping both out
// of the entry chunk cuts the initial download for every visit.
const Backtester = lazy(() => import("./Backtester.jsx"));
import {
  AtlasStyles, AtlasMotionProvider, AtlasMark, Overline, Text,
  Button, IconButton, Card, Divider, Input, TextArea, Field, Select,
  SegmentedControl, Tabs, Badge, Tag, CallChip, AnimatedNumber, ScoreRing, MeterBar,
  StatTile, MetricTable, Sparkline, InfoTip, Spinner, Skeleton, LoadingBlock,
  ErrorBanner, EmptyState, Modal, SlideOver, motion, AnimatePresence,
} from "./ui/primitives.jsx";
import { fetchHistoricalStats, historicalStatsText, runBuyAndHold, calcStats, backtestSmaCrossover } from "./lib/marketStats.js";

// Catches a render error in whichever screen is active and shows a recoverable message instead
// of letting it unmount the entire app (React's default with no error boundary is a blank page).
class ScreenErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("Screen render error:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <Card>
          <EmptyState
            title="This screen hit a snag"
            hint={this.state.error?.message || "Something didn't render right. Try again, or switch tabs."}
            action={<Button onClick={() => this.setState({ error: null })}>Try again</Button>}
          />
        </Card>
      );
    }
    return this.props.children;
  }
}

// The four main screens are built as plain inline JSX in VerdictApp's own render body (not
// separate components React can defer), so any inline expression that throws while CONSTRUCTING
// the active tab's tree — e.g. holdings.map() or result.pillars.x on an unexpected shape — throws
// synchronously out of VerdictApp itself, before React ever gets to ScreenErrorBoundary below.
// That's the "black screen, can't even click nav" failure: the whole component call throws, so
// nothing renders at all, not even the boundary. Catching it right here, at construction time,
// is what actually contains it to the one broken screen.
function renderSafely(label, build) {
  try { return build(); }
  catch (e) {
    console.error(`${label} screen failed to render:`, e);
    return (
      <Card>
        <EmptyState title="This screen hit a snag" hint={e?.message || "Something didn't render right. Try switching tabs and back."} />
      </Card>
    );
  }
}

// ============================================================
//  ATLAS — "Obsidian" build
//  Dark, premium fintech. Discover / Portfolio / Research / Backtest.
//  Presentation rebuilt on the central design system; all data,
//  state, prompts and API logic preserved unchanged.
// ============================================================

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

// ---------- glossary + tooltip ----------
const GLOSSARY = {
  "P/E Ratio": "Price-to-Earnings. How much you're paying per $1 of profit. A P/E of 20 means you pay $20 for every $1 the company earns. Lower can mean cheaper — but very low P/E can also mean the market expects trouble ahead.",
  "P/B Ratio": "Price-to-Book. Compares the stock price to the company's net assets. Below 1.0 means the stock trades for less than what the company owns — often a value signal.",
  "CAGR": "Compound Annual Growth Rate. The smoothed yearly return if your investment grew at a steady pace. $10,000 becoming $16,000 in 5 years = 9.9% CAGR.",
  "Sharpe Ratio": "Return per unit of risk. Above 1.0 is decent, above 2.0 is excellent. A high Sharpe means you're getting good returns without wild swings.",
  "Max Drawdown": "The biggest drop from a peak before recovering. If your portfolio hit $15k then fell to $9k, that's a 40% drawdown. Shows the worst pain you'd have felt.",
  "RSI": "Relative Strength Index (0–100). Above 70 = overbought (may pull back). Below 30 = oversold (may bounce). A momentum gauge, not a guarantee.",
  "SMA": "Simple Moving Average. The average closing price over N days. The 200-day SMA is widely watched — price above it = uptrend, below = downtrend.",
  "EPS": "Earnings Per Share. The company's profit divided by its share count. Growing EPS = growing profitability. Declining EPS = a warning sign.",
  "Dividend Yield": "Annual dividend as a % of the stock price. A 4% yield on a $100 stock means you receive $4/year just for owning it, regardless of price movement.",
  "Volatility": "How wildly the price swings. High = big ups and downs. Low = steadier ride. Neither is inherently good — it depends on your risk tolerance.",
  "Market Cap": "Total value of all shares. Large-cap (>$10B) = established companies. Mid-cap ($2–10B) = growth stage. Small-cap (<$2B) = higher risk, higher potential.",
  "Beta": "How much a stock moves relative to the market. Beta of 1.5 means it typically moves 50% more than the market — up or down.",
  "Total Return": "How much your investment grew overall, including price gains and any dividends reinvested. The most honest single performance number.",
};
// Fuzzy-matches a dossier metric label ("P/E (TTM)", "RSI (14d) + interpretation", "3yr EPS
// CAGR") to a glossary entry so beginners get a plain-English explainer on hover — the glossary
// existed but was never wired into the dossier tables before.
const GLOSSARY_MATCHERS = [
  ["p/e", "P/E Ratio"], ["p/b", "P/B Ratio"], ["price/book", "P/B Ratio"], ["cagr", "CAGR"],
  ["sharpe", "Sharpe Ratio"], ["drawdown", "Max Drawdown"], ["rsi", "RSI"], ["sma", "SMA"],
  ["moving average", "SMA"], ["dividend yield", "Dividend Yield"], ["volatility", "Volatility"],
  ["market cap", "Market Cap"], ["beta", "Beta"], ["total return", "Total Return"], ["eps", "EPS"],
];
function GlossLabel({ text }) {
  const l = String(text).toLowerCase();
  const hit = GLOSSARY_MATCHERS.find(([needle]) => l.includes(needle));
  if (!hit) return text;
  return <InfoTip title={hit[1]} body={GLOSSARY[hit[1]]}><span>{text}</span></InfoTip>;
}

// ---------- onboarding steps (unchanged data) ----------
const STEPS = [
  { id: "name", kind: "text", title: "First — what should we call you?", sub: "This builds your investor profile. Atlas scores every stock and every holding against it.", ph: "Your name" },
  { id: "riskTolerance", kind: "choice", title: "How much risk can you stomach?", opts: [
    { v: "Conservative", note: "Protect what I have" }, { v: "Moderate", note: "Balanced" }, { v: "Aggressive", note: "Swing for growth" } ] },
  { id: "horizon", kind: "choice", title: "When will you likely need this money?", opts: [
    { v: "Short", note: "Under 1 year" }, { v: "Medium", note: "1 – 5 years" }, { v: "Long", note: "5 years or more" } ] },
  { id: "budget", kind: "choice", title: "Roughly how much are you investing?", sub: "Shapes how Atlas thinks about position sizing.", opts: [
    { v: "Under $1k" }, { v: "$1k – 10k" }, { v: "$10k – 50k" }, { v: "$50k – 250k" }, { v: "$250k +" } ] },
  { id: "goal", kind: "choice", title: "What are you mainly after?", opts: [
    { v: "Preserve capital", note: "Safety over upside" }, { v: "Income & dividends", note: "Steady cash" },
    { v: "Balanced growth", note: "Grow steadily" }, { v: "Aggressive growth", note: "Maximize upside" } ] },
  { id: "philosophy", kind: "choice", title: "Which style feels most like you?", sub: "There's no wrong answer — it tells Atlas what 'good' means to you.", opts: [
    { v: "Value", note: "Buy cheap, be patient" }, { v: "Growth", note: "Pay up for growth" },
    { v: "Quality", note: "Great businesses, fair price" }, { v: "Momentum", note: "Ride strength" },
    { v: "Dividends / income", note: "Get paid to wait" }, { v: "No strong style", note: "Open to all" } ] },
  { id: "targetReturn", kind: "choice", title: "What yearly return would make you happy?", sub: "Helps Atlas keep your expectations and risk in sync.", opts: [
    { v: "Safety first (~5%)", note: "Beat inflation" }, { v: "Solid (8–12%)", note: "Market-like" },
    { v: "Ambitious (15–20%)", note: "Beat the market" }, { v: "Swing big (20%+)", note: "High risk, high reward" } ] },
  { id: "positionConviction", kind: "choice", title: "How concentrated do you like to be?", opts: [
    { v: "Spread across many", note: "Lots of small bets" }, { v: "Balanced mix", note: "A handful of positions" },
    { v: "Few high-conviction bets", note: "Go big on best ideas" } ] },
  { id: "activityLevel", kind: "choice", title: "How hands-on do you want to be?", opts: [
    { v: "Set and forget", note: "Rarely check" }, { v: "Check now and then", note: "Monthly-ish" },
    { v: "Active", note: "Weekly" }, { v: "Very hands-on", note: "Daily" } ] },
  { id: "experience", kind: "choice", title: "How experienced are you?", opts: [
    { v: "New", note: "Just starting" }, { v: "Some", note: "A few years in" },
    { v: "Experienced", note: "Comfortable & active" }, { v: "Professional", note: "I do this seriously" } ] },
  { id: "drawdownReaction", kind: "choice", title: "A holding drops 20% in a month. You…", sub: "Your real risk tolerance often differs from what you'd guess.", opts: [
    { v: "Sell most of it", note: "Cut the loss" }, { v: "Trim a little", note: "Reduce exposure" },
    { v: "Hold", note: "Ride it out" }, { v: "Buy more", note: "Average down" } ] },
  { id: "incomeStability", kind: "choice", title: "How stable is your income?", opts: [
    { v: "Stable", note: "Reliable paycheck" }, { v: "Somewhat variable", note: "It moves around" }, { v: "Unpredictable", note: "Lumpy or uncertain" } ] },
  { id: "emergencyFund", kind: "choice", title: "Do you have a separate emergency fund?", sub: "So Atlas knows how much risk is actually prudent for you.", opts: [
    { v: "Yes, fully", note: "Several months saved" }, { v: "Partly", note: "Building it" }, { v: "No", note: "This is most of my cash" } ] },
  { id: "region", kind: "choice", title: "Any home-market preference?", opts: [
    { v: "United States" }, { v: "Europe" }, { v: "Global mix" }, { v: "No preference" } ] },
  { id: "interests", kind: "multi", title: "Any sectors you're drawn to?", sub: "Optional. Atlas will lean toward these.", opts: ["Technology", "Energy", "Healthcare", "Financials", "Consumer", "Industrials", "Materials", "Real estate", "Utilities", "Communications"] },
  { id: "avoid", kind: "multi", title: "Anything you'd rather not own?", sub: "Optional. Atlas will exclude and flag these.", opts: ["Tobacco", "Weapons", "Fossil fuels", "Gambling", "Alcohol", "Adult"] },
  { id: "intentions", kind: "longtext", title: "In your own words — what are you really trying to achieve?", sub: "Optional, but this is the single best way to make Atlas's read accurate. e.g. 'Build a retirement nest egg I won't touch for 20 years' or 'grow $5k aggressively, I can afford to lose it.'", ph: "Type as much or as little as you like…", optional: true },
];
// chapters for the onboarding progress spine
const CHAPTERS = [
  { label: "Profile", start: 0, end: 0 },
  { label: "Risk & horizon", start: 1, end: 2 },
  { label: "Goals & returns", start: 3, end: 6 },
  { label: "Style & experience", start: 7, end: 12 },
  { label: "Preferences", start: 13, end: 16 },
];

const DOSSIER_TABS = ["Fundamentals", "Technicals", "Risk", "News", "Catalysts", "Your fit"];
const LOADING_MSGS = ["Pulling real financials and balance sheet…", "Reading your computed price history & technicals…", "Reviewing recent news and sentiment…", "Weighing valuation and risk…", "Matching everything to your profile…", "Writing the full dossier…"];

// ---------- helpers (unchanged) ----------
// Locale-aware numeric parse for spreadsheet imports. The old version stripped everything except
// digits/dot/minus, which silently corrupted European-formatted numbers: "1.234,56" (€1,234.56)
// became 1.23456. Detect the decimal separator instead of assuming it's always ".".
function parseNum(x) {
  if (x == null) return null;
  let s = String(x).trim().replace(/[^0-9.,\-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  let cleaned;
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the later separator is the decimal point, the earlier one is grouping.
    cleaned = lastComma > lastDot
      ? s.replace(/\./g, "").replace(",", ".")   // European: 1.234,56 -> 1234.56
      : s.replace(/,/g, "");                       // US:       1,234.56 -> 1234.56
  } else if (lastComma >= 0) {
    const groups = s.split(",");
    // Multiple commas, or a single comma with exactly 3 trailing digits -> thousands grouping.
    cleaned = (groups.length > 2 || groups[groups.length - 1].length === 3) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else {
    // Multiple dots -> grouping (1.234.567). A single dot stays a decimal point (US default), so
    // genuine 3-decimal prices like 12.345 are preserved rather than read as twelve thousand.
    cleaned = s.split(".").length > 2 ? s.replace(/\./g, "") : s;
  }
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : (neg ? -n : n);
}
// The LSE quotes in pence, not pounds — Yahoo Finance returns "GBp" (lowercase p) as the currency for
// .L tickers, and spreadsheets/brokers commonly label the same 1/100-of-a-pound unit "GBX". Both must map
// to one internal code. NOTE: this check must NOT be case-insensitive on the third letter — "GBP" (real
// pounds, uppercase P) is a completely different currency from "GBp" (pence, lowercase p), and a careless
// /i-flag regex here previously matched both, causing infinite recursion in fxToUSD (GBP normalized back
// to GBX, which recursed into GBP, forever).
const SUBUNIT_CURRENCIES = { GBX: { base: "GBP", factor: 0.01 } };
function normalizeCurrencyCode(code) {
  const c = String(code || "").trim();
  if (!c) return c;
  if (c === "GBp" || /^GBX$/i.test(c)) return "GBX";
  return c.toUpperCase();
}
function isKnownCurrency(code) {
  const c = normalizeCurrencyCode(code);
  return CURRENCIES.includes(c) || !!SUBUNIT_CURRENCIES[c];
}
// Currency-aware formatter — never hardcodes "$"; renders the right symbol/code for any holding's own currency.
function fmtCurrency(n, currency = "USD") {
  if (n == null || isNaN(n)) return "—";
  const cur = normalizeCurrencyCode(currency);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${cur} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
}
// fxRates is Frankfurter's USD-base table: { EUR: 0.92, GBP: 0.79, ... } = units of that currency per 1 USD.
// Returns null (not a silently-wrong passthrough) when a rate isn't loaded yet — callers must show "—", not fake a number.
function fxToUSD(amount, currency, fxRates) {
  if (amount == null) return null;
  const cur = normalizeCurrencyCode(currency);
  if (!cur || cur === "USD") return amount;
  const sub = SUBUNIT_CURRENCIES[cur];
  if (sub) return fxToUSD(amount * sub.factor, sub.base, fxRates);
  const rate = fxRates?.[cur];
  return rate ? amount / rate : null;
}
function fxConvert(amount, from, to, fxRates) {
  if (amount == null) return null;
  const f = normalizeCurrencyCode(from), t = normalizeCurrencyCode(to);
  if (!f || !t || f === t) return amount;
  const usd = fxToUSD(amount, f, fxRates);
  if (usd == null) return null;
  if (t === "USD") return usd;
  const subT = SUBUNIT_CURRENCIES[t];
  if (subT) { const baseAmt = fxConvert(usd, "USD", subT.base, fxRates); return baseAmt == null ? null : baseAmt / subT.factor; }
  const rate = fxRates?.[t];
  return rate ? usd * rate : null;
}
function pct(n) { if (n == null) return "—"; return (n >= 0 ? "+" : "") + n.toFixed(1) + "%"; }
function fmtShares(x) {
  const n = parseNum(x); if (n == null) return "—";
  if (Number.isInteger(n)) return n.toLocaleString();
  return parseFloat(n.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}
async function kvGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
async function kvSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function kvDel(k) { try { localStorage.removeItem(k); } catch {} }

// Append-only forward-return log for Discover picks. Distinct from atlas_recs (a "current picks"
// cache each scan OVERWRITES): this records every pick, every scan — ticker, fit score, the time it
// was recommended, and the price at that moment — so we can later check whether the AI's picks
// actually went up. It NEVER overwrites or dedupes; a ticker recommended twice is logged twice on
// purpose (that repetition is itself signal). No forward-return math is computed here — just logging.
// Storage: localStorage always (local cache + signed-out fallback); when signed in, each record is
// also written as its own doc to users/{uid}/pick_history, so the log survives cache clears and
// device switches. The cloud write is best-effort — a failure never blocks the local log.
const PICK_HISTORY_KEY = "atlas_pick_history";
async function logPickHistory(picks, uni) {
  if (!Array.isArray(picks) || !picks.length) return;
  const at = new Date().toISOString();
  const records = await Promise.all(picks.map(async (p) => {
    const ticker = String(p.ticker || "").toUpperCase();
    // The discover response carries no clean price field, so grab the latest close per pick — the
    // recommendation price is the one field we most need and can't backfill later.
    let price = null, currency = null;
    try {
      const r = await fetch(apiUrl(`/api/history?ticker=${encodeURIComponent(ticker)}&range=5d&interval=1d`));
      if (r.ok) { const d = await r.json(); const last = d.prices?.[d.prices.length - 1]; if (last?.close != null) { price = last.close; currency = d.currency || null; } }
    } catch (_) { /* price best-effort; still log the pick even if the fetch fails */ }
    return { ticker, company: p.company || null, fitScore: p.fitScore ?? null, universe: uni || null, price, currency, at };
  }));
  const prev = await kvGet(PICK_HISTORY_KEY);
  await kvSet(PICK_HISTORY_KEY, [...(Array.isArray(prev) ? prev : []), ...records]);
  const uid = auth?.currentUser?.uid;
  if (uid) savePickHistory(uid, records);
}
// Console helper to pull this device's local copy of the log. Run
// `atlasExportPickHistory()` in the browser console to download atlas_pick_history.json.
// Kept as the fallback for signed-out/local-only data even now that a cloud copy exists.
if (typeof window !== "undefined") {
  window.atlasExportPickHistory = async () => {
    const data = (await kvGet(PICK_HISTORY_KEY)) || [];
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "atlas_pick_history.json"; a.click();
      URL.revokeObjectURL(url);
    } catch (_) {}
    console.log(`atlas_pick_history: ${data.length} records`, data);
    return data;
  };
  // Cloud counterpart: fetches every pick doc from users/{uid}/pick_history (all devices,
  // survives cache clears). Requires being signed in. Run `atlasLoadCloudPickHistory()`.
  window.atlasLoadCloudPickHistory = async () => {
    const uid = auth?.currentUser?.uid;
    if (!uid) { console.log("Not signed in — cloud pick history unavailable."); return null; }
    const data = await loadPickHistory(uid);
    console.log(`cloud pick_history: ${data ? data.length : 0} records`, data);
    return data;
  };
}

// ---------- spreadsheet import: column detection + currency inference ----------
function looksLikeTicker(v) {
  const s = String(v ?? "").trim();
  if (!s || /\s/.test(s) || s.length > 14) return false;
  // A bare trailing "." is a real LSE ticker convention (National Grid is "NG.", Aviva is "AV." — the dot
  // disambiguates from an unrelated US ticker of the same letters). Then up to two more suffix segments,
  // covering a class suffix plus an exchange suffix together — Yahoo's symbol for Volvo B is "VOLV-B.ST".
  return /^[A-Za-z0-9]{1,8}\.?([.\-][A-Za-z0-9]{1,5}){0,2}$/.test(s);
}
const CURRENCIES = ["USD","EUR","GBP","CAD","AUD","CHF","JPY","HKD","SGD","CNY","KRW","INR","BRL","MXN","SEK","NOK","DKK","NZD","THB","IDR","RON","PLN","CZK","HUF","ILS","TRY","ZAR"];
// Exchange suffix → currency, so non-US tickers (e.g. "SHEL.L", "SAP.DE") don't need the user to specify currency manually.
const EXCHANGE_CURRENCY = {
  L: "GBP", PA: "EUR", DE: "EUR", F: "EUR", MI: "EUR", AS: "EUR", BR: "EUR", MC: "EUR", HE: "EUR", LS: "EUR", VI: "EUR", IR: "EUR",
  SW: "CHF", ST: "SEK", OL: "NOK", CO: "DKK",
  TO: "CAD", V: "CAD", CN: "CAD",
  AX: "AUD", NZ: "NZD",
  HK: "HKD", T: "JPY",
  SS: "CNY", SZ: "CNY",
  KS: "KRW", KQ: "KRW",
  SI: "SGD", NS: "INR", BO: "INR",
  SA: "BRL", MX: "MXN",
  BK: "THB", JK: "IDR",
};
function inferCurrencyFromTicker(ticker) {
  const m = /\.([A-Za-z]{1,4})$/.exec(String(ticker || "").toUpperCase());
  if (m && EXCHANGE_CURRENCY[m[1]]) return EXCHANGE_CURRENCY[m[1]];
  return "USD";
}

const IMPORT_TICKER_KEYS = ["ticker","symbol","stockticker","stocksymbol","tickersymbol"];
const IMPORT_NAME_KEYS = ["name","company","companyname","security","securityname","securitydescription","description","holding"];
const IMPORT_SHARES_KEYS = ["shares","quantity","qty","units","amount","position","numshares","numberofshares","sharesowned","sharesheld"];
const IMPORT_COST_KEYS = ["avgcost","averagecost","avgprice","averageprice","purchaseprice","buyprice","cost","price","entryprice","costpershare","avgcostpershare","unitcost","pricepershare"];
const IMPORT_TOTALCOST_KEYS = ["totalcost","costbasis","totalcostbasis","totalamountinvested","amountinvested","totalinvested","totalpaid","bookvalue","invested"];
const IMPORT_CURRENCY_KEYS = ["currency","cur","ccy","curr","currencycode"];
const IMPORT_EXCHANGE_KEYS = ["exchange","market","listingexchange","primaryexchange","stockexchange","venue"];
const IMPORT_ISIN_KEYS = ["isin","isincode","securityid"];
const IMPORT_TYPE_KEYS = ["type","assettype","category","instrumenttype","securitytype","assetclass"];
const IMPORT_VALUE_KEYS = ["marketvalue","currentvalue","value","balance","currentbalance","cashbalance","totalvalue"];
// Matches a row that represents idle/uninvested cash rather than a tradable security — "CASH", "Free cash
// (GBP)", "Cash & Cash Equivalents", "Main Pot (uninvested)", etc. Anchored to the start so it doesn't
// accidentally match a real ticker/name that merely contains "cash" as a substring somewhere.
const CASH_LABEL_RE = /^(free\s*cash|uninvested\s*cash|idle\s*cash|available\s*cash|core\s*cash|main\s*pot|cash\s*balance|cash\s*(&|and)\s*(cash\s*)?equivalents?|cash)\b/i;
function looksLikeCashRow(row, mapping) {
  const { tickerColumn, nameColumn, typeColumn } = mapping;
  if (typeColumn) {
    const t = String(row[typeColumn] ?? "").trim();
    if (/^cash\b/i.test(t) || /money\s*market/i.test(t)) return true;
  }
  const tickerVal = tickerColumn ? String(row[tickerColumn] ?? "").trim() : "";
  const nameVal = nameColumn ? String(row[nameColumn] ?? "").trim() : "";
  return CASH_LABEL_RE.test(tickerVal) || CASH_LABEL_RE.test(nameVal);
}
// Sums any cash-like rows into a single amount so it can be routed into Spare Cash instead of vanishing —
// these rows have no shares/price (there's nothing to buy), so they'd otherwise just get dropped as invalid.
function detectCashAmount(rawRows, mapping) {
  const { valueColumn, totalCostColumn, costColumn, currencyColumn, sheetCurrency, tickerColumn, nameColumn } = mapping;
  const byCurrency = new Map(); // currency -> summed amount, kept separate so mixed units aren't blindly added
  let found = false;
  for (const row of rawRows) {
    if (!looksLikeCashRow(row, mapping)) continue;
    let amt = valueColumn ? parseNum(row[valueColumn]) : null;
    if (amt == null && totalCostColumn) amt = parseNum(row[totalCostColumn]);
    if (amt == null && costColumn) amt = parseNum(row[costColumn]);
    if (amt == null) continue;
    let cur = null;
    if (currencyColumn) { const raw = normalizeCurrencyCode(row[currencyColumn]); if (isKnownCurrency(raw)) cur = raw; }
    // Currency spelled inside the cash row's own label, e.g. "Free cash (GBP)" — recover it before
    // falling back to the sheet-wide (cost-header-derived) currency or USD, which would otherwise
    // record a GBP cash line in a USD sheet as dollars.
    if (!cur) { const fromLabel = detectCurrencyInText([tickerColumn && row[tickerColumn], nameColumn && row[nameColumn]].filter(Boolean).join(" ")); if (fromLabel && isKnownCurrency(fromLabel)) cur = normalizeCurrencyCode(fromLabel); }
    if (!cur && sheetCurrency) cur = sheetCurrency;
    cur = cur || "USD";
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + amt);
    found = true;
  }
  if (!found) return null;
  // If every cash row shares a currency, return the clean total. If they DON'T, summing mixed
  // units would produce a materially wrong figure (£1,000 + $500 is not "1,500"), so surface the
  // largest single-currency subtotal and flag it so the UI can tell the user to add the rest manually.
  const entries = [...byCurrency.entries()].sort((a, b) => b[1] - a[1]);
  const [currency, amount] = entries[0];
  return entries.length > 1
    ? { amount, currency, multiCurrency: true, breakdown: entries.map(([c, a]) => ({ currency: c, amount: a })) }
    : { amount, currency };
}

// Currency symbol/code that may be embedded in a header itself (e.g. "Avg Cost (€)") rather than a
// dedicated currency column — common in brokerage exports that report everything in one home currency.
const CURRENCY_SYMBOL_MAP = { "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₩": "KRW", "R$": "BRL" };
const CURRENCY_CODE_RE = new RegExp(`\\b(${CURRENCIES.join("|")}|GBX)\\b`, "i");
function detectCurrencyInText(text) {
  const s = String(text || "");
  if (!s) return null;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOL_MAP)) if (s.includes(sym)) return code;
  const m = CURRENCY_CODE_RE.exec(s);
  if (m) return normalizeCurrencyCode(m[1]);
  if (/\blei\b/i.test(s)) return "RON";
  if (/\bzł\b|\bzloty/i.test(s)) return "PLN";
  if (s.includes("p") && /\bpence\b/i.test(s)) return "GBX";
  if (s.includes("$")) return "USD";
  return null;
}
// Looks at the headers we're actually reading money out of (cost/total-cost columns) — that tells us the
// currency the NUMBERS are expressed in, which can differ from where the stock itself trades (e.g. a
// broker showing everything converted to the account's home currency).
function detectHeaderCurrency(headerCandidates) {
  for (const h of headerCandidates) { const found = detectCurrencyInText(h); if (found) return found; }
  return null;
}

// Ordered [substrings to match in the normalized exchange name, Yahoo-style ticker suffix, currency].
// Order matters: more specific names MUST come before the generic US catch-all, since several real
// exchanges are literally branded "Nasdaq <City>" (Nasdaq owns the Nordic/Baltic markets) and would
// otherwise match the bare "nasdaq" substring first. The catch-all stays last for that reason.
const EXCHANGE_INFO = [
  [["londonstockexchange", "lse", "aim", "(lse)"], ".L", "GBP"],
  [["euronextparis", "parisbourse", "(par)", "xpar"], ".PA", "EUR"],
  [["euronextamsterdam", "(ams)", "xams"], ".AS", "EUR"],
  [["euronextbrussels", "(bru)"], ".BR", "EUR"],
  [["euronextlisbon", "(lis)"], ".LS", "EUR"],
  [["euronextdublin", "irishstockexchange"], ".IR", "EUR"],
  [["xetra", "frankfurtstockexchange", "deutscheborse", "boersefrankfurt", "(fra)", "(de)", "(etr)"], ".DE", "EUR"],
  [["borsaitaliana", "milanstockexchange", "milan"], ".MI", "EUR"],
  [["bolsademadrid", "bme", "madrid"], ".MC", "EUR"],
  [["sixswissexchange", "sixswiss", "swissstockexchange", "zurich"], ".SW", "CHF"],
  [["nasdaqstockholm", "stockholmstockexchange", "stockholm"], ".ST", "SEK"],
  [["oslostockexchange", "oslobors", "oslo"], ".OL", "NOK"],
  [["nasdaqcopenhagen", "copenhagenstockexchange", "copenhagen"], ".CO", "DKK"],
  [["nasdaqhelsinki", "helsinkistockexchange", "helsinki"], ".HE", "EUR"],
  [["torontostockexchange", "torontotsx", "(tsx)", "tsx"], ".TO", "CAD"],
  [["tsxventure", "tsxv"], ".V", "CAD"],
  [["australiansecuritiesexchange", "asx"], ".AX", "AUD"],
  [["newzealandexchange", "nzx"], ".NZ", "NZD"],
  [["hongkongstockexchange", "hkex", "hongkong"], ".HK", "HKD"],
  [["tokyostockexchange", "tokyotse", "jpx", "tse"], ".T", "JPY"],
  [["shanghaistockexchange", "sse"], ".SS", "CNY"],
  [["shenzhenstockexchange", "szse"], ".SZ", "CNY"],
  [["koreaexchange", "krxkorea", "krx", "kospi", "kosdaq"], ".KS", "KRW"],
  [["singaporeexchange", "sgx"], ".SI", "SGD"],
  [["nationalstockexchangeofindia", "nse"], ".NS", "INR"],
  [["bombaystockexchange", "bse"], ".BO", "INR"],
  [["b3brazil", "b3", "bovespa", "brazil"], ".SA", "BRL"],
  [["bolsamexicana", "mexico"], ".MX", "MXN"],
  [["bangkokstockexchange", "setthailand"], ".BK", "THB"],
  [["indonesiastockexchange", "idx"], ".JK", "IDR"],
  [["bucharest", "bursadevalori", "bvb"], ".RO", "RON"],
  [["warsawstockexchange", "gpw"], ".WA", "PLN"],
  [["pragueexchange", "pse"], ".PR", "CZK"],
  [["budapeststockexchange", "bet"], ".BD", "HUF"],
  [["telavivstockexchange", "tase"], ".TA", "ILS"],
  [["borsaistanbul", "istanbulstockexchange"], ".IS", "TRY"],
  [["johannesburgstockexchange", "jse"], ".JO", "ZAR"],
  [["nasdaq", "nyse", "amex", "arca", "bats", "otc", "pinksheets", "cboe"], "", "USD"],
];
function resolveExchangeInfo(exchangeRaw) {
  // Keep digits — codes like "B3" or "9988.HK"-style exchange labels rely on them; only strip punctuation/spaces.
  const norm = String(exchangeRaw || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!norm) return null;
  for (const [substrings, suffix, currency] of EXCHANGE_INFO) {
    if (substrings.some(s => norm.includes(s))) return { suffix, currency };
  }
  return null;
}

// Fast, deterministic pass — handles clean/well-labeled exports instantly without calling the model.
function detectImportMapping(headers, rawRows) {
  // Strip a trailing qualifier in parens/brackets BEFORE stripping non-letters — otherwise "Market Value
  // (GBP)" becomes "marketvaluegbp" (the currency code glues onto the end) and never exactly matches
  // "marketvalue". A currency/unit annotation is extremely common in real exports and shouldn't break
  // column detection just because it happens to be spelled out in letters instead of a symbol.
  const norm = (s) => String(s).replace(/\s*[\(\[][^)\]]*[\)\]]\s*$/, "").toLowerCase().replace(/[^a-z]/g, "");
  const find = (keys) => headers.find(h => keys.includes(norm(h))) ?? null;
  const tickerColumn = find(IMPORT_TICKER_KEYS);
  const nameColumn = find(IMPORT_NAME_KEYS);
  const sharesColumn = find(IMPORT_SHARES_KEYS);
  const costColumn = find(IMPORT_COST_KEYS);
  const totalCostColumn = find(IMPORT_TOTALCOST_KEYS);
  const currencyColumn = find(IMPORT_CURRENCY_KEYS);
  const exchangeColumn = find(IMPORT_EXCHANGE_KEYS);
  const isinColumn = find(IMPORT_ISIN_KEYS);
  const typeColumn = find(IMPORT_TYPE_KEYS);
  const valueColumn = find(IMPORT_VALUE_KEYS);

  const sampleVals = (col) => rawRows.slice(0, 15).map(r => String(r[col] ?? "").trim()).filter(Boolean);
  let tickerLooksValid = false;
  if (tickerColumn) {
    const vals = sampleVals(tickerColumn);
    tickerLooksValid = vals.length > 0 && vals.filter(looksLikeTicker).length / vals.length >= 0.7;
  }
  // Confident only when we found real ticker symbols (not just a header name match) plus shares and some cost figure —
  // otherwise we hand off to the model, which can read company names and odd layouts. Note: format-valid
  // does NOT mean correct — a bare "TSCO" passes this check but is a different US company (Tractor Supply)
  // from UK Tesco plc ("TSCO.L"). The caller layers an additional non-USD check on top of this for that reason.
  const confident = !!(tickerColumn && tickerLooksValid && sharesColumn && (costColumn || totalCostColumn));
  return { tickerColumn: tickerColumn || nameColumn, nameColumn, sharesColumn, costColumn, totalCostColumn, currencyColumn, exchangeColumn, isinColumn, typeColumn, valueColumn, confident };
}

// Pure + synchronous so the user can re-map columns by hand afterward with no extra AI round-trip.
function computeImportRows(headers, rawRows, mapping, nameMap = {}) {
  const { tickerColumn, sharesColumn, costColumn, totalCostColumn, currencyColumn, exchangeColumn, sheetCurrency } = mapping;
  const rows = rawRows.filter(row => !looksLikeCashRow(row, mapping)).map((row) => {
    let ticker = "";
    let sourceLabel = null;
    if (tickerColumn) {
      const raw = String(row[tickerColumn] ?? "").trim();
      if (raw) {
        const resolved = nameMap[raw];
        if (resolved) {
          ticker = resolved.ticker ? resolved.ticker.toUpperCase() : "";
          sourceLabel = raw;
        } else if (looksLikeTicker(raw)) {
          ticker = raw.toUpperCase();
        } else {
          ticker = raw.toUpperCase();
          sourceLabel = raw;
        }
      }
    }

    // International recognition: append the right Yahoo-style exchange suffix when we know the listing
    // venue and the ticker doesn't already carry one (e.g. "SAF" + "Euronext Paris" -> "SAF.PA").
    let exchangeInfo = null;
    if (exchangeColumn) {
      exchangeInfo = resolveExchangeInfo(row[exchangeColumn]);
      // Only guard against a ticker that already carries a dot-suffix (e.g. raw value "9988.HK" plus an
      // Exchange column would otherwise become "9988.HK.HK"). A hyphenated class suffix like "VOLV-B" or
      // "BRK-B" still needs the real exchange suffix appended when the listing isn't US (Yahoo's actual
      // symbol for Volvo B is "VOLV-B.ST") — appending "" for US exchanges is a harmless no-op either way.
      if (ticker && exchangeInfo?.suffix && !ticker.includes(".")) {
        ticker = ticker + exchangeInfo.suffix;
      }
    }

    const shares = sharesColumn ? parseNum(row[sharesColumn]) : null;
    let cost = costColumn ? parseNum(row[costColumn]) : null;
    if (cost == null && totalCostColumn && shares) {
      const total = parseNum(row[totalCostColumn]);
      if (total != null && shares > 0) cost = total / shares;
    }

    // Currency priority: explicit per-row column > sheet-wide currency (detected from header symbols like
    // "(€)", or the user's override below) > the row's own listing exchange > the ticker's own suffix > USD.
    // Sheet-wide wins over exchange/ticker inference because it describes the actual unit of the number we
    // just parsed for cost — e.g. a broker showing every position's cost converted to one home currency.
    let currency = null;
    if (currencyColumn) {
      const raw = normalizeCurrencyCode(row[currencyColumn]);
      if (isKnownCurrency(raw)) currency = raw;
    }
    if (!currency && sheetCurrency && isKnownCurrency(sheetCurrency)) currency = normalizeCurrencyCode(sheetCurrency);
    if (!currency && exchangeInfo?.currency) currency = exchangeInfo.currency;
    if (!currency) {
      const mappedCur = sourceLabel ? nameMap[sourceLabel]?.currency : null;
      currency = (mappedCur && isKnownCurrency(mappedCur)) ? normalizeCurrencyCode(mappedCur) : inferCurrencyFromTicker(ticker);
    }
    const valid = ticker.length > 0 && looksLikeTicker(ticker) && shares != null && shares > 0 && cost != null && cost > 0;
    return {
      ticker, shares: shares == null ? "" : String(shares),
      cost: cost == null ? "" : String(Math.round(cost * 10000) / 10000),
      currency, valid, sourceLabel,
    };
  }).filter(r => r.ticker || r.shares || r.cost || r.sourceLabel);
  return rows;
}

const IMPORT_MAPPING_SYSTEM_PROMPT = `You analyze raw spreadsheet exports of a person's stock portfolio (from brokerages like Schwab, Fidelity, Robinhood, Interactive Brokers, or a manual tracker) so an app can import the holdings automatically. Layouts vary wildly between sources. Be decisive.

Return ONE JSON object only. No prose, no markdown fences.

From the given HEADERS and SAMPLE ROWS, identify the following (return the EXACT header text as it appears in HEADERS, or null if no suitable column exists):
- tickerColumn: column containing real stock ticker symbols (e.g. "AAPL", "SHEL.L", "9988.HK").
- nameColumn: column containing company/security names (e.g. "Apple Inc.") if there is no real ticker column.
- sharesColumn: column containing number of shares/units/quantity held.
- costColumn: column containing the investor's AVERAGE PURCHASE PRICE PER SHARE.
- totalCostColumn: column containing the TOTAL amount paid for the whole position (cost basis total) — only set this if costColumn is null and such a column exists; the app will divide by shares to get a per-share cost.
- currencyColumn: column containing a currency code (e.g. "USD").
- exchangeColumn: column naming the listing exchange/market (e.g. "NASDAQ", "Euronext Paris", "Hong Kong Stock Exchange"). Null if none.

If a list of unique security identifiers is provided, resolve or VERIFY each one to its real, currently-listed, Yahoo-Finance-compatible ticker symbol (include the exchange suffix if not US-listed, e.g. "SAP.DE", "TSCO.L", or the US ADR ticker like "TSM" for TSMC) and the ISO currency code that ticker primarily trades in. Each identifier is an object that may include helpful context — use it:
- "value": the raw ticker or company name as it appeared in the sheet. Always echo this back exactly as "input" in your answer.
- "isin": an ISIN code, if present — this is a globally unique, authoritative identifier. When given, trust it over the ticker text: the ISIN's country prefix tells you the true listing country (e.g. "GB..." = UK-listed, "US..." = US-listed), which resolves ambiguous cases.
- "currency"/"exchange": additional hints about where this trades.

IMPORTANT — bare tickers are often ambiguous across markets and must not be taken at face value. A classic trap: the plain ticker "TSCO" with no suffix is "Tractor Supply Co." on NASDAQ (US) — completely unrelated to "Tesco PLC", the UK grocer, whose real Yahoo symbol is "TSCO.L". If isin/currency/exchange context implies a non-US listing, you MUST resolve to the correctly-suffixed non-US ticker, never the coincidentally-matching US one. The same applies broadly: always cross-check a bare-looking ticker against any provided currency/exchange/ISIN context before trusting it as-is.

If a value clearly represents cash, a money-market fund, or anything that isn't a real individual tradable security, set its ticker to null rather than guessing. Never guess blindly — if you cannot confidently identify a real, currently-listed company or fund even with web search, set ticker to null.

Schema:
{"tickerColumn":null,"nameColumn":null,"sharesColumn":null,"costColumn":null,"totalCostColumn":null,"currencyColumn":null,"exchangeColumn":null,"nameMappings":[{"input":"","ticker":"","currency":""}]}`;

function closeJSON(raw) {
  let s = raw, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) { const ch = s[i]; if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; } else if (ch === '"') inStr = true; }
  if (inStr) s += '"';
  s = s.replace(/[\s,]*$/, "").replace(/"[^"]*"\s*:\s*$/, "").replace(/[\s,]*$/, "");
  // Drop a trailing key whose value was cut off mid-token (a bare number or a partial
  // true/false/null with no closing delimiter). closeJSON only runs on already-unparseable text,
  // so a dangling number here is almost certainly truncated — omitting the field is safer than
  // parsing "…\"fitScore\":8" as 8 when the real value was 85.
  s = s.replace(/,?\s*"[^"]*"\s*:\s*(-?\d[\d.eE+\-]*|t(?:r(?:u(?:e)?)?)?|f(?:a(?:l(?:s(?:e)?)?)?)?|n(?:u(?:l(?:l)?)?)?)$/, "").replace(/[\s,]*$/, "");
  const st = []; inStr = false; esc = false;
  for (let i = 0; i < s.length; i++) { const ch = s[i]; if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; } else { if (ch === '"') inStr = true; else if (ch === "{") st.push("}"); else if (ch === "[") st.push("]"); else if (ch === "}" || ch === "]") st.pop(); } }
  while (st.length) s += st.pop();
  return s;
}
function extractJSON(text) {
  const start = text.indexOf("{"); if (start === -1) return null;
  const end = text.lastIndexOf("}");
  if (end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  try { return JSON.parse(closeJSON(text.slice(start))); } catch { return null; }
}

// The AI proxy requires a signed-in user when Firebase is configured (it verifies this token
// server-side before spending the Anthropic API key). getIdToken() is cached by the SDK and
// auto-refreshes, so this is cheap to call per request.
async function aiAuthHeaders(forceRefresh = false) {
  try {
    // Wait for Firebase to finish restoring the persisted session before reading currentUser, so a
    // call fired right after load doesn't go out tokenless. forceRefresh mints a fresh ID token
    // (used to recover from a stale/expired cached token that the server would 401).
    if (auth?.authStateReady) await auth.authStateReady();
    const u = auth?.currentUser;
    if (!u) return {};
    return { Authorization: `Bearer ${await u.getIdToken(forceRefresh)}` };
  } catch { return {}; }
}

const AI_MODEL = "claude-sonnet-5";

// The model has no idea what today's date is unless we tell it — left to itself it stamps its
// training-era year (e.g. "2025") on things like a dossier/scan "asOf". Prepend the real current
// date to every prompt that reasons about "now" so recency, valuations and news are grounded.
function currentDateStr() {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Read a response as JSON, but tolerate a non-JSON body. A serverless function that times out or
// crashes returns a plain-text/HTML platform error (e.g. "An error occurred…"), and blindly calling
// resp.json() on that throws a cryptic "Unexpected token 'A'… is not valid JSON". Surface a clean,
// actionable message keyed to the status instead.
async function readAIResponse(resp) {
  const raw = await resp.text();
  try { return JSON.parse(raw); }
  catch {
    if (resp.status === 504 || resp.status === 408 || /timeout|timed out|FUNCTION_INVOCATION_TIMEOUT/i.test(raw)) {
      throw new Error("That took too long and the server timed out — try again.");
    }
    if (resp.status >= 500) throw new Error("The server hit an error — give it a moment and try again.");
    throw new Error("The server returned an unexpected response. Try again.");
  }
}

async function callClaudeOnce(system, user, maxTokens, maxSearches, fast) {
  const body = JSON.stringify({
    model: AI_MODEL, max_tokens: maxTokens, system,
    messages: [{ role: "user", content: user }],
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches }],
    // "fast" = medium effort (shallower reasoning → quicker) for the search-and-summarize calls
    // (Discover, market/portfolio news). Thinking stays ON (the adaptive default) — that's what
    // triggers web search on Sonnet 5, so unlike DISABLING thinking this still fetches real data.
    // NOTE: never set thinking:{type:"disabled"} here; that suppresses search and returns garbage.
    ...(fast ? { output_config: { effort: "medium" } } : {}),
  });
  const doFetch = async (forceRefresh) => fetch(`${API_BASE}/api/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(await aiAuthHeaders(forceRefresh)) },
    body,
  });
  let resp = await doFetch(false);
  // A 401 when we DO have a signed-in user almost always means the cached Firebase ID token went
  // stale (they expire ~hourly). Force-refresh the token and retry once before surfacing "sign in"
  // — this self-heals a session that's still valid but whose cached token lapsed.
  if (resp.status === 401 && auth?.currentUser) resp = await doFetch(true);
  const data = await readAIResponse(resp);
  if (data.error) throw new Error(data.error.message || "API error");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { parsed: extractJSON(text), stopReason: data.stop_reason, text };
}

// A truncated response almost always means the answer just needed more room, not a different query —
// the search results and reasoning were fine, only the OUTPUT budget ran out. Heal it silently with one
// automatic retry at a much larger budget (same search depth, same prompt) before ever bothering the
// user with an error they'd have to act on themselves.
async function callClaudeAttempt(system, user, maxTokens, maxSearches, fast) {
  let { parsed, stopReason, text } = await callClaudeOnce(system, user, maxTokens, maxSearches, fast);
  // Retry on truncation even when the truncated payload still PARSED. A response cut off inside a
  // number (e.g. a fitScore of 85 truncated to "8", or a currentPrice of 182.40 to "18") parses
  // to a valid-but-wrong value, so "parsed && max_tokens" isn't safe to trust — only "parsed &&
  // NOT truncated" is. Retrying with more room gets a complete, uncorrupted response.
  if (stopReason === "max_tokens") {
    const retry = await callClaudeOnce(system, user, Math.round(maxTokens * 1.8) + 1500, maxSearches, fast);
    // Keep the retry unless it somehow came back worse (unparseable when the first parsed).
    if (retry.parsed || !parsed) ({ parsed, stopReason, text } = retry);
  }
  // One immediate retry if a successful (non-truncated) response still came back unparseable and it
  // isn't the model explaining a rate-limit (the caller handles that with backoff). Covers the
  // transient case where the model wrapped/malformed the JSON — a fresh call usually returns clean.
  if (!parsed && stopReason !== "max_tokens" && !SEARCH_LIMITED_TEXT_RE.test(text)) {
    const retry = await callClaudeOnce(system, user, maxTokens, maxSearches, fast);
    if (retry.parsed) ({ parsed, stopReason, text } = retry);
  }
  return { parsed, stopReason, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every AI request draws on ONE org-wide web-search rate limit upstream. Measured live: running
// two search-heavy calls at once (market news = 4 searches + Discover = 2, fired together on the
// Today screen) reliably TRIPS that limit, and the loser then sits in a 15s+35s backoff — so the
// Today screen took 75s+ to settle. The shared limit is effectively a serial resource, so parallel
// calls are counterproductive: run ONE at a time. Market news (the Today headline) then completes
// clean and first, Discover runs right after, and neither trips the limit into a long backoff.
const AI_MAX_CONCURRENT = 1;
const AI_START_GAP_MS = 800;
let aiActive = 0;
let aiLastStart = 0;
const aiWaiters = [];
async function acquireAISlot() {
  if (aiActive >= AI_MAX_CONCURRENT) await new Promise((resolve) => aiWaiters.push(resolve));
  aiActive++;
  const gap = aiLastStart + AI_START_GAP_MS - Date.now();
  if (gap > 0) await sleep(gap);
  aiLastStart = Date.now();
}
function releaseAISlot() {
  aiActive--;
  const next = aiWaiters.shift();
  if (next) next();
}
// Broad match for the model explaining a search-tool failure in prose instead of returning JSON.
const SEARCH_LIMITED_TEXT_RE = /limit exceeded|rate.?limit|too many requests|temporarily unavailable|tool.*(unavailable|error)/i;
// Narrow match for request-level API errors that are transient by definition (Anthropic 429/529,
// or this app's own per-user proxy limiter) — anything else (auth, validation) must throw as-is.
const RETRYABLE_ERROR_RE = /rate.?limit|too many requests|overloaded/i;

async function callClaude(system, user, { maxTokens = 4000, maxSearches = 4, fast = false } = {}) {
  await acquireAISlot();
  try {
    // Rate limiting is transient by definition — retry with backoff before surfacing anything.
    // The backoff sleeps hold only THIS call's slot: a limited call quietly waits its turn again
    // while the other slot keeps serving fresh requests at full speed.
    let parsed, stopReason, text, apiError;
    for (const delay of [0, 15000, 35000]) {
      if (delay) await sleep(delay);
      apiError = null;
      try {
        ({ parsed, stopReason, text } = await callClaudeAttempt(system, user, maxTokens, maxSearches, fast));
      } catch (e) {
        if (!RETRYABLE_ERROR_RE.test(String(e?.message))) throw e;
        apiError = e;
        continue;
      }
      if (parsed || !SEARCH_LIMITED_TEXT_RE.test(text)) break;
    }
    if (apiError) throw apiError;
    if (!parsed) {
      if (stopReason === "max_tokens") throw new Error("The response was too long even after retrying with more room. Try again in a moment.");
      console.error("extractJSON failed, raw text:", text.slice(0, 500));
      // When web search is rate-limited upstream, the model explains that in prose instead of
      // returning JSON — surface the real cause instead of a generic "unreadable" error.
      if (SEARCH_LIMITED_TEXT_RE.test(text)) {
        throw new Error("Live web search is rate-limited upstream right now. Atlas already retried a few times — give it a minute, then try again.");
      }
      throw new Error("The response came back unreadable. Try again.");
    }
    return parsed;
  } finally {
    releaseAISlot();
  }
}

// Analysis-only AI call: NO web_search tool, so it never touches the shared upstream web-search
// rate limit (the fragile resource that times out) and doesn't go through the search pool. Used to
// reason over data we've ALREADY fetched from our own endpoints (news headlines, or a full dossier's
// price/fundamentals/news). `think` keeps adaptive thinking on for depth (dossier); default off for
// speed (news blurbs). Because there's no web search, disabling thinking here is safe.
async function callClaudeAnalyzeOnce(system, user, maxTokens, think) {
  const body = JSON.stringify({
    model: AI_MODEL, max_tokens: maxTokens, system,
    messages: [{ role: "user", content: user }],
    thinking: think ? { type: "adaptive" } : { type: "disabled" },
    ...(think ? { output_config: { effort: "medium" } } : {}),
  });
  const doFetch = async (forceRefresh) => fetch(`${API_BASE}/api/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(await aiAuthHeaders(forceRefresh)) }, body,
  });
  let resp = await doFetch(false);
  if (resp.status === 401 && auth?.currentUser) resp = await doFetch(true);   // self-heal a stale token
  const data = await readAIResponse(resp);
  if (data.error) throw new Error(data.error.message || "API error");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { parsed: extractJSON(text), stopReason: data.stop_reason, text };
}

// Evidence trail for analyze-path parse failures. Every prior occurrence of the dossier
// "unreadable" bug destroyed its own evidence — the raw text was discarded, making it
// undebuggable after the fact (diagnosed live 2026-07-06: the model emitted a spurious `}` after
// fit.summary, prematurely closing the root object — mid-document corruption that closeJSON, an
// append-only truncation repairer, cannot fix). Mirror the search path's console.error AND keep
// the last few raw failures in a localStorage ring buffer. Local debugging aid only — never
// synced to Firestore or sent anywhere.
const ANALYZE_FAIL_KEY = "atlas_analyze_failures";
function logAnalyzeParseFailure(text, stopReason) {
  console.error("callClaudeAnalyze: extractJSON failed after retry. stop_reason:", stopReason, "raw text:", (text || "").slice(0, 500));
  try {
    const prev = JSON.parse(localStorage.getItem(ANALYZE_FAIL_KEY) || "[]");
    const entry = { at: new Date().toISOString(), stopReason: stopReason || null, textLength: (text || "").length, text: (text || "").slice(0, 30000) };
    localStorage.setItem(ANALYZE_FAIL_KEY, JSON.stringify([entry, ...(Array.isArray(prev) ? prev : [])].slice(0, 4)));
  } catch {}
}

// Same self-healing the search path has had all along (callClaudeAttempt) — the dossier, the most
// complex JSON this app ever asks for, previously got NONE of it: one truncation retry at a larger
// budget, then one retry of a non-truncated-but-unparseable response (a fresh sample almost never
// repeats the same generation slip — verified live: the captured spurious-brace failure succeeded
// on the very next attempt). One retry each, deliberately not a loop: catches the common transient
// case without open-endedly doubling cost/latency on a genuinely broken prompt.
async function callClaudeAnalyze(system, user, { maxTokens = 1600, think = false } = {}) {
  let { parsed, stopReason, text } = await callClaudeAnalyzeOnce(system, user, maxTokens, think);
  if (stopReason === "max_tokens") {
    // Retry truncation even when the truncated payload parsed — a number cut off mid-digits
    // parses to a valid-but-wrong value (same reasoning as callClaudeAttempt). Clamped to the
    // proxy's MAX_TOKENS_CAP (api/messages.js rejects max_tokens > 32000): the dossier already
    // runs at 20000, and an unclamped 1.8× retry (37500) would 400, turning a healable
    // truncation into a hard failure.
    const retry = await callClaudeAnalyzeOnce(system, user, Math.min(32000, Math.round(maxTokens * 1.8) + 1500), think);
    if (retry.parsed || !parsed) ({ parsed, stopReason, text } = retry);
  }
  if (!parsed && stopReason !== "max_tokens") {
    const retry = await callClaudeAnalyzeOnce(system, user, maxTokens, think);
    if (retry.parsed) ({ parsed, stopReason, text } = retry);
  }
  if (!parsed) logAnalyzeParseFailure(text, stopReason);
  return parsed;
}

// The model doesn't always obey the "no vague aggregate rows" prompt instruction (e.g. still
// occasionally returns "Multiple open-market purchases" / "Undisclosed per-filing total" instead
// of one clean dated filing). Prompting alone can't guarantee this, so every insider transaction
// is validated here before it's ever stored/rendered — vague rows are silently dropped rather than
// shown, regardless of what the model returns. The underlying pattern can still surface in the
// prose summary; only the structured per-row data is held to this hard bar.
const VAGUE_INSIDER_RE = /multiple|various|several|unspecified|undisclosed|aggregate|n\/a|not retrieved|unknown|unconfirmed|approx(imately)?ly unknown/i;
function isCleanInsiderTxn(t) {
  if (!t || typeof t !== "object") return false;
  const { insider, shares, value, date } = t;
  if (!insider || !shares || !value || !date) return false;
  if ([insider, shares, value, date].some((f) => VAGUE_INSIDER_RE.test(String(f)))) return false;
  if (!/\d/.test(String(shares)) || !/\d/.test(String(value))) return false;
  return true;
}
function cleanInsiderActivity(ia) {
  if (!ia) return null;
  return { ...ia, transactions: (ia.transactions || []).filter(isCleanInsiderTxn) };
}

function fmtHistoryDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function profileText(p) {
  return [
    `Name: ${p.name}`, `Risk tolerance: ${p.riskTolerance}`, `Time horizon: ${p.horizon}`,
    `Investable budget: ${p.budget}`, `Primary goal: ${p.goal}`, `Investing style: ${p.philosophy || "n/a"}`,
    `Target annual return: ${p.targetReturn || "n/a"}`, `Position conviction: ${p.positionConviction || "n/a"}`,
    `Activity level: ${p.activityLevel || "n/a"}`, `Experience: ${p.experience}`,
    `Reaction to a 20% drop: ${p.drawdownReaction}`, `Income stability: ${p.incomeStability}`,
    `Emergency fund: ${p.emergencyFund || "n/a"}`, `Home-market preference: ${p.region || "No preference"}`,
    `Sectors of interest: ${(p.interests || []).join(", ") || "none"}`,
    `Industries to avoid: ${(p.avoid || []).join(", ") || "none"}`,
    p.intentions ? `In their own words: "${p.intentions}"` : "",
  ].filter(Boolean).join("\n");
}
function holdingsText(h) { return h && h.length ? h.map((x) => `${x.ticker}: ${x.shares} shares @ ${x.cost}${x.currency && x.currency !== "USD" ? ` ${x.currency}` : ""} avg cost`).join("\n") : "none"; }

// ---------- stock logo (dark) ----------
function StockLogo({ ticker, size = 32 }) {
  const [failed, setFailed] = useState(false);
  const src = `https://financialmodelingprep.com/image-stock/${ticker}.png`;
  const letters = (ticker || "").replace(/[^A-Z]/g, "").slice(0, 2);
  const palette = [c.accent, c.seriesAlt, c.positive, c.warning, "#C77DFF", "#5BA8FF"];
  const bg = palette[((ticker || "X").charCodeAt(0)) % palette.length];
  if (failed) {
    return (
      <div style={{ width: size, height: size, borderRadius: radius.sm, background: `${bg}22`, border: `1px solid ${bg}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontFamily: font.mono, fontWeight: 600, fontSize: size * 0.32, color: bg }}>{letters}</span>
      </div>
    );
  }
  return (
    <img src={src} alt={ticker} width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: radius.sm, objectFit: "contain", background: "#fff", padding: 2, flexShrink: 0, border: `1px solid ${c.hairline}` }} />
  );
}

// ============================================================
//  ONBOARDING — full-bleed, progress spine, one question at a time
// ============================================================
function Onboarding({ initial, onDone, onExit }) {
  const [i, setI] = useState(0);
  const [profile, setProfile] = useState(initial || {});
  const step = STEPS[i], last = i === STEPS.length - 1, total = STEPS.length;
  const isExisting = !!(initial && initial.name);
  const chapterIdx = CHAPTERS.findIndex(ch => i >= ch.start && i <= ch.end);
  function setVal(v) { setProfile((p) => ({ ...p, [step.id]: v })); }
  function next() { last ? onDone(profile) : setI(i + 1); }
  function choose(v) { const np = { ...profile, [step.id]: v }; setProfile(np); last ? onDone(np) : setI(i + 1); }
  function toggle(v) { const cur = profile[step.id] || []; setVal(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]); }
  const isText = step.kind === "text" || step.kind === "longtext";
  const canContinue = step.id === "name" ? (profile.name || "").trim().length > 0 : true;

  return (
    <div style={{ minHeight: "100dvh", background: c.canvas, display: "flex" }}>
      {/* spine */}
      <div className="ob-spine" style={{ width: 280, flexShrink: 0, borderRight: `1px solid ${c.hairline}`, padding: "40px 32px", flexDirection: "column", justifyContent: "space-between", background: c.sunken }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 44 }}>
            <AtlasMark size={30} /><span style={{ ...type.title, color: c.text }}>Atlas</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {CHAPTERS.map((ch, ci) => {
              const active = ci === chapterIdx, done = ci < chapterIdx;
              return (
                <div key={ch.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
                  <div style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                    background: active ? c.accent : done ? c.accent : c.surface2,
                    border: `1px solid ${active || done ? c.accent : c.border}`, boxShadow: active ? `0 0 0 4px ${c.accentSoft}` : "none" }} />
                  <span style={{ ...type.small, fontWeight: active ? 600 : 400, color: active ? c.text : done ? c.text2 : c.text3 }}>{ch.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ ...type.caption, color: c.text3 }}>Step {i + 1} of {total}</div>
      </div>

      {/* question */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 20px", minWidth: 0 }}>
        {/* mobile top progress */}
        <div className="ob-topbar" style={{ paddingTop: 24, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1, height: 4, background: c.surface2, borderRadius: 99, overflow: "hidden" }}>
            <motion.div initial={false} animate={{ width: `${((i + 1) / total) * 100}%` }} transition={{ duration: 0.4, ease: [0.16,1,0.3,1] }} style={{ height: "100%", background: c.accent, borderRadius: 99 }} />
          </div>
          {isExisting && onExit && <Button variant="ghost" size="sm" onClick={onExit}>Close</Button>}
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: 40 }}>
          <div style={{ width: "100%", maxWidth: 560 }}>
            <AnimatePresence mode="wait">
              <motion.div key={step.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.16,1,0.3,1] }}>
                <Overline color={c.accent} style={{ marginBottom: 14 }}>{CHAPTERS[chapterIdx]?.label}</Overline>
                <h2 style={{ ...type.displayL, color: c.text, margin: 0 }}>{step.title}</h2>
                {step.sub && <p style={{ ...type.bodyL, color: c.text3, marginTop: 12, lineHeight: 1.55 }}>{step.sub}</p>}

                <div style={{ marginTop: 28 }}>
                  {step.kind === "text" && (
                    <Input autoFocus value={profile.name || ""} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canContinue && next()} placeholder={step.ph}
                      style={{ fontSize: 22, fontWeight: 500, padding: "14px 16px" }} />
                  )}
                  {step.kind === "longtext" && (
                    <TextArea autoFocus value={profile.intentions || ""} onChange={(e) => setVal(e.target.value)} placeholder={step.ph} rows={4} style={{ fontSize: 16 }} />
                  )}
                  {step.kind === "choice" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      {step.opts.map((o) => {
                        const active = profile[step.id] === o.v;
                        return (
                          <motion.button key={o.v} onClick={() => choose(o.v)} whileTap={{ scale: 0.99 }}
                            className="atlas-btn"
                            style={{ textAlign: "left", cursor: "pointer", padding: "15px 18px", borderRadius: radius.md, width: "100%",
                              border: `1px solid ${active ? c.accent : c.border}`, background: active ? c.accentSoft : c.surface1,
                              boxShadow: active ? `0 0 0 1px ${c.accent}` : "none" }}>
                            <span style={{ ...type.bodyL, fontWeight: 600, color: active ? c.accent : c.text }}>{o.v}</span>
                            {o.note && <span style={{ ...type.small, color: c.text3, marginLeft: 10 }}>{o.note}</span>}
                          </motion.button>
                        );
                      })}
                    </div>
                  )}
                  {step.kind === "multi" && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {step.opts.map((o) => {
                        const active = (profile[step.id] || []).includes(o);
                        return (
                          <motion.button key={o} onClick={() => toggle(o)} whileTap={{ scale: 0.97 }} className="atlas-btn"
                            style={{ cursor: "pointer", padding: "10px 18px", borderRadius: radius.full,
                              border: `1px solid ${active ? c.accent : c.border}`, background: active ? c.accentSoft : c.surface1,
                              ...type.body, fontWeight: 500, color: active ? c.accent : c.text }}>{o}</motion.button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 32 }}>
                  {i > 0 && <Button variant="secondary" onClick={() => setI(i - 1)}>← Back</Button>}
                  {(isText || step.kind === "multi") && (
                    <Button onClick={next} disabled={!canContinue} glow style={{ marginLeft: "auto" }}>
                      {last ? "Finish" : (step.optional || step.kind === "multi") && !(profile[step.id] && profile[step.id].length) ? "Skip" : "Continue →"}
                    </Button>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 768px){ .ob-spine{ display:none !important; } } @media (min-width: 769px){ .ob-topbar{ display:none !important; } }`}</style>
    </div>
  );
}

// ============================================================
//  PROFILE EDITOR (slide-over)
// ============================================================
// Hoisted out of ProfileEditor so React reconciles the option chips instead of remounting all
// of them on every keystroke/selection inside the editor.
function Field2({ label, id, opts, multi, p, set }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Overline color={c.text3} style={{ marginBottom: 8 }}>{label}</Overline>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {opts.map(o => {
          const val = multi ? o : o.v;
          const on = multi ? (p[id] || []).includes(o) : p[id] === o.v;
          return (
            <button key={val} onClick={() => multi ? set(id, on ? (p[id]||[]).filter(x=>x!==o) : [...(p[id]||[]),o]) : set(id, o.v)}
              className="atlas-btn" aria-pressed={on}
              style={{ padding: "7px 14px", borderRadius: multi ? radius.full : radius.sm, cursor: "pointer",
                border: `1px solid ${on ? c.accent : c.border}`, background: on ? c.accentSoft : "transparent",
                ...type.small, color: on ? c.accent : c.text2, whiteSpace: "nowrap" }}>
              {val}{!multi && o.note ? <span style={{ color: c.text3, marginLeft: 6, fontSize: 11 }}>{o.note}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfileEditor({ profile, onSave, onClose, onSignOut }) {
  const [p, setP] = useState({ ...profile });
  function set(k, v) { setP(prev => ({ ...prev, [k]: v })); }

  return (
    <div style={{ padding: "26px 26px 60px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 26 }}>
        <div>
          <Overline color={c.accent} style={{ marginBottom: 6 }}>Investor profile</Overline>
          <h2 style={{ ...type.title, color: c.text, margin: 0 }}>Edit your profile</h2>
          <p style={{ ...type.small, color: c.text3, margin: "4px 0 0" }}>Changes update all stock scores immediately.</p>
        </div>
        <IconButton label="Close" onClick={onClose}><CloseIcon /></IconButton>
      </div>

      <Field label="Your name" style={{ marginBottom: 20 }}>
        <Input value={p.name || ""} onChange={e => set("name", e.target.value)} placeholder="Your name" style={{ fontWeight: 600, fontSize: 16 }} />
      </Field>

      <Field2 p={p} set={set} label="Risk tolerance" id="riskTolerance" opts={[{v:"Conservative",note:"Protect what I have"},{v:"Moderate",note:"Balanced"},{v:"Aggressive",note:"Swing for growth"}]} />
      <Field2 p={p} set={set} label="Time horizon" id="horizon" opts={[{v:"Short",note:"Under 1yr"},{v:"Medium",note:"1–5 yrs"},{v:"Long",note:"5yrs+"}]} />
      <Field2 p={p} set={set} label="Investment budget" id="budget" opts={[{v:"Under $1k"},{v:"$1k – 10k"},{v:"$10k – 50k"},{v:"$50k – 250k"},{v:"$250k +"}]} />
      <Field2 p={p} set={set} label="Primary goal" id="goal" opts={[{v:"Preserve capital"},{v:"Income & dividends"},{v:"Balanced growth"},{v:"Aggressive growth"}]} />
      <Field2 p={p} set={set} label="Investing style" id="philosophy" opts={[{v:"Value"},{v:"Growth"},{v:"Quality"},{v:"Momentum"},{v:"Dividends / income"},{v:"No strong style"}]} />
      <Field2 p={p} set={set} label="Target annual return" id="targetReturn" opts={[{v:"Safety first (~5%)"},{v:"Solid (8–12%)"},{v:"Ambitious (15–20%)"},{v:"Swing big (20%+)"}]} />
      <Field2 p={p} set={set} label="Position sizing preference" id="positionConviction" opts={[{v:"Spread across many"},{v:"Balanced mix"},{v:"Few high-conviction bets"}]} />
      <Field2 p={p} set={set} label="How hands-on are you?" id="activityLevel" opts={[{v:"Set and forget"},{v:"Check now and then"},{v:"Active"},{v:"Very hands-on"}]} />
      <Field2 p={p} set={set} label="Experience level" id="experience" opts={[{v:"New"},{v:"Some"},{v:"Experienced"},{v:"Professional"}]} />
      <Field2 p={p} set={set} label="If a stock drops 20%, you…" id="drawdownReaction" opts={[{v:"Sell most of it"},{v:"Trim a little"},{v:"Hold"},{v:"Buy more"}]} />
      <Field2 p={p} set={set} label="Income stability" id="incomeStability" opts={[{v:"Stable"},{v:"Somewhat variable"},{v:"Unpredictable"}]} />
      <Field2 p={p} set={set} label="Emergency fund" id="emergencyFund" opts={[{v:"Yes, fully"},{v:"Partly"},{v:"No"}]} />
      <Field2 p={p} set={set} label="Market preference" id="region" opts={[{v:"United States"},{v:"Europe"},{v:"Global mix"},{v:"No preference"}]} />
      <Field2 p={p} set={set} label="Sectors of interest" id="interests" multi opts={["Technology","Energy","Healthcare","Financials","Consumer","Industrials","Materials","Real estate","Utilities","Communications"]} />
      <Field2 p={p} set={set} label="Industries to avoid" id="avoid" multi opts={["Tobacco","Weapons","Fossil fuels","Gambling","Alcohol","Adult"]} />

      <Field label="In your own words (optional)" style={{ marginBottom: 24 }}>
        <TextArea value={p.intentions || ""} onChange={e => set("intentions", e.target.value)} placeholder="e.g. 'Build a retirement fund I won't touch for 20 years'" rows={3} />
      </Field>

      <Button size="lg" full glow onClick={() => onSave(p)}>Save profile</Button>
      {onSignOut && (
        <Button variant="ghost" full size="md" onClick={onSignOut} style={{ marginTop: 12, color: c.text3 }}>
          Sign out
        </Button>
      )}
    </div>
  );
}

// ============================================================
//  DOSSIER — two-column: sticky brief + scrolling evidence
// ============================================================
function Conclusion({ text }) {
  if (!text) return null;
  return (
    <Card accentEdge pad={16} style={{ background: c.accentSoft, borderColor: c.accentBorder, marginTop: 16 }}>
      <Overline color={c.accent} style={{ marginBottom: 7 }}>Summary</Overline>
      <p style={{ ...type.small, lineHeight: 1.65, color: c.text2, margin: 0 }}>{text}</p>
    </Card>
  );
}
function PillarRow({ label, score, sub }) {
  const col = scoreColor(score);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ ...type.small, fontWeight: 500, color: c.text }}>{label}{sub && <span style={{ ...type.caption, color: c.text3, marginLeft: 8 }}>{sub}</span>}</span>
        <span style={{ ...type.data, fontWeight: 600, color: col }}>{score != null ? Math.round(score) : "—"}</span>
      </div>
      <MeterBar score={score} />
    </div>
  );
}

function Results({ result, profile, backtestSnapshot, onOpenBacktest }) {
  const [tab, setTab] = useState("Fundamentals");
  const isMobile = useIsMobile();
  const r = result, overall = r.overall?.score;
  const act = r.overall?.action;
  const actColor = actionColor(act || "");

  const DataSources = () => r.dataSources?.length > 0 ? (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${c.hairline}` }}>
      <Overline color={c.text3} style={{ marginBottom: 8 }}>Sources</Overline>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{r.dataSources.map((s, i) => <Tag key={i}>{s}</Tag>)}</div>
    </div>
  ) : null;

  const sc = r.news?.sentimentScore || 0;
  const sCol = sc > 20 ? c.positive : sc < -20 ? c.negative : c.warning;

  // ── left brief ──
  const Brief = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card pad={20}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          {r.ticker && <StockLogo ticker={r.ticker} size={44} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {r.ticker && <span style={{ fontFamily: font.mono, fontWeight: 700, fontSize: 13, color: c.accent }}>{r.ticker}</span>}
              {act && <CallChip action={act} />}
            </div>
            <h2 style={{ ...type.heading, color: c.text, margin: "2px 0 0" }}>{r.company}</h2>
          </div>
        </div>

        {r._savedAt && (
          <div style={{ ...type.caption, color: c.warning, background: c.warningSoft, border: `1px solid rgba(251,184,69,0.3)`, borderRadius: radius.sm, padding: "8px 12px", marginBottom: 14, lineHeight: 1.5 }}>
            Saved dossier from {fmtHistoryDate(r._savedAt)} — prices, news and scores reflect that moment. Use "Update" in Past research for a fresh read.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 0 16px" }}>
          <ScoreRing score={overall} size={172} showGrade />
          <span style={{ ...type.overline, color: c.text3 }}>Score for {(profile.name || "you").toUpperCase()}</span>
        </div>

        {r.overall?.thesis && (
          <div style={{ background: c.surface2, borderLeft: `2px solid ${actColor}`, borderRadius: radius.sm, padding: "13px 15px", marginBottom: 16 }}>
            <p style={{ ...type.small, lineHeight: 1.6, color: c.text, margin: 0, fontWeight: 500 }}>{r.overall.thesis}</p>
          </div>
        )}

        <Overline color={c.accent} style={{ marginBottom: 12 }}>Pillars</Overline>
        <PillarRow label="Fundamentals" score={r.pillars?.fundamentals} />
        <PillarRow label="Valuation" score={r.pillars?.valuation} />
        <PillarRow label="Technicals" score={r.pillars?.technicals} />
        <PillarRow label="Risk (safety)" score={r.pillars?.risk} />
      </Card>

      {(r.analystConsensus?.rating || r.news?.overallSentiment) && (
        <Card pad={16}>
          {r.analystConsensus?.rating && (
            <div style={{ marginBottom: r.news?.overallSentiment ? 14 : 0 }}>
              <Overline color={c.text3} style={{ marginBottom: 8 }}>Wall Street consensus</Overline>
              <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ ...type.bodyStrong, color: r.analystConsensus.rating.includes("Buy") ? c.positive : r.analystConsensus.rating.includes("Sell") ? c.negative : c.text2 }}>{r.analystConsensus.rating}</span>
                {r.analystConsensus.targetPrice && <span style={{ ...type.data, color: c.text }}>PT {r.analystConsensus.targetPrice}</span>}
                {r.analystConsensus.upside && <span style={{ ...type.data, color: c.positive }}>{r.analystConsensus.upside}</span>}
              </div>
              {r.analystConsensus.numAnalysts > 0 && <div style={{ ...type.caption, color: c.text3, marginTop: 4 }}>{r.analystConsensus.numAnalysts} analysts · {r.analystConsensus.recentRevisions}</div>}
            </div>
          )}
          {r.news?.overallSentiment && (
            <div>
              <Overline color={c.text3} style={{ marginBottom: 8 }}>News sentiment</Overline>
              <div style={{ ...type.bodyStrong, color: sCol, marginBottom: 6 }}>{r.news.overallSentiment}</div>
              <MeterBar score={(sc + 100) / 2} color={sCol} height={4} />
            </div>
          )}
        </Card>
      )}
    </div>
  );

  // ── right evidence ──
  const Evidence = (
    <Card pad={20} style={{ minWidth: 0 }}>
      <Tabs value={tab} onChange={setTab} items={DOSSIER_TABS} style={{ marginBottom: 20 }} />
      <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          {(tab === "Fundamentals" || tab === "Technicals" || tab === "Risk") && (() => {
            const map = { Fundamentals: ["fundamentals", "Quality of the business — earnings, margins, balance sheet"], Technicals: ["technicals", "Price trend, momentum, and chart setup right now"], Risk: ["risk", "Higher = safer. Debt, volatility, moat, business risk."] };
            const [key, hint] = map[tab];
            const sec = r[key];
            const pscore = r.pillars?.[key];
            return (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, padding: "14px 16px", background: c.surface2, border: `1px solid ${c.hairline}`, borderRadius: radius.sm }}>
                  <ScoreRing score={pscore} size={56} stroke={5} />
                  <div><div style={{ ...type.bodyStrong, color: c.text }}>{tab}</div><div style={{ ...type.caption, color: c.text3 }}>{hint}</div></div>
                </div>
                {tab === "Technicals" && backtestSnapshot && (
                  <div style={{ padding: "16px 18px", background: c.surface2, border: `1px solid ${c.hairline}`, borderRadius: radius.sm, marginBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                      <Overline color={c.accent}>Backtest snapshot — SMA Crossover ({backtestSnapshot.fast}/{backtestSnapshot.slow})</Overline>
                      {onOpenBacktest && <Button variant="ghost" size="sm" onClick={onOpenBacktest}>Explore in Backtester →</Button>}
                    </div>
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 10 }}>
                      <div>
                        <div style={{ ...type.caption, color: c.text3, marginBottom: 3 }}>Strategy CAGR ({backtestSnapshot.periodYears}y)</div>
                        <div style={{ ...type.data, fontSize: 18, fontWeight: 600, color: backtestSnapshot.beats ? c.positive : c.negative }}>{backtestSnapshot.strategyStats.cagr}%</div>
                      </div>
                      <div>
                        <div style={{ ...type.caption, color: c.text3, marginBottom: 3 }}>Buy & hold CAGR</div>
                        <div style={{ ...type.data, fontSize: 18, fontWeight: 600, color: c.text2 }}>{backtestSnapshot.buyHoldStats.cagr}%</div>
                      </div>
                      <div>
                        <div style={{ ...type.caption, color: c.text3, marginBottom: 3 }}>Max drawdown</div>
                        <div style={{ ...type.data, fontSize: 18, fontWeight: 600, color: c.text2 }}>{backtestSnapshot.strategyStats.maxDrawdown}%</div>
                      </div>
                      <div>
                        <div style={{ ...type.caption, color: c.text3, marginBottom: 3 }}>Signals triggered</div>
                        <div style={{ ...type.data, fontSize: 18, fontWeight: 600, color: c.text2 }}>{backtestSnapshot.trades}</div>
                      </div>
                    </div>
                    <div style={{ ...type.small, color: c.text3, lineHeight: 1.5 }}>
                      {backtestSnapshot.beats
                        ? `A simple 50/200-day moving-average crossover would have beaten just buying and holding this stock over the last ${backtestSnapshot.periodYears} years.`
                        : `Just buying and holding this stock would have beaten a simple 50/200-day moving-average crossover over the last ${backtestSnapshot.periodYears} years — often the honest result for a strategy this simple.`}
                    </div>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 18 }}>
                  {(sec?.groups || []).map((g, i) => (
                    <MetricTable key={i} title={g.title} items={(g.items || []).map(it => ({ ...it, label: <GlossLabel text={it.label} /> }))} />
                  ))}
                </div>
                <Conclusion text={sec?.conclusion} />
                <DataSources />
              </div>
            );
          })()}

          {tab === "News" && (() => {
            const n = r.news;
            if (!n) return <EmptyState title="No news data" hint="No recent news was available for this name." />;
            const sentimentMap = { Positive: c.positive, Negative: c.negative, Neutral: c.text3 };
            return (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "16px 18px", background: c.surface2, border: `1px solid ${c.hairline}`, borderRadius: radius.sm, marginBottom: 18, flexWrap: "wrap" }}>
                  <div><div style={{ ...type.caption, color: c.text3, marginBottom: 3 }}>Overall sentiment</div><div style={{ ...type.title, fontSize: 20, color: sCol }}>{n.overallSentiment}</div></div>
                  <div style={{ flex: "1 1 200px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ ...type.caption, color: c.negative }}>Bearish −100</span>
                      <span style={{ ...type.data, color: sCol }}>{sc > 0 ? "+" : ""}{sc}</span>
                      <span style={{ ...type.caption, color: c.positive }}>+100 Bullish</span>
                    </div>
                    <MeterBar score={(sc + 100) / 2} color={sCol} height={6} />
                  </div>
                  {n.summary && <div style={{ flex: "2 1 300px", ...type.small, lineHeight: 1.55, color: c.text2, borderLeft: `2px solid ${sCol}`, paddingLeft: 14 }}>{n.summary}</div>}
                </div>
                {n.insiderActivity && (
                  <div style={{ padding: "14px 16px", background: c.surface2, border: `1px solid ${c.hairline}`, borderRadius: radius.sm, marginBottom: 14 }}>
                    <Overline color={c.accent} style={{ marginBottom: 8 }}>Insider activity</Overline>
                    <div style={{ ...type.small, color: c.text2, lineHeight: 1.55, marginBottom: (n.insiderActivity.transactions || []).length ? 10 : 0 }}>{n.insiderActivity.summary}</div>
                    {(n.insiderActivity.transactions || []).length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {n.insiderActivity.transactions.map((t, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...type.caption, color: c.text3 }}>
                            <span style={{ fontWeight: 600, color: t.type === "Buy" ? c.positive : t.type === "Sell" ? c.negative : c.text2 }}>{t.type}</span>
                            <span>{t.insider}</span>
                            {t.shares && <span>· {t.shares} sh</span>}
                            {t.value && <span>· {t.value}</span>}
                            {t.date && <span>· {t.date}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {(n.items || []).map((item, i) => {
                    const col = sentimentMap[item.sentiment] || c.text3;
                    const hasUrl = item.url && item.url.startsWith("http");
                    return (
                      <div key={i} style={{ padding: "14px 16px", background: c.surface2, border: `1px solid ${c.hairline}`, borderLeft: `3px solid ${col}`, borderRadius: radius.sm }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                          {hasUrl
                            ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="atlas-link" style={{ ...type.bodyStrong, color: c.text, lineHeight: 1.45 }}>{item.headline} ↗</a>
                            : <span style={{ ...type.bodyStrong, color: c.text, lineHeight: 1.45 }}>{item.headline}</span>}
                          <span style={{ ...type.caption, fontWeight: 600, color: col, whiteSpace: "nowrap" }}>{item.sentiment}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: item.impact ? 10 : 0, flexWrap: "wrap" }}>
                          {item.category && <Badge tone={item.category === "Insider Trading" ? "accent" : "neutral"}>{item.category}</Badge>}
                          <span style={{ ...type.caption, fontWeight: 600, color: c.text3 }}>{item.source}</span>
                          <span style={{ ...type.caption, color: c.text3 }}>· {item.date}</span>
                        </div>
                        {item.impact && <div style={{ ...type.small, color: c.text2, lineHeight: 1.55, borderTop: `1px solid ${c.hairline}`, paddingTop: 10 }}>{item.impact}</div>}
                      </div>
                    );
                  })}
                </div>
                <DataSources />
              </div>
            );
          })()}

          {tab === "Catalysts" && (
            <div>
              {r.analystConsensus?.rating && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 0, marginBottom: 20, border: `1px solid ${c.hairline}`, borderRadius: radius.sm, overflow: "hidden" }}>
                  {[
                    ["Consensus", r.analystConsensus.rating, r.analystConsensus.rating?.includes("Buy") ? c.positive : r.analystConsensus.rating?.includes("Sell") ? c.negative : c.text2],
                    ["Price Target", r.analystConsensus.targetPrice || "—", c.text],
                    ["Upside", r.analystConsensus.upside || "—", c.positive],
                    ["High / Low", r.analystConsensus.highTarget && r.analystConsensus.lowTarget ? `${r.analystConsensus.highTarget} / ${r.analystConsensus.lowTarget}` : "—", c.text],
                    ["Analysts", r.analystConsensus.numAnalysts || "—", c.text],
                  ].map(([label, val, col], i) => (
                    <div key={label} style={{ flex: "1 1 110px", padding: "13px 15px", background: i % 2 ? "transparent" : c.surface2, borderRight: `1px solid ${c.hairline}` }}>
                      <div style={{ ...type.caption, color: c.text3, marginBottom: 5 }}>{label}</div>
                      <div style={{ ...type.data, fontWeight: 600, color: col }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}
              <Overline color={c.text} style={{ marginBottom: 12, ...type.bodyStrong, color: c.text, textTransform: "none", letterSpacing: 0 }}>Upcoming catalysts</Overline>
              {(r.catalysts || []).length === 0 && <div style={{ ...type.small, color: c.text3 }}>No catalyst data available.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(r.catalysts || []).map((cat, i) => {
                  const dirCol = cat.direction === "Bullish" ? c.positive : cat.direction === "Bearish" ? c.negative : c.warning;
                  return (
                    <div key={i} style={{ display: "flex", border: `1px solid ${c.hairline}`, borderLeft: `3px solid ${dirCol}`, borderRadius: radius.sm, overflow: "hidden" }}>
                      <div style={{ padding: "13px 15px", flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ ...type.bodyStrong, color: c.text }}>{cat.label}</span>
                          {cat.timeframe && <Badge>{cat.timeframe}</Badge>}
                        </div>
                        <div style={{ ...type.small, color: c.text2, lineHeight: 1.55 }}>{cat.description}</div>
                      </div>
                      <div style={{ padding: "13px 15px", background: c.surface2, borderLeft: `1px solid ${c.hairline}`, display: "flex", alignItems: "center" }}>
                        <span style={{ ...type.caption, fontWeight: 700, color: dirCol }}>{cat.direction}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "Your fit" && (() => {
            const fitAct = r.fit?.action;
            const fitActCol = actionColor(fitAct || "") === c.text3 ? c.accent : actionColor(fitAct || "");
            return (
              <div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 20 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <ScoreRing score={r.fit?.score} size={120} />
                    <span style={{ ...type.caption, color: c.text3 }}>Fit for {profile.name || "you"}</span>
                  </div>
                  <div style={{ flex: "1 1 280px" }}>
                    <p style={{ ...type.body, lineHeight: 1.65, color: c.text2, margin: "0 0 14px" }}>{r.fit?.summary}</p>
                    {fitAct && <Badge tone={fitActCol === c.positive ? "positive" : fitActCol === c.negative ? "negative" : "accent"} style={{ fontSize: 13, padding: "8px 16px" }}>{fitAct}</Badge>}
                  </div>
                </div>
                {r.fit?.positionSizing && (
                  <Card accentEdge pad={14} style={{ background: c.accentSoft, borderColor: c.accentBorder, marginBottom: 14 }}>
                    <Overline color={c.accent} style={{ marginBottom: 6 }}>Position sizing</Overline>
                    <p style={{ ...type.small, lineHeight: 1.6, color: c.text2, margin: 0 }}>{r.fit.positionSizing}</p>
                  </Card>
                )}
                {Array.isArray(r.fit?.watchouts) && r.fit.watchouts.length > 0 && (
                  <div>
                    <Overline color={c.warning} style={{ marginBottom: 10 }}>Watchouts for {profile.name || "you"}</Overline>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {r.fit.watchouts.map((w, i) => (
                        <div key={i} style={{ display: "flex", gap: 12, ...type.small, color: c.text2, padding: "11px 14px", background: c.warningSoft, border: `1px solid rgba(251,184,69,0.3)`, borderRadius: radius.sm, lineHeight: 1.55 }}>
                          <span style={{ color: c.warning, flexShrink: 0 }}>!</span>{w}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <DataSources />
              </div>
            );
          })()}
        </motion.div>
    </Card>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} style={{ marginTop: 4 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 340px) 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ position: isMobile ? "static" : "sticky", top: 16 }}>{Brief}</div>
        {Evidence}
      </div>
      {Array.isArray(r.flags) && r.flags.length > 0 && (
        <Card pad={16} style={{ marginTop: 14 }}>
          <Overline color={c.text3} style={{ marginBottom: 8 }}>Caveats & limitations</Overline>
          {r.flags.map((f, i) => <div key={i} style={{ ...type.caption, color: c.text3, padding: "3px 0", lineHeight: 1.5 }}>· {f}</div>)}
        </Card>
      )}
    </motion.div>
  );
}

// ============================================================
//  DISCOVER — hero pick + opportunity grid
// ============================================================
function OpportunityCard({ pick, rank, onOpen, hero }) {
  const score = pick.fitScore != null ? Math.round(pick.fitScore) : null;
  return (
    <Card interactive onClick={onOpen} pad={hero ? 22 : 18} style={hero ? { gridColumn: "1 / -1" } : {}}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <StockLogo ticker={pick.ticker} size={hero ? 46 : 38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontFamily: font.mono, fontWeight: 700, fontSize: 13, color: c.accent }}>{pick.ticker}</span>
            <span style={{ ...type.bodyStrong, color: c.text }}>{pick.company}</span>
            {pick.sector && <Badge>{pick.sector}</Badge>}
            <span style={{ ...type.caption, color: c.text3, marginLeft: "auto" }}>#{rank}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{(pick.tags || []).slice(0, 3).map((t, i) => <Tag key={i}>{t}</Tag>)}</div>
        </div>
        <div style={{ flexShrink: 0 }}><ScoreRing score={pick.fitScore} size={hero ? 76 : 64} stroke={hero ? 6 : 5} sub="fit" /></div>
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 280px" }}>
          {pick.reason && (
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <span style={{ color: c.positive, flexShrink: 0, fontSize: 12, marginTop: 1 }}>▲</span>
              <span style={{ ...type.small, color: c.text2, lineHeight: 1.5 }}>{pick.reason}</span>
            </div>
          )}
          {pick.concern && (
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ color: c.warning, flexShrink: 0, fontSize: 12, marginTop: 1 }}>!</span>
              <span style={{ ...type.small, color: c.text3, lineHeight: 1.5 }}>{pick.concern}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          {(pick.snapshot || []).slice(0, 3).map((m, i) => (
            <span key={i} style={{ ...type.caption, color: c.text3, whiteSpace: "nowrap" }}>{m.label} <b style={{ color: c.text, fontFamily: font.mono }}>{m.value}</b></span>
          ))}
          <span style={{ ...type.caption, fontWeight: 600, color: c.accent, marginTop: 2 }}>Full dossier →</span>
        </div>
      </div>
    </Card>
  );
}

// ============================================================
//  PORTFOLIO — holding row
// ============================================================
function ExposureBar({ segments }) {
  if (!segments.length) return null;
  return (
    <div style={{ display: "flex", height: 8, borderRadius: 99, overflow: "hidden", gap: 2, background: c.surface2 }}>
      {segments.map((s, i) => (
        <div key={i} title={`${s.ticker} · ${s.pct.toFixed(1)}%`} style={{ width: `${s.pct}%`, background: s.color, minWidth: 2 }} />
      ))}
    </div>
  );
}
// Visible proof prices are actually live, not just "fetched once and frozen" — ticks its own label every
// second off a real timestamp so the user can watch staleness count up between background refreshes.
function LiveIndicator({ loading, lastUpdate }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!lastUpdate) return;
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [lastUpdate]);
  if (loading) {
    return <span style={{ ...type.overline, color: c.text3, display: "inline-flex", alignItems: "center", gap: 6 }}><Spinner size={10} /> Refreshing…</span>;
  }
  if (!lastUpdate) return null;
  const secs = Math.max(0, Math.round((Date.now() - lastUpdate) / 1000));
  const label = secs < 5 ? "just now" : secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  return (
    <span style={{ ...type.overline, color: c.text3, display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.positive, boxShadow: `0 0 6px ${c.positive}`, flexShrink: 0 }} />
      Live · updated {label}
    </span>
  );
}

function HoldingRow({ h, livePrice, fxRates, review, onOpen, onRemove }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // Everything in this row displays in the holding's OWN recorded currency (h.currency) — never silently
  // mixed with whatever currency the live quote happens to come back in. Cost is already native (no
  // conversion needed); the live price is converted into h.currency only when its trading currency differs
  // (e.g. a USD-listed stock bought via a EUR-reporting broker) so Price/Value/P&L stay one consistent unit.
  const rowCurrency = normalizeCurrencyCode(h.currency || "USD");
  const rawPrice = livePrice?.price ?? (review ? parseNum(review.currentPrice) : null);
  const liveCurrency = normalizeCurrencyCode(livePrice?.currency || rowCurrency);
  const curPrice = fxConvert(rawPrice, liveCurrency, rowCurrency, fxRates);
  const wasConverted = curPrice != null && liveCurrency !== rowCurrency;
  const cost = parseNum(h.cost);
  const sh = parseNum(h.shares);
  const foreignCur = rowCurrency !== "USD" ? rowCurrency : null;
  const pl = curPrice != null && cost != null ? (curPrice - cost) * sh : null;
  const plPct = curPrice != null && cost ? ((curPrice - cost) / cost) * 100 : null;
  const value = curPrice != null && sh != null ? curPrice * sh : null;
  const act = review?.action;
  const name = livePrice?.name ?? review?.company ?? "";
  const isUp = plPct != null && plPct >= 0;

  if (isMobile) {
    return (
      <div className="atlas-row" style={{ borderBottom: `1px solid ${c.hairline}`, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <StockLogo ticker={h.ticker} size={30} />
        <button onClick={onOpen} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontFamily: font.mono, fontWeight: 700, fontSize: 13, color: c.accent }}>{h.ticker}</span>
            {act && <CallChip action={act} />}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {value != null && <span style={{ ...type.data, color: c.text }}>{fmtCurrency(value, rowCurrency)}</span>}
            {plPct != null && <span style={{ ...type.data, color: isUp ? c.positive : c.negative }}>{isUp ? "+" : ""}{plPct.toFixed(2)}%</span>}
          </div>
        </button>
        <div style={{ textAlign: "right" }}>
          {curPrice != null && <div style={{ ...type.data, color: c.text }}>{fmtCurrency(curPrice, rowCurrency)}</div>}
          <div style={{ fontFamily: font.mono, fontSize: 10, color: c.text3 }}>{fmtShares(h.shares)} sh</div>
        </div>
        <IconButton label="Remove" onClick={onRemove} size={30} style={{ color: c.text3 }}>×</IconButton>
      </div>
    );
  }

  return (
    <div style={{ borderBottom: `1px solid ${c.hairline}` }}>
      <div className="atlas-row" style={{ display: "grid", gridTemplateColumns: "44px 1fr 95px 80px 95px 110px 120px 92px 60px", alignItems: "center", padding: "0 4px" }}>
        <div style={{ padding: "13px 0 13px 12px" }}><StockLogo ticker={h.ticker} size={30} /></div>
        <button onClick={onOpen} style={{ textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "13px 12px 13px 10px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
            <span style={{ fontFamily: font.mono, fontWeight: 700, fontSize: 13, color: c.accent }}>{h.ticker}</span>
            {foreignCur && <Badge tone="warning" style={{ fontSize: 9, padding: "1px 5px" }}>{foreignCur}</Badge>}
          </div>
          {name && <div style={{ ...type.caption, color: c.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{name}</div>}
        </button>
        <div style={{ padding: "13px 8px", textAlign: "right" }}>
          <span style={{ ...type.data, color: curPrice != null ? c.text : c.text3 }}>{curPrice != null ? fmtCurrency(curPrice, rowCurrency) : "—"}</span>
          {wasConverted && <div style={{ fontFamily: font.mono, fontSize: 9, color: c.text3 }} title="Live price converted into this holding's recorded currency">{fmtCurrency(rawPrice, liveCurrency)} native</div>}
        </div>
        <div style={{ padding: "13px 8px", textAlign: "right", ...type.data, color: c.text2 }}>{fmtShares(h.shares)}</div>
        <div style={{ padding: "13px 8px", textAlign: "right", ...type.data, color: c.text2 }}>{fmtCurrency(cost, rowCurrency)}</div>
        <div style={{ padding: "13px 8px", textAlign: "right", ...type.data, color: value != null ? c.text : c.text3 }}>{value != null ? fmtCurrency(value, rowCurrency) : "—"}</div>
        <div style={{ padding: "13px 8px", textAlign: "right" }}>
          {pl != null ? (
            <>
              <div style={{ ...type.data, color: isUp ? c.positive : c.negative }}>{isUp ? "+" : ""}{fmtCurrency(pl, rowCurrency)}</div>
              <div style={{ fontFamily: font.mono, fontSize: 10, color: isUp ? c.positive : c.negative, opacity: 0.85 }}>{isUp ? "+" : ""}{plPct.toFixed(2)}%</div>
            </>
          ) : <span style={{ ...type.data, color: c.text3 }}>—</span>}
        </div>
        <div style={{ padding: "13px 8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {act ? <CallChip action={act} /> : review?.scoreForYou != null
            ? <span style={{ ...type.data, fontWeight: 700, color: scoreColor(review.scoreForYou) }}>{Math.round(review.scoreForYou)}</span> : null}
        </div>
        <div style={{ padding: "13px 6px 13px 0", display: "flex", gap: 2, alignItems: "center", justifyContent: "flex-end" }}>
          {review?.rationale && <IconButton label="Details" size={28} onClick={() => setOpen(o => !o)}><ChevronIcon open={open} /></IconButton>}
          <IconButton label="Remove" size={28} onClick={onRemove} style={{ color: c.text3 }}>×</IconButton>
        </div>
      </div>
      <AnimatePresence>
        {open && review?.rationale && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: "hidden" }}>
            <div style={{ ...type.small, lineHeight: 1.55, color: c.text2, padding: "0 16px 14px 66px" }}>{review.rationale}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
//  HELP CHAT (floating)
// ============================================================
const HELP_SYSTEM = `You are Atlas Assistant — the in-app help guide for Atlas, an AI-powered stock research app.

ABOUT ATLAS:
- Discover tab: AI scans global markets and surfaces stocks ranked by fit to the user's investor profile
- Portfolio tab: users track their holdings, see live P&L, and run an AI buy/hold/sell analysis on each position
- Research tab: deep AI dossier on any stock — fundamentals, technicals, risk, news, analyst consensus, all scored to their profile
- Backtest tab: test trading strategies (SMA crossover, RSI, momentum, earnings momentum, P/E threshold, etc.) on historical data

FINANCIAL TERMS you can explain clearly and simply:
P/E ratio, P/B ratio, EV/EBITDA, PEG, FCF yield, CAGR, Sharpe Ratio, Max Drawdown, RSI, SMA, EPS, dividend yield, beta, market cap, gross/net margin, ROE, ROIC, short interest, analyst consensus, and more.

HOW TO RESPOND:
- Be concise and friendly — this is a chat, not an essay
- Use plain English; avoid jargon unless explaining a term
- For financial terms: give a short definition, then a practical example
- For app questions: give clear step-by-step guidance
- For strategy questions: explain what the strategy does and when it works
- For non-finance/non-app questions: politely redirect — "I'm best at finance and Atlas questions"
- Never give personalised investment advice ("you should buy X") — explain concepts only
- Keep responses under ~150 words unless a longer explanation is genuinely needed`;

function HelpChat() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hi! I'm the Atlas assistant. Ask me anything about the app or finance — P/E ratios, how the backtester works, what CAGR means, anything." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 80); }, [open]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function send() {
    const q = input.trim(); if (!q || loading) return;
    const next = [...messages, { role: "user", text: q }];
    setMessages(next); setInput(""); setLoading(true);
    try {
      // The canned greeting is UI-only. It must NOT be sent upstream: the Messages API requires
      // messages[0] to be a user turn, so including the greeting 400s every single request —
      // which meant this chat never worked at all until the greeting was filtered out.
      const history = next
        .filter((m, i) => !(i === 0 && m.role === "assistant"))
        .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
      // Thinking disabled on purpose: this is a snappy help chat, not analysis — adaptive
      // thinking would add seconds of silence before short answers.
      const chatBody = JSON.stringify({ model: AI_MODEL, max_tokens: 800, system: HELP_SYSTEM, messages: history, thinking: { type: "disabled" } });
      const doSend = async (forceRefresh) => fetch(`${API_BASE}/api/messages`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(await aiAuthHeaders(forceRefresh)) },
        body: chatBody,
      });
      let resp = await doSend(false);
      if (resp.status === 401 && auth?.currentUser) resp = await doSend(true);   // recover from a stale ID token
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      setMessages(m => [...m, { role: "assistant", text: text || "Sorry, I couldn't generate a response. Try again." }]);
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", text: "Something went wrong. Try again." }]);
    } finally { setLoading(false); }
  }
  const SUGGESTIONS = ["What is a P/E ratio?", "How does the backtester work?", "What does CAGR mean?", "How do I add a non-US stock?"];

  return (
    <>
      {/* On mobile the FAB must clear the bottom nav (62px + safe area) — parked at bottom:24 it
          sat directly on top of the "Backtest" tab and intercepted its taps. */}
      <motion.button onClick={() => setOpen(o => !o)} whileTap={{ scale: 0.94 }} aria-label="Atlas help"
        style={{ position: "fixed", bottom: isMobile ? "calc(76px + env(safe-area-inset-bottom))" : 24, right: isMobile ? 14 : 24, zIndex: 800, width: 52, height: 52, borderRadius: "50%",
          background: open ? c.surface3 : c.accent, border: `1px solid ${open ? c.border : c.accent}`, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", boxShadow: open ? shadow.e2 : shadow.glow, color: open ? c.text2 : "#fff" }}>
        {open ? <CloseIcon /> : <HelpIcon />}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.2 }}
            style={{ position: "fixed", bottom: isMobile ? "calc(140px + env(safe-area-inset-bottom))" : 90, right: isMobile ? 14 : 24, zIndex: 800, width: 370, maxWidth: "calc(100vw - 28px)", maxHeight: isMobile ? "min(480px, calc(100dvh - 220px))" : 540, display: "flex", flexDirection: "column",
              background: c.surface1, border: `1px solid ${c.border}`, borderRadius: radius.lg, boxShadow: shadow.e3, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${c.hairline}`, display: "flex", alignItems: "center", gap: 10, background: c.surface2 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: c.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff" }}><HelpIcon size={15} /></div>
              <div>
                <div style={{ ...type.bodyStrong, color: c.text }}>Atlas Assistant</div>
                <div style={{ ...type.caption, color: c.text3 }}>Ask anything about the app or finance</div>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "85%", padding: "9px 13px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: m.role === "user" ? c.accent : c.surface2, border: m.role === "user" ? "none" : `1px solid ${c.hairline}` }}>
                    <span style={{ ...type.small, lineHeight: 1.55, color: m.role === "user" ? "#fff" : c.text, whiteSpace: "pre-wrap" }}>{m.text}</span>
                  </div>
                </div>
              ))}
              {loading && <div style={{ display: "flex", justifyContent: "flex-start" }}><div style={{ padding: "11px 14px", borderRadius: 12, background: c.surface2, border: `1px solid ${c.hairline}` }}><Spinner size={14} /></div></div>}
              {messages.length === 1 && !loading && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingBottom: 4 }}>
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50); }} className="atlas-btn"
                      style={{ ...type.caption, color: c.text2, background: "transparent", border: `1px solid ${c.border}`, borderRadius: radius.full, padding: "5px 12px", cursor: "pointer" }}>{s}</button>
                  ))}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div style={{ padding: "10px 12px", borderTop: `1px solid ${c.hairline}`, display: "flex", gap: 8, background: c.surface2 }}>
              <Input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()} placeholder="Ask a question…" style={{ background: c.surface1 }} />
              <Button size="md" onClick={send} disabled={!input.trim() || loading}>Send</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ============================================================
//  NAV — rail (desktop) + bottom (mobile) + topbar
// ============================================================
const NAV_ITEMS = [
  ["home", "Today", (p) => <HomeIcon active={p} />],
  ["discover", "Discover", (p) => <CompassIcon active={p} />],
  ["portfolio", "Portfolio", (p) => <WalletIcon active={p} />],
  ["research", "Research", (p) => <SearchIcon active={p} />],
  ["backtest", "Backtest", (p) => <ChartIcon active={p} />],
];

function NavRail({ nav, setNav, profile, onEdit, onSignOut, holdingsCount }) {
  return (
    <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 76, background: c.sunken, borderRight: `1px solid ${c.hairline}`, display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0", zIndex: 100 }}>
      <button onClick={() => setNav("home")} aria-label="Atlas home" style={{ background: "none", border: "none", cursor: "pointer", marginBottom: 18 }}><AtlasMark size={32} /></button>
      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, width: "100%", alignItems: "center" }}>
        {NAV_ITEMS.map(([k, label, icon]) => {
          const on = nav === k;
          return (
            <button key={k} onClick={() => setNav(k)} title={label} aria-label={label} className="atlas-btn"
              style={{ position: "relative", width: 60, padding: "9px 0", borderRadius: radius.md, border: "none", cursor: "pointer",
                background: on ? c.accentSoft : "transparent", color: on ? c.accent : c.text3,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              {on && <motion.div layoutId="rail-ind" transition={{ type: "spring", stiffness: 420, damping: 38 }} style={{ position: "absolute", left: 0, top: 12, bottom: 12, width: 2.5, background: c.accent, borderRadius: 99 }} />}
              {icon(on)}
              <span style={{ fontFamily: font.sans, fontSize: 9.5, fontWeight: on ? 600 : 500 }}>{label}{k === "portfolio" && holdingsCount ? ` ·${holdingsCount}` : ""}</span>
            </button>
          );
        })}
      </nav>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        <IconButton label="Edit profile" onClick={onEdit} size={40}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: c.accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", ...type.bodyStrong }}>{(profile?.name || "U")[0].toUpperCase()}</div>
        </IconButton>
        {onSignOut && <IconButton label="Sign out" onClick={onSignOut} size={40}><SignOutIcon /></IconButton>}
      </div>
    </div>
  );
}

function TopBar({ title, onSearch }) {
  const [q, setQ] = useState("");
  const searchRef = useRef(null);
  // The placeholder advertises ⌘K — make it real (Ctrl+K on Windows/Linux).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 20, background: c.canvas, borderBottom: `1px solid ${c.hairline}`,
      display: "flex", alignItems: "center", gap: 16, padding: "0 28px", height: 52, margin: "0 -36px 0", }}>
      <h1 style={{ ...type.bodyStrong, fontSize: 15, color: c.text, margin: 0, flexShrink: 0 }}>{title}</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) { onSearch(q.trim()); setQ(""); } }}
        style={{ marginLeft: "auto", position: "relative", width: "min(320px, 38vw)" }}>
        <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: c.text3, pointerEvents: "none" }}><SearchIcon size={14} /></span>
        <Input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Research any ticker…  ⌘K" style={{ paddingLeft: 33, height: 32, fontSize: 13, background: c.surface1 }} />
      </form>
    </div>
  );
}

function BottomNav({ nav, setNav, holdingsCount }) {
  return (
    // Height grows BY the safe-area inset — padding inside a fixed 62px used to squeeze the
    // actual tab buttons on notched phones.
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: "calc(62px + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)", background: c.sunken, borderTop: `1px solid ${c.hairline}`, display: "flex", zIndex: 200 }}>
      {NAV_ITEMS.map(([k, label, icon]) => {
        const on = nav === k;
        return (
          <button key={k} onClick={() => setNav(k)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", color: on ? c.accent : c.text3, position: "relative" }}>
            {on && <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 26, height: 2, background: c.accent, borderRadius: 2 }} />}
            {icon(on)}
            <span style={{ fontFamily: font.sans, fontSize: 9, fontWeight: on ? 600 : 500 }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
//  ROOT
// ============================================================
export default function VerdictApp() {
  const isMobile = useIsMobile();
  const [phase, setPhase] = useState("onboarding");
  const [profile, setProfile] = useState(null);
  const [nav, setNav] = useState("home");
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(undefined);

  useEffect(() => {
    if (!auth) { setFirebaseUser(null); return; }
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user || null);
      if (user) await saveUserToFirestore(user);
    });
    return unsub;
  }, []);

  // research / dossier
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [backtestSnapshot, setBacktestSnapshot] = useState(null);
  const [researchHistory, setResearchHistory] = useState([]);
  const timerRef = useRef(null);

  // discover
  const [universe, setUniverse] = useState("Global all-markets");
  const [recs, setRecs] = useState(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState(null);

  // portfolio
  const [holdings, setHoldings] = useState([]);
  const [spareCash, setSpareCash] = useState("");
  const [spareCashCurrency, setSpareCashCurrency] = useState("USD");
  const [review, setReview] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [nt, setNt] = useState(""); const [ns, setNs] = useState(""); const [nc, setNc] = useState(""); const [ncur, setNcur] = useState("USD");
  const [fxRates, setFxRates] = useState({});
  const [livePrices, setLivePrices] = useState({});
  const [livePricesLoading, setLivePricesLoading] = useState(false);
  const [lastPriceUpdate, setLastPriceUpdate] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importAnalyzing, setImportAnalyzing] = useState(false);
  const [importError, setImportError] = useState(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState(null);
  const importRef = useRef(null);
  const [portfolioTab, setPortfolioTab] = useState("holdings");
  const [newsItems, setNewsItems] = useState(null);
  const [newsInsiderActivity, setNewsInsiderActivity] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);

  // market-wide news widget (Today screen) — general market movers, independent of holdings
  const [marketNews, setMarketNews] = useState(null);
  const [marketNewsLoading, setMarketNewsLoading] = useState(false);
  const [marketNewsError, setMarketNewsError] = useState(null);
  const marketNewsAtRef = useRef(0);   // when the shown briefing was fetched (for stale-while-revalidate)
  const mnBgDone = useRef(false);      // one silent background refresh per session

  useEffect(() => {
    (async () => {
      try {
        const p = await kvGet("atlas_profile");
        const h = await kvGet("atlas_holdings");
        const cash = await kvGet("atlas_spare_cash");
        const cashCur = await kvGet("atlas_spare_cash_currency");
        const rh = await kvGet("atlas_research_history");
        if (Array.isArray(h)) setHoldings(h);
        if (cash != null) setSpareCash(String(cash));
        if (cashCur) setSpareCashCurrency(cashCur);
        if (Array.isArray(rh)) setResearchHistory(rh);
        // Instant-on-revisit: rehydrate the last market news + top picks from cache so the Today
        // screen shows them immediately instead of re-running a 20–40s live search every visit.
        // Only within a freshness window, so genuinely stale results aren't shown as current — the
        // Refresh/Load buttons re-scan on demand, and a fresh top-picks cache also skips the
        // auto-scan (the previous behavior triggered a full Discover scan on EVERY page load).
        const FRESH_MS = 8 * 3600 * 1000;
        const mn = await kvGet("atlas_market_news");
        if (mn?.data && mn.at && Date.now() - mn.at < FRESH_MS) { setMarketNews(mn.data); marketNewsAtRef.current = mn.at; }
        const rc = await kvGet("atlas_recs");
        const recsFresh = !!(rc?.data && rc.at && Date.now() - rc.at < FRESH_MS);
        if (recsFresh) { setRecs(rc.data); recsAtRef.current = rc.at; }
        if (p && p.name) { setProfile(p); setPhase("app"); if (!recsFresh) setAutoDiscover(true); }
      } catch {}
    })();
  }, []);

  // FX rates: retry with backoff on failure (a single silent failure used to leave multi-currency
  // portfolios stuck at "—" for the whole session) and refresh every few hours for long sessions.
  useEffect(() => {
    let cancelled = false, timer;
    const loadFx = async (attempt = 0) => {
      try {
        const r = await fetch(`${API_BASE}/api/fx`);
        const d = await r.json();
        if (!cancelled && d.rates) { setFxRates(d.rates); return; }
        throw new Error("no rates");
      } catch {
        if (!cancelled && attempt < 5) timer = setTimeout(() => loadFx(attempt + 1), Math.min(60000, 4000 * 2 ** attempt));
      }
    };
    loadFx();
    const refresh = setInterval(() => loadFx(), 6 * 3600 * 1000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(refresh); };
  }, []);

  // ---- cross-device sync ----
  // On sign-in, the cloud copy is the durable one: hydrate from it when it exists, otherwise
  // seed it from whatever this device already has (first sign-in after local-only use). Keyed
  // by uid so switching accounts re-hydrates instead of showing the previous user's data.
  const syncedUid = useRef(null);
  const cloudSaveTimer = useRef(null);
  function cloudSave(partial, debounceMs = 0) {
    const uid = auth?.currentUser?.uid;
    if (!uid) return;
    if (!debounceMs) { saveUserData(uid, partial); return; }
    clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = setTimeout(() => saveUserData(uid, partial), debounceMs);
  }
  useEffect(() => {
    if (!firebaseUser || syncedUid.current === firebaseUser.uid) return;
    syncedUid.current = firebaseUser.uid;
    (async () => {
      const hadLocalProfile = !!(await kvGet("atlas_profile"))?.name;
      const cloud = await loadUserData(firebaseUser.uid);
      if (cloud?.profile?.name) {
        setProfile(cloud.profile); kvSet("atlas_profile", cloud.profile);
        if (Array.isArray(cloud.holdings)) { setHoldings(cloud.holdings); kvSet("atlas_holdings", cloud.holdings); }
        if (cloud.spareCash != null) { setSpareCash(String(cloud.spareCash)); kvSet("atlas_spare_cash", String(cloud.spareCash)); }
        if (cloud.spareCashCurrency) { setSpareCashCurrency(cloud.spareCashCurrency); kvSet("atlas_spare_cash_currency", cloud.spareCashCurrency); }
        if (Array.isArray(cloud.researchHistory) && cloud.researchHistory.length) { setResearchHistory(cloud.researchHistory); kvSet("atlas_research_history", cloud.researchHistory); }
        setPhase("app");
        if (!hadLocalProfile) setAutoDiscover(true); // fresh device — kick off the first scan
      } else {
        // Nothing in the cloud yet — push this device's data up so the account is seeded.
        const p = await kvGet("atlas_profile");
        const h = await kvGet("atlas_holdings");
        const cash = await kvGet("atlas_spare_cash");
        const cur = await kvGet("atlas_spare_cash_currency");
        const rh = await kvGet("atlas_research_history");
        const seed = {};
        if (p?.name) seed.profile = p;
        if (Array.isArray(h)) seed.holdings = h;
        if (cash != null) seed.spareCash = String(cash);
        if (cur) seed.spareCashCurrency = cur;
        if (Array.isArray(rh) && rh.length) seed.researchHistory = rh.slice(0, 12);
        if (Object.keys(seed).length) saveUserData(firebaseUser.uid, seed);
      }
    })();
  }, [firebaseUser]);

  const priceFetchSeq = useRef(0);
  // Monotonic id for "which dossier is currently being shown" — evaluate() and openResearchHistory()
  // both bump it so a slower in-flight request can't overwrite a newer one's result/snapshot.
  const evalSeq = useRef(0);
  const discoverSeq = useRef(0);   // same idea for the Discover scan, so switching universe mid-scan wins
  const recsAtRef = useRef(0);     // real time the shown picks were scanned (the model's own "asOf" is unreliable)
  const tickersKey = holdings.map(h => h.ticker).join(",");
  const fetchLivePrices = useCallback(async (background) => {
    if (!holdings.length) { setLivePrices({}); return; }
    const seq = ++priceFetchSeq.current;
    if (!background) setLivePricesLoading(true);
    const results = await Promise.all(holdings.map(async h => {
      try {
        const r = await fetch(apiUrl(`/api/history?ticker=${encodeURIComponent(h.ticker)}&range=5d&interval=1d`));
        const d = await r.json();
        if (d.prices?.length) {
          const latest = d.prices[d.prices.length - 1];
          return [h.ticker, { price: latest.close, currency: d.currency, name: d.name }];
        }
      } catch (_) {}
      return [h.ticker, null];
    }));
    // If the holdings changed again while this fetch was in flight, a newer fetch has started;
    // discard this stale call's results so its older `held` set can't drop a just-added ticker's
    // price, and so it doesn't clear the loading flag while the newer fetch is still running.
    if (seq !== priceFetchSeq.current) return;
    // Merge instead of replace: a transient failure for one ticker keeps its last known price
    // on screen rather than blanking it to "—" while the "Live · updated just now" label claims
    // everything is fresh. Tickers no longer held are dropped.
    const held = new Set(holdings.map(h => h.ticker));
    setLivePrices(prev => {
      const map = {};
      for (const [t, v] of results) {
        const kept = v || prev[t];
        if (kept) map[t] = kept;
      }
      for (const t of Object.keys(prev)) if (held.has(t) && !(t in map)) map[t] = prev[t];
      return map;
    });
    setLivePricesLoading(false);
    if (results.some(([, v]) => v)) setLastPriceUpdate(Date.now());
  }, [tickersKey]);

  // Fetch immediately whenever the holding list changes...
  useEffect(() => { fetchLivePrices(false); }, [fetchLivePrices]);

  // ...then keep refreshing quietly in the background while the portfolio is actually on screen,
  // so prices don't go stale the moment you stop touching the holdings list.
  useEffect(() => {
    if (!holdings.length || (nav !== "home" && nav !== "portfolio")) return;
    const id = setInterval(() => fetchLivePrices(true), 45000);
    return () => clearInterval(id);
  }, [fetchLivePrices, nav, holdings.length]);

  const [autoDiscover, setAutoDiscover] = useState(false);
  useEffect(() => { if (autoDiscover && profile) { setAutoDiscover(false); discover(); } }, [autoDiscover, profile]);
  // Each tab is a different page, not a scroll position within one — carrying a deep scroll
  // offset from Research into Portfolio just dumps the user mid-table.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [nav]);
  // Backtester mounts on first visit and then stays mounted (hidden) so its state survives tab switches.
  const [backtestMounted, setBacktestMounted] = useState(false);
  useEffect(() => { if (nav === "backtest") setBacktestMounted(true); }, [nav]);
  // Market news widget loads once per session the first time the Today screen is visited —
  // independent of holdings, so it's useful even before the user has added any positions.
  // Stale-while-revalidate for the Today market briefing: if nothing is cached, scan in the
  // foreground (spinner) — this is the only case the user waits on. If a cached briefing is already
  // showing, refresh it silently in the background (no spinner) at most once per session, and only
  // when it's more than 30 min old — so returning to Today shows the last news instantly.
  useEffect(() => {
    if (nav !== "home" || !profile) return;
    if (!marketNews) { if (!marketNewsLoading) fetchMarketNews(false); return; }
    if (!mnBgDone.current && marketNewsAtRef.current && Date.now() - marketNewsAtRef.current > 30 * 60 * 1000) {
      mnBgDone.current = true;
      fetchMarketNews(true);
    }
  }, [nav, profile, marketNews]);

  function finishOnboarding(p) { setProfile(p); kvSet("atlas_profile", p); cloudSave({ profile: p }); setPhase("app"); setNav("home"); setAutoDiscover(true); }
  function saveProfile(p) { setProfile(p); kvSet("atlas_profile", p); cloudSave({ profile: p }); setShowProfileEditor(false); setRecs(null); setReview(null); }
  function updateSpareCash(v, currency) {
    setSpareCash(v); kvSet("atlas_spare_cash", v);
    // Tag the amount with whatever currency it's actually in — same pattern as a holding's own currency —
    // so it can always be converted to match Portfolio Value's currency at display time, never hardcoded to USD.
    if (currency) { setSpareCashCurrency(currency); kvSet("atlas_spare_cash_currency", currency); }
    // Debounced: this fires per keystroke while typing an amount — one Firestore write at the end is enough.
    cloudSave({ spareCash: v, ...(currency ? { spareCashCurrency: currency } : {}) }, 900);
  }
  function cycleMessages() {
    if (timerRef.current) clearInterval(timerRef.current);   // don't leak a prior run's interval
    let k = 0; setMsgIdx(0); setElapsedSec(0);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      k = (k + 1) % LOADING_MSGS.length; setMsgIdx(k);
      setElapsedSec(Math.round((Date.now() - start) / 1000));
    }, 2400);
  }
  function persistHoldings(h) { setHoldings(h); kvSet("atlas_holdings", h); cloudSave({ holdings: h }); }

  // ---- deep dossier ----
  async function evaluate(symbolArg) {
    const name = ((typeof symbolArg === "string" && symbolArg) ? symbolArg : query).trim();
    if (!name) return;
    // Don't silently no-op when a dossier is already loading — tapping a second pick used to do
    // nothing (no nav, no feedback). Instead navigate and supersede: the newest requested ticker
    // wins, and a slower earlier request bails at its guards below instead of clobbering the result.
    const seq = ++evalSeq.current;
    setNav("research"); setLoading(true); setError(null); setResult(null); setBacktestSnapshot(null); cycleMessages();
    // Ground-truth technicals/performance computed directly from real price history via Atlas's own
    // backtest engine (src/lib/marketStats.js) — not searched for or estimated by the model. Only
    // resolves when the query is already a ticker; falls back silently to search-based technicals
    // (unchanged prior behavior) when it's a company name the model has to resolve itself first.
    const histStats = looksLikeTicker(name) ? await fetchHistoricalStats(name.toUpperCase()) : null;
    // Purely client-computed, independent of the AI call — "would a simple 50/200-day SMA crossover
    // have beaten just buying and holding this stock" is a real backtest result, not something the
    // model should guess at, so it's rendered straight from marketStats.js rather than routed
    // through the dossier prompt/schema at all. Tagged with its ticker so it can never be rendered
    // against a different company's dossier (e.g. after opening a saved entry for another stock).
    if (seq !== evalSeq.current) return;   // a newer evaluate/open superseded this one
    if (histStats?.prices) {
      const snap = backtestSmaCrossover(histStats.prices);
      setBacktestSnapshot(snap ? { ...snap, ticker: (histStats.ticker || name).toUpperCase() } : null);
    }
    const histBlock = histStats ? `
═══════════════════════════════════════
REAL COMPUTED PRICE HISTORY — GROUND TRUTH (from Atlas's own backtest engine, computed directly from actual price data, not a search result or a guess):
${historicalStatsText(histStats)}
Use these exact numbers for the corresponding technicals/price-history metrics below — do not re-estimate, round differently, or contradict them with a search-derived guess. This is what makes your technicals/risk read objective and independent of any outside source.
IMPORTANT: this block describes ticker ${histStats.ticker}${histStats.name ? ` (${histStats.name})` : ""}. The user's query ("${name}") was interpreted as that ticker — if the company you are actually evaluating is a DIFFERENT one (e.g. the query was a company name that coincidentally matches an unrelated ticker), IGNORE this entire block and rely on your own searches instead.
═══════════════════════════════════════` : "";
    const upTicker = looksLikeTicker(name) ? name.toUpperCase() : null;
    // Real fundamentals + recent news from our own endpoints, so the dossier reasons over live data
    // WITHOUT web search — which timed out on Vercel (returning a non-JSON error the client choked
    // on) and shared the fragile upstream search limit.
    let fundBlock = "", newsBlock = "";
    if (upTicker) {
      const [fund, news] = await Promise.all([
        fetch(apiUrl(`/api/fundamentals?ticker=${encodeURIComponent(upTicker)}`)).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(apiUrl(`/api/news?ticker=${encodeURIComponent(upTicker)}`)).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (seq !== evalSeq.current) return;
      if (fund && !fund.error) {
        const q = (fund.quarterlyFinancials || []).slice(-6).map(x => `  ${x.date}: revenue ${x.totalRevenue != null ? "$" + (x.totalRevenue / 1e9).toFixed(2) + "B" : "N/A"} · net income ${x.netIncome != null ? "$" + (x.netIncome / 1e9).toFixed(2) + "B" : "N/A"} · EPS ${x.eps ?? "N/A"}`).join("\n");
        const surp = (fund.earnings || []).slice(-4).map(e => `${e.date}${e.surprisePct != null ? " " + (e.surprisePct >= 0 ? "+" : "") + e.surprisePct.toFixed(1) + "%" : ""}`).join(", ");
        fundBlock = `
REAL FUNDAMENTALS for ${upTicker} (Yahoo Finance + SEC filings via Atlas — use these directly, don't re-estimate):
Trailing P/E ${fund.trailingPE ?? "N/A"} | Forward P/E ${fund.forwardPE ?? "N/A"} | Price/Book ${fund.pb ?? "N/A"} | Dividend yield ${fund.dividendYield != null ? (fund.dividendYield * 100).toFixed(2) + "%" : "N/A"}
Revenue growth YoY ${fund.revenueGrowth != null ? (fund.revenueGrowth * 100).toFixed(1) + "%" : "N/A"} | Earnings growth YoY ${fund.earningsGrowth != null ? (fund.earningsGrowth * 100).toFixed(1) + "%" : "N/A"}
Recent quarters:
${q || "  N/A"}
Earnings surprises: ${surp || "N/A"}
Dividends on record: ${fund.dividends?.length || 0}${fund.dividends?.length ? ` · latest $${fund.dividends[fund.dividends.length - 1].amount} on ${fund.dividends[fund.dividends.length - 1].date}` : ""}`;
      }
      if (news?.items?.length) {
        newsBlock = `
RECENT NEWS for ${upTicker} (real headlines + links — build the news section from THESE, do not invent headlines or URLs):
${news.items.slice(0, 10).map((n, i) => `[${i}] ${n.headline} — ${n.source}, ${n.date || "recent"} — ${n.url}`).join("\n")}`;
      }
    }
    const sys = `Today's date is ${currentDateStr()}. Treat this as the current date for all recency, prices, valuations and news.

You are a brutally honest, no-nonsense senior equity research analyst — effectively your own independent investment bank. Your job is to produce a complete, institutional-grade stock dossier using the REAL data PROVIDED BELOW — your own computed price history, real fundamentals, and recent news headlines — and to form YOUR OWN judgment from that evidence. Do NOT search the web or call any tools; reason only from the provided data plus your own analytical knowledge. You have NO opinion of your own until the data speaks — if a stock is bad, say it is bad. Do not sugarcoat. Do not be a cheerleader. Scores below 40 are common when warranted.

INDEPENDENT JUDGMENT — non-negotiable:
- Every pillar score, the overall score, and the action are YOUR conclusions, derived only from hard evidence: the actual financials, your own computed price-history statistics (CAGR, max drawdown, volatility, moving averages, RSI — from Atlas's backtest engine, see below), and actual factual news events (earnings beats/misses, guidance changes, litigation, contracts, management changes, downgrades of the BUSINESS not the stock). Reason from first principles like your own desk's analyst, not by adopting someone else's take.
- Wall Street analyst ratings/price targets and aggregate market/news sentiment are reported ONLY as separate reference context for the user (sections 6 and 9 below) — they must NEVER be used as an input to any pillar score, the overall score, or the action. Do not average toward consensus, and do not let a stock's hype or crowd mood inflate a score the fundamentals/technicals/risk don't support — or let a beaten-down mood deflate one they do support.
- If your own fact-based read disagrees with the analyst consensus or the prevailing sentiment, that's fine and expected — say so plainly in the thesis rather than softening your call to match theirs.
${histBlock}${fundBlock}${newsBlock}

DATA USAGE — you do NOT have web search; work from what's provided:
- Use the REAL COMPUTED PRICE HISTORY block for every price/technical/risk metric it covers (price, SMAs, RSI, 52w range, returns, CAGR, drawdown, volatility) — those are exact, do not contradict them.
- Use the REAL FUNDAMENTALS block for valuation multiples, growth, quarterly revenue/earnings, dividends. Derive what you can (e.g. net margin = net income / revenue). For any fundamental metric not provided, use your best knowledge and mark clearly "N/A (est.)" if uncertain — never fabricate precise figures.
- Build the NEWS section ONLY from the RECENT NEWS block: use those exact headlines, sources, dates and URLs. Do not invent headlines or links. If no news block is present, return an empty news items array and say so in the summary.
- Analyst consensus and catalysts: give your best estimate from general knowledge and clearly flag it as approximate in the flags section (it is not live).

Return ONE valid JSON object, nothing else. No markdown fences. No prose outside the JSON. If no real public company matches, return {"error":"not_found"}.

═══════════════════════════════════════
INVESTOR PROFILE — every score must reflect THIS investor, not a generic one:
${profileText(profile)}

CURRENT PORTFOLIO — assess overlap, concentration, correlation:
${holdingsText(holdings)}
SPARE CASH AVAILABLE TO DEPLOY: ${spareCash && parseNum(spareCash) > 0 ? `${spareCashCurrency} ${spareCash}` : "not specified"}
═══════════════════════════════════════

BRUTAL HONESTY RULES — non-negotiable:
- If fundamentals are weak (high debt, shrinking revenue, negative FCF), the fundamentals score MUST be below 50
- If valuation is stretched (P/E > 40 with no growth, or loss-making), valuation score MUST be below 40
- If technicals are broken (below 200d MA, RSI oversold, death cross), technicals score MUST reflect that
- If news is negative (lawsuits, earnings misses, guidance cuts, CEO departures), factor it in harshly
- Overall score for a conservative investor in a speculative stock should be 25–45, not 60+
- NEVER give a stock above 75 unless it genuinely excels across ALL pillars
- Call out red flags explicitly — missing data, inconsistencies, accounting concerns

SCORING CALIBRATION vs this investor's profile:
- Risk tolerance (${profile.riskTolerance || "Moderate"}) + drawdown reaction (${profile.drawdownReaction || "Hold"}) → penalise volatile names hard for conservative profiles
- Time horizon (${profile.horizon || "Medium"}) → Short: weight technicals + catalysts; Long: weight fundamentals + moat + quality
- Goal (${profile.goal || "Balanced growth"}) + Style (${profile.philosophy || "Quality"}) → Value investor? Punish high P/E. Growth investor? Punish low growth
- Portfolio fit → penalise sector/name concentration; reward genuine diversification
- Budget (${profile.budget || "n/a"}) + income stability (${profile.incomeStability || "Stable"}) → size positions conservatively for smaller budgets

═══════════════════════════════════════
REQUIRED OUTPUT — all sections mandatory, all data from live searches:

1. PILLARS (0–100 each):
   - fundamentals: quality of business (earnings, margins, growth, balance sheet)
   - valuation: cheapness vs peers and history (lower P/E / better value = higher score)
   - technicals: price trend, momentum, chart setup (above 200MA, uptrend = higher)
   - risk: safety score — higher = SAFER (low debt, stable earnings, wide moat)

2. OVERALL: score 0–100 personalised to this investor; action: exactly one of "Strong Buy / Buy / Hold / Trim / Sell / Avoid"; thesis: one direct, honest sentence — lead with the call, explain why

3. FUNDAMENTALS (use real numbers from Yahoo Finance / Stockanalysis / Macrotrends):
   Groups:
   - "Valuation Multiples": P/E (TTM), Forward P/E, P/S, P/B, EV/EBITDA, PEG ratio, FCF yield
   - "Profitability": Gross margin, Operating margin, Net margin, ROE, ROIC, ROA
   - "Revenue & Earnings Growth": Revenue YoY, EPS YoY, 3yr revenue CAGR, 3yr EPS CAGR, next-yr consensus est.
   - "Balance Sheet Strength": Cash & equivalents, Total debt, Net debt/EBITDA, Current ratio, Debt/Equity, Interest coverage ratio
   - "Cash Flow Quality": Operating CF (TTM), Free CF (TTM), Capex, FCF margin, FCF per share
   - "Shareholder Returns": EPS (TTM), DPS, Dividend yield, Payout ratio, Buyback yield, Total shareholder yield
   conclusion: 3 honest sentences on fundamental quality — name the best AND worst metrics

4. TECHNICALS (use real current prices and levels):
   Groups:
   - "Price & Trend": Current price, 52w range, 50d MA, 200d MA, vs 50d MA (%), vs 200d MA (%), trend status
   - "Momentum Indicators": RSI (14d) + interpretation, MACD status, 1m price change, 3m price change, 6m price change, YTD return
   - "Key Price Levels": 52w high, 52w low, % off 52w high, nearest support, nearest resistance, avg true range
   - "Volume & Volatility": Beta, 30d historical vol (annualised), avg daily volume, recent vol vs 90d avg, short interest %, days-to-cover
   conclusion: 3 honest sentences — is the chart bullish or bearish right now, and what would change that

5. RISK (higher score = safer):
   Groups:
   - "Market & Price Risk": Beta, 1yr max drawdown, estimated 95% VaR (1-month), S&P 500 correlation, sector volatility vs market
   - "Financial Health": Leverage (Debt/EBITDA), interest coverage, current ratio, Altman Z-score (if applicable), cash runway
   - "Business & Competitive Risk": Revenue concentration (top customer / geographic), moat rating (Wide/Narrow/None + why), regulatory exposure, management quality flags
   - "Portfolio Impact for ${profile.name}": Sector already held (%), correlation to existing positions, what this does to overall portfolio risk, concentration warning if relevant
   conclusion: 3 sentences — what are the top 2 risks that could blow up this investment for THIS specific investor

6. NEWS & SENTIMENT (build ONLY from the RECENT NEWS provided above):
   - overallSentiment: "Very Bullish" / "Bullish" / "Neutral" / "Bearish" / "Very Bearish"
   - sentimentScore: -100 to +100 (negative = bad news dominating)
   - summary: 2 sentences on what the news flow says about this stock RIGHT NOW
   - insiderActivity: you do NOT have live SEC/Form-4 access here. If any of the provided news items are about insider buying/selling, summarize them; otherwise set {"summary":"No insider-trading data available in the provided sources","transactions":[]}. NEVER fabricate insider names, share counts, values or dates. When you do report a transaction from the provided news, each object is exactly ONE discrete dated filing.
     Each transaction is exactly ONE discrete, dated filing: "insider" names one specific individual (never a group like "multiple insiders"); "shares" is a bare number only, no descriptions or parentheticals tacked on (wrong: "99,000 (Intent to Sell filing)", right: "99,000"); "value" is a single bare dollar amount, never "undisclosed"/"aggregate"; "date" is one specific date/month, never "multiple dates" or a range. If an insider made several separate filings in the window, add up to 2-3 separate transaction objects (one per actual filing) rather than collapsing them into one vague row — and if you can only confirm a pattern or total but no single filing's specifics, leave it out of "transactions" and mention it only in the "summary" prose instead.
   - items: 5–8 recent news items, each with:
     * headline: actual headline text (not paraphrased)
     * url: the real https URL from the provided RECENT NEWS block (do not invent one)
     * source: publication name (Reuters, Bloomberg, WSJ, Yahoo Finance, etc.)
     * date: approximate date (e.g. "Jun 2026", "May 2026")
     * sentiment: "Positive" / "Negative" / "Neutral"
     * category: one of "Insider Trading", "Earnings", "Management Change", "M&A", "Regulatory/Legal", "Product/Business", "Macro/Sector"
     * impact: one sentence on why this matters for the stock
   Include any insider-trading items found here too (category "Insider Trading"), in addition to the dedicated insiderActivity summary above.

7. FIT FOR ${profile.name}:
   - score: 0–100 (how well this stock fits THIS investor's profile AND portfolio)
   - summary: 3 sentences — address ${profile.name} by name, reference their specific risk tolerance, horizon, goal, AND how this fits or conflicts with their existing holdings
   - action: what ${profile.name} should specifically do: "Buy X shares", "Avoid — here's why", "Hold your X shares", etc.
   - positionSizing: specific guidance grounded in budget "${profile.budget}" — e.g. "No more than 5% of portfolio, roughly $X"
   - watchouts: exactly 3 watchouts written specifically for ${profile.name}'s situation

8. CATALYSTS: 4–6 upcoming catalysts with label + description + timeframe + direction ("Bullish"/"Bearish"/"Neutral")

9. ANALYST CONSENSUS: rating, targetPrice, upside vs current price, numAnalysts, highTarget, lowTarget, recentRevisions (upgraded/downgraded in last 30 days)

10. DATA SOURCES: list every source actually used (e.g. "Yahoo Finance — financials", "Reuters — news", "Stockanalysis.com — margins")

11. FLAGS: 3–5 honest caveats — missing data, data that couldn't be verified, red flags, conflicts of interest, limitations of this analysis

═══════════════════════════════════════
FORMAT RULES:
- Metric values terse: "28.4x", "$3.2T", "+12.3% YoY", "85.2%", "$182.40"
- Use "N/A" only when genuinely unavailable in the provided data or your knowledge
- JSON must be complete and syntactically valid — always close every bracket and brace
- If data is unavailable for any metric use "N/A" — never omit a field or leave JSON incomplete
- For small/obscure companies with limited data, still return the full schema with "N/A" values
- action field in overall must be one of: "Strong Buy", "Buy", "Hold", "Trim", "Sell", "Avoid"

FULL JSON SCHEMA:
{"company":"","ticker":"","asOf":"","pillars":{"fundamentals":0,"valuation":0,"technicals":0,"risk":0},"overall":{"score":0,"action":"","thesis":""},"fundamentals":{"groups":[{"title":"","items":[{"label":"","value":""}]}],"conclusion":""},"technicals":{"groups":[{"title":"","items":[{"label":"","value":""}]}],"conclusion":""},"risk":{"groups":[{"title":"","items":[{"label":"","value":""}]}],"conclusion":""},"news":{"overallSentiment":"","sentimentScore":0,"summary":"","insiderActivity":{"summary":"","transactions":[{"insider":"","type":"","shares":"","value":"","date":""}]},"items":[{"headline":"","url":"","source":"","date":"","sentiment":"","category":"","impact":""}]},"fit":{"score":0,"summary":"","action":"","positionSizing":"","watchouts":[""]},"catalysts":[{"label":"","description":"","timeframe":"","direction":""}],"analystConsensus":{"rating":"","targetPrice":"","upside":"","numAnalysts":0,"highTarget":"","lowTarget":"","recentRevisions":""},"dataSources":[""],"flags":[""]}`;
    try {
      // No web search: the dossier reasons over the real price/fundamentals/news we already fetched
      // and passed into the prompt. This can't time out on the upstream search loop and doesn't
      // touch the shared search limit. Adaptive thinking stays on for analytical depth.
      const parsed = await callClaudeAnalyze(sys, `Evaluate: ${name}`, { maxTokens: 20000, think: true });
      if (!parsed) throw new Error("The dossier came back unreadable. Tap Retry.");
      if (seq !== evalSeq.current) return;   // superseded while the AI call was in flight
      if (parsed.error === "not_found") throw new Error(`Couldn't find a public company matching "${name}". Try a ticker or exact name.`);
      if (!parsed.pillars && !parsed.fundamentals) throw new Error("The dossier came back incomplete. Tap Retry.");
      if (parsed.news?.insiderActivity) parsed.news.insiderActivity = cleanInsiderActivity(parsed.news.insiderActivity);
      // If the model resolved the query to a different company than the price-history guess
      // (e.g. "FORD" the query vs Forward Industries the ticker), drop the mismatched snapshot.
      setBacktestSnapshot(s => s && parsed.ticker && s.ticker !== String(parsed.ticker).toUpperCase() ? null : s);
      setResult(parsed);
      saveResearchHistory(parsed);
    } catch (err) { if (seq === evalSeq.current) setError(err.message || "Something went wrong."); }
    // Only the request that's still current owns the loading flag / spinner timer — a superseded
    // older request must not clear the newer one's loading state.
    finally { if (seq === evalSeq.current) { setLoading(false); if (timerRef.current) clearInterval(timerRef.current); } }
  }
  function openTicker(t) { setQuery(t); evaluate(t); }

  // Keeps a running log of completed dossiers so re-opening one (or re-running it later) doesn't
  // mean losing everything looked at so far — a fresh research replaces `result` on screen, but the
  // history list is the durable record. Upserts by ticker: re-researching a name updates its entry
  // and bumps it to the top rather than creating a duplicate.
  function saveResearchHistory(parsed) {
    const ticker = (parsed.ticker || query || "").toUpperCase().trim();
    if (!ticker) return;
    setResearchHistory((prev) => {
      const entry = { ticker, company: parsed.company || ticker, asOf: parsed.asOf || "", savedAt: new Date().toISOString(), result: parsed };
      const next = [entry, ...prev.filter((e) => e.ticker !== ticker)].slice(0, 25);
      kvSet("atlas_research_history", next);
      // Sync a trimmed copy to the cloud so past research survives across devices and sign-out
      // (localStorage keeps the full 25; cap the cloud copy to stay well under Firestore's 1MB doc).
      cloudSave({ researchHistory: next.slice(0, 12) });
      return next;
    });
  }
  function openResearchHistory(entry) {
    const seq = ++evalSeq.current;   // this open now owns the shown dossier
    setQuery(entry.ticker);
    // _savedAt lets the dossier flag itself as a saved copy (prices/news are as of that time).
    setResult({ ...entry.result, _savedAt: entry.savedAt });
    setError(null); setLoading(false);
    // The snapshot on screen belongs to whatever was researched last — recompute it for THIS
    // ticker (cheap: one price-history fetch) instead of leaking another stock's numbers.
    setBacktestSnapshot(null);
    fetchHistoricalStats(entry.ticker).then((hs) => {
      if (seq !== evalSeq.current) return;   // a newer open/evaluate started — don't render this one's snapshot
      if (!hs?.prices) return;
      const snap = backtestSmaCrossover(hs.prices);
      if (snap) setBacktestSnapshot({ ...snap, ticker: entry.ticker });
    });
  }
  function updateResearchHistory(ticker) { setQuery(ticker); evaluate(ticker); }
  function removeResearchHistory(ticker) {
    setResearchHistory((prev) => { const next = prev.filter((e) => e.ticker !== ticker); kvSet("atlas_research_history", next); cloudSave({ researchHistory: next.slice(0, 12) }); return next; });
  }

  // ---- discovery ----
  // Each option maps to a hard constraint injected into the scan prompt — the segmented
  // control genuinely changes which markets get considered, not just the label on screen.
  const UNIVERSE_RULES = {
    "Global all-markets": "Consider every publicly listed equity worldwide.",
    "US markets": "HARD FILTER: only stocks listed on US exchanges (NYSE, NASDAQ, AMEX) — plain US tickers with no exchange suffix. A US-listed ADR of a foreign company is acceptable; a foreign home-market listing is not.",
    "Europe": "HARD FILTER: only stocks whose primary listing is on a European exchange (LSE, Euronext, XETRA, Borsa Italiana, SIX, Nordic exchanges, etc.). Every ticker MUST carry its Yahoo exchange suffix (e.g. \"SHEL.L\", \"SAP.DE\", \"ASML.AS\").",
    "Asia-Pacific": "HARD FILTER: only stocks whose primary listing is in the Asia-Pacific region (Tokyo, Hong Kong, mainland China, Korea, Taiwan, Singapore, India, Australia, New Zealand). Every ticker MUST carry its Yahoo exchange suffix (e.g. \"9988.HK\", \"7203.T\", \"005930.KS\").",
    "My interest sectors": "HARD FILTER: only stocks in the investor's stated sectors of interest from the profile above (if none are listed, treat as all sectors). Any market worldwide is fine.",
  };
  async function discover(universeArg) {
    // Don't hard-bail when a scan is already running: switching the universe mid-scan must be able
    // to supersede it, or the old universe's picks land under the newly-selected filter label.
    const uni = typeof universeArg === "string" ? universeArg : universe;
    const seq = ++discoverSeq.current;
    setRecsLoading(true); setRecsError(null); setRecs(null);
    const sys = `Today's date is ${currentDateStr()}. Treat this as the current date; set "asOf" to it and base every pick on the most recent data available as of now.

You are a brutally honest equity research analyst — your own independent investment bank, not a mouthpiece for Wall Street consensus. Your only job is to find the BEST stocks for this specific investor RIGHT NOW, based on YOUR OWN read of the hard evidence (fundamentals, valuation, technicals, real factual news events) — not on analyst ratings, price-target chasing, or crowd sentiment. If a name is popular/hyped but the numbers don't back it, leave it out; if a name is out of favor but the numbers are genuinely strong, include it anyway. Use web_search to get current prices, valuations, and recent news. Return ONE JSON object only — no prose, no fences.

INVESTOR PROFILE:
${profileText(profile)}

CURRENT HOLDINGS:
${holdingsText(holdings)}

SPARE CASH TO DEPLOY: ${spareCash && parseNum(spareCash) > 0 ? `${spareCashCurrency} ${spareCash}` : "not specified"}

═══ TASK ═══
Find the 6 best stock opportunities for this investor right now. Be decisive — use your training knowledge plus 1–2 targeted searches to verify current prices or recent catalysts.

MARKET UNIVERSE — the investor chose "${uni}": ${UNIVERSE_RULES[uni] || UNIVERSE_RULES["Global all-markets"]}
Skip tickers they already own. Non-US tickers must include exchange suffix (e.g. "SHEL.L", "9988.HK", "SAP.DE"). No OTC/pink sheets.

Score each pick 0–100 (fitScore) honestly:
- Loss-making, no path to profit: MAX 40
- P/E >50x with decelerating growth: MAX 35
- Speculative pick for Conservative investor: MAX 30
- Most picks should land 55–78 — only truly exceptional opportunities above 80

For each pick give:
- reason: specific NOW reason with real data point (e.g. "Beat Q2 EPS by 18%, FCF up 35% YoY, trades at 12x vs sector 20x")
- concern: single biggest real risk, honest and specific
- 2 snapshot metrics with current values
- 2 tags describing the opportunity type

Schema:
{"asOf":"","marketContext":"one sentence on current market conditions","picks":[{"ticker":"","company":"","sector":"","fitScore":0,"reason":"","concern":"","tags":[""],"snapshot":[{"label":"","value":""}]}]}`;
    try {
      const parsed = await callClaude(sys, "Find the best stocks for me right now.", { maxTokens: 2800, maxSearches: 2, fast: true });
      if (seq !== discoverSeq.current) return;   // a newer scan (e.g. universe switch) superseded this
      if (!Array.isArray(parsed.picks)) throw new Error("Couldn't build the shortlist. Tap Scan again.");
      parsed.picks.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));
      setRecs(parsed);
      recsAtRef.current = Date.now();
      kvSet("atlas_recs", { data: parsed, at: recsAtRef.current });   // cache for instant revisit
      logPickHistory(parsed.picks, uni);   // append-only forward-return log (fire-and-forget)
    } catch (err) { if (seq === discoverSeq.current) setRecsError(err.message || "Something went wrong."); }
    finally { if (seq === discoverSeq.current) setRecsLoading(false); }
  }

  // ---- portfolio news ----
  async function fetchPortfolioNews() {
    if (newsLoading || !holdings.length) return;
    setNewsLoading(true); setNewsError(null);
    const tickers = holdings.map(h => h.ticker).join(", ");
    const sys = `Today's date is ${currentDateStr()}. Treat this as the current date for all recency and "last N days" windows.

You are a financial news analyst. The user holds these stocks: ${tickers}.
Search for the latest news relevant to these holdings — go beyond generic headlines and prioritize the news types that actually move a decision to buy/hold/sell:
- Insider buying/selling (SEC Form 4 filings) in the last 90 days, per holding — this is one of the most objective, actionable signals available (insiders committing their own money is meaningfully different from a headline opinion). For EVERY holding, check a real primary source for exact figures — openinsider.com/screener?s=TICKER (best single source, gives insider name, transaction type, share count, price, and total value directly), or SEC EDGAR full-text search (efts.sec.gov), or secform4.com. Do not rely on a secondary article that merely mentions "an executive sold shares" without the actual filing numbers.
- Earnings results, guidance changes, product launches, management changes, lawsuits/regulatory action, M&A, partnerships (last 7 days)
- Broader macro/sector news that materially affects these holdings

insiderActivity: a dedicated portfolio-wide summary, separate from the news list — {"summary":"2-3 sentences on the overall pattern across the portfolio (e.g. \"insider buying at X while heavy selling at Y\"), or \"No notable insider activity across your holdings in the last 90 days\" if genuinely none found","transactions":[{"ticker":"AAPL","insider":"name/title","type":"Buy or Sell","shares":"12,000","value":"$1.8M","date":"Jun 2026"}]}
QUALITY BAR — non-negotiable: each object in "transactions" is exactly ONE discrete, dated filing:
- "insider" = one named individual + role (e.g. "Anthony Noto, CEO") — never "Multiple Insiders", "various", "unspecified", or a group.
- "shares" = a bare number only (e.g. "5,000") — never a description, parenthetical, or qualifier tacked on (wrong: "99,000 (Intent to Sell filing)"; right: "99,000").
- "value" = a single bare dollar amount (e.g. "$1.2M" or "$526,000") — never "undisclosed", "aggregate", or a range.
- "date" = one specific date or month (e.g. "May 2026") — never "multiple dates" or a range.
If an insider made SEVERAL separate purchases/sales in the window (e.g. a CEO buying on 3 different dates), do NOT collapse them into one vague summary row — instead add up to 2-3 separate transaction objects, one per actual filing, each with its own clean specific date/shares/value; if you can only verify totals but not any single filing's specifics, leave it out of "transactions" entirely and describe the pattern only in "summary" prose (e.g. "CEO has made repeated open-market purchases throughout 2026"). Same rule for unverifiable aggregates (e.g. non-US companies without per-person filing detail) — omit from "transactions", mention only in "summary", clearly caveated as unconfirmed/aggregate. A shorter, fully-clean list beats a longer one with any vague or placeholder field.

Return a JSON array for the regular news feed. Each item:
{
  "ticker": "AAPL",
  "headline": "...",
  "source": "Reuters",
  "date": "2026-06-26",
  "summary": "...",
  "url": "https://...",
  "sentiment": "bullish",
  "category": "Insider Trading"
}
category must be one of: "Insider Trading", "Earnings", "Management Change", "M&A", "Regulatory/Legal", "Product/Business", "Macro/Sector"
Also include any insider-trading items in this list too (category "Insider Trading"), in addition to the dedicated insiderActivity summary above.

Return ONLY this JSON, nothing else:
{"insiderActivity":{"summary":"","transactions":[{"ticker":"","insider":"","type":"","shares":"","value":"","date":""}]},"news":[...]}
Aim for 2-3 items per holding plus 2-3 macro items, max 20 total in "news". Insider trading items don't count against that per-holding cap — include them whenever found.`;
    try {
      // Same reasoning as the portfolio review — up to 20 news items across every holding needs more
      // room for a large portfolio than a small one; scale it instead of risking mid-JSON truncation.
      const newsMaxTokens = Math.max(4200, holdings.length * 280 + 1600);
      // Fixed at 4 searches regardless of portfolio size meant a 16-holding portfolio had barely a
      // quarter-search per name — nowhere near enough to both scan general news AND pull real Form 4
      // numbers per holding. Scale with holding count so each name actually gets a shot at a real,
      // specific insider-activity source instead of returning vague "signal noticed but unconfirmed" rows.
      const newsMaxSearches = Math.min(30, Math.max(6, holdings.length + 4));
      const parsed = await callClaude(sys, `Find latest news for portfolio: ${tickers}`, { maxTokens: newsMaxTokens, maxSearches: newsMaxSearches, fast: true });
      setNewsItems(parsed?.news || []);
      setNewsInsiderActivity(cleanInsiderActivity(parsed?.insiderActivity));
    } catch (e) {
      setNewsError(e.message || "Could not fetch news.");
    } finally { setNewsLoading(false); }
  }

  // ---- market-wide news (Today screen widget) ----
  // Real headlines + links come from /api/news (CNBC markets/economy feed) — fast, reliable, and
  // independent of the shared AI web-search limit that used to make this widget hang. The AI then
  // only adds a "what this means" read on top (no web search), and if that step fails we still
  // show the real headlines. Categories the widget knows how to tint:
  const NEWS_CATEGORIES = ["Fed & Rates", "Macro Data", "Geopolitical", "Earnings", "M&A", "Sector Move", "Other"];
  async function fetchMarketNews(background) {
    if (marketNewsLoading) return;
    if (!background) setMarketNewsLoading(true);
    setMarketNewsError(null);
    try {
      // 1) Fetch real headlines from the news feed (no AI, no search limit).
      const r = await fetch(apiUrl("/api/news"));
      const d = await r.json();
      if (d.error || !Array.isArray(d.items) || !d.items.length) throw new Error(d.error || "No market news available right now.");
      const feed = d.items.slice(0, 18);

      // 2) Add analysis WITHOUT web search — the model only reads the headlines we already have.
      let enriched = null;
      try {
        const sys = `Today's date is ${currentDateStr()}.

You are a markets desk analyst. Below are recent market-news headlines, each with an index, source, date and short summary. Select the most MARKET-MOVING ones for a general investor — things that actually move stock prices: Fed/central-bank & rates, macro data (jobs, inflation, GDP), major earnings or M&A, geopolitics that hits markets, big sector moves. Skip fluff, promotional/ETF-marketing pieces, and non-market human-interest stories.

For each selected item return:
- "i": its index number from the list
- "category": exactly one of ${NEWS_CATEGORIES.map(c => `"${c}"`).join(", ")}
- "impact": ONE sentence — your own read on what it means for markets going forward, not a restatement of the headline
- "relatedTicker": a single stock ticker if the item centers on one public company (e.g. "NVDA"), else null

Also return "marketPulse": one sentence on the overall market mood right now and why (bullish / cautious / bearish).

Order the items array most-important first. Return ONLY this JSON:
{"marketPulse":"","items":[{"i":0,"category":"","impact":"","relatedTicker":null}]}`;
        const user = feed.map((it, i) => `[${i}] ${it.headline} (${it.source}, ${it.date || "recent"}) — ${it.summary || ""}`).join("\n");
        enriched = await callClaudeAnalyze(sys, user);
      } catch (_) { /* analysis is best-effort; headlines still render below */ }

      // 3) Merge the AI read onto the REAL feed items (headline/url/source/date always come from the
      //    feed, so links are never fabricated). Fall back to the newest headlines if analysis failed.
      const picks = Array.isArray(enriched?.items)
        ? enriched.items.map((p) => {
            const src = feed[p.i];
            if (!src) return null;
            return { ...src, category: NEWS_CATEGORIES.includes(p.category) ? p.category : "Other", impact: typeof p.impact === "string" ? p.impact : "", relatedTicker: p.relatedTicker || null };
          }).filter(Boolean).slice(0, 8)
        : [];
      const items = picks.length ? picks : feed.slice(0, 8).map((it) => ({ ...it, category: "Other", impact: "", relatedTicker: null }));
      const parsed = { marketPulse: (enriched && typeof enriched.marketPulse === "string") ? enriched.marketPulse : "", items };

      setMarketNews(parsed);
      marketNewsAtRef.current = Date.now();
      kvSet("atlas_market_news", { data: parsed, at: marketNewsAtRef.current });   // cache for instant revisit
    } catch (e) {
      // A background refresh that fails must NOT clobber the cached briefing already on screen.
      if (!background) setMarketNewsError(e.message || "Could not fetch market news.");
    } finally { if (!background) setMarketNewsLoading(false); }
  }

  // ---- portfolio review ----
  async function analyzePortfolio() {
    if (reviewLoading || !holdings.length) return;
    setReviewLoading(true); setReviewError(null);
    try {
      // Fetch a full year of real price history per holding (not just the latest quote) so the
      // review can score each position against its OWN computed performance — same buy-and-hold
      // CAGR/drawdown/volatility math as the Backtest engine — instead of the model having to
      // search for or guess at how a holding has actually behaved.
      const priceResults = await Promise.all(
        holdings.map(async (h) => {
          try {
            const r = await fetch(apiUrl(`/api/history?ticker=${encodeURIComponent(h.ticker)}&range=1y&interval=1d`));
            const d = await r.json();
            const prices = d.prices;
            if (prices && prices.length) {
              const latest = prices[prices.length - 1];
              const stats = prices.length >= 30 ? calcStats(runBuyAndHold(prices, 10000)) : null;
              return { ticker: h.ticker, price: latest.close, currency: d.currency, name: d.name, stats };
            }
          } catch (_) {}
          return { ticker: h.ticker, price: null };
        })
      );
      const priceMap = {};
      for (const p of priceResults) priceMap[p.ticker] = p;
      const holdingsWithPrices = holdings.map((h) => {
        const p = priceMap[h.ticker];
        const cur = h.currency && h.currency !== "USD" ? h.currency : "USD";
        const costLabel = `${h.cost}${cur !== "USD" ? ` ${cur}` : ""}`;
        if (p?.price != null) {
          const statsLabel = p.stats ? ` · trailing 1y (Atlas backtest engine, real computed): CAGR ${p.stats.cagr}%, max drawdown ${p.stats.maxDrawdown}%, volatility ${p.stats.volatility}%` : "";
          return `${h.ticker} (${p.name || h.ticker}): ${h.shares} shares @ ${costLabel} avg cost · current price ${p.currency || "USD"} ${p.price.toFixed(2)}${statsLabel}`;
        }
        return `${h.ticker}: ${h.shares} shares @ ${costLabel} avg cost · current price unavailable`;
      }).join("\n");

      const sys = `Today's date is ${currentDateStr()}. Treat this as the current date for all recency, prices and news.

You are a portfolio analyst giving brutally honest, hands-on advice — your own independent call on each position, not a summary of what other analysts or the market mood currently think. Base every action and score strictly on the hard facts: this investor's cost basis, the live price, each holding's own real computed trailing performance (CAGR/drawdown/volatility, from Atlas's backtest engine — provided below), the underlying business's real fundamentals/trajectory, and factual recent news — never on analyst ratings or crowd sentiment. Current prices and performance stats are already provided below — do NOT search for prices, they are live and accurate. Return ONE JSON object only.

INVESTOR PROFILE:
${profileText(profile)}

CURRENT HOLDINGS with live prices:
${holdingsWithPrices}

SPARE CASH AVAILABLE TO DEPLOY: ${spareCash && parseNum(spareCash) > 0 ? `${spareCashCurrency} ${spareCash}` : "not specified"}

For EACH holding decide ONE action: "Buy More","Hold","Trim","Sell" — exactly these four, nothing else (no "Add", no synonyms; "Buy More" already means increase this position). Use the exact currentPrice provided. Give scoreForYou 0–100 and one-sentence rationale referencing their cost basis and profile.

For the portfolio summary, if spare cash is specified give SPECIFIC deployment advice. Be concrete, not vague.

Schema:
{"asOf":"","holdings":[{"ticker":"","company":"","currentPrice":"","action":"","rationale":"","scoreForYou":0}],"portfolio":{"summary":"","concentration":"","cashAdvice":"","suggestions":[""]}}`;

      // Scale the budget to the actual portfolio size — a fixed 2500 was plenty for a handful of
      // holdings but silently truncated once someone had a dozen-plus positions, each needing its own
      // ticker/action/rationale/score line plus the portfolio-level summary. Same prompt, same search
      // depth — just enough room to finish writing the answer instead of getting cut off mid-JSON.
      const reviewMaxTokens = Math.max(3200, holdings.length * 280 + 1200);
      const parsed = await callClaude(sys, "Review my portfolio.", { maxTokens: reviewMaxTokens, maxSearches: 2 });
      if (!parsed.holdings) throw new Error("Couldn't analyze the portfolio. Try again.");
      const enriched = { ...parsed, holdings: parsed.holdings.map((h) => {
        const p = priceMap[(h.ticker || "").toUpperCase()];
        if (p?.price != null) return { ...h, currentPrice: String(p.price.toFixed(2)) };
        return h;
      }) };
      setReview(enriched);
    } catch (err) { setReviewError(err.message || "Something went wrong."); }
    finally { setReviewLoading(false); }
  }
  const reviewFor = (t) => (review?.holdings || []).find((x) => (x.ticker || "").toUpperCase() === t.toUpperCase());

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (importRef.current) importRef.current.value = "";
    if (!file) return;
    setImportAnalyzing(true); setImportError(null);
    try {
      // xlsx is deliberately not in the entry bundle — it only downloads the first time a
      // spreadsheet is actually imported.
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!rawRows.length) { setImportError("No rows were found in that file — is the first sheet empty?"); return; }
      const headers = Object.keys(rawRows[0]);
      const det = detectImportMapping(headers, rawRows);
      // A currency symbol/code embedded in the cost header itself (e.g. "Avg Cost (€)") tells us the unit
      // of the numbers we're about to read — trust it over a USD default even when there's no Currency column.
      const headerCurrency = detectHeaderCurrency([det.costColumn, det.totalCostColumn].filter(Boolean));
      let mapping = { tickerColumn: det.tickerColumn, nameColumn: det.nameColumn, sharesColumn: det.sharesColumn, costColumn: det.costColumn, totalCostColumn: det.totalCostColumn, currencyColumn: det.currencyColumn, exchangeColumn: det.exchangeColumn, typeColumn: det.typeColumn, valueColumn: det.valueColumn, sheetCurrency: headerCurrency };
      let nameMap = {};
      // Rows like "CASH" / "Free cash (GBP)" aren't a security — pull them out into a cash total up front
      // so they don't get lost as an "unresolved" row; the user can add it straight to Spare Cash below.
      // Kept in its own native currency (no forced conversion) — Spare Cash is displayed converted to
      // match Portfolio Value's currency, exactly like a holding, so nothing gets silently rebased.
      const cashDetected = detectCashAmount(rawRows, mapping);

      // A ticker that LOOKS well-formatted isn't necessarily the RIGHT one — bare "TSCO" is a real ticker,
      // just for "Tractor Supply Co." (US/NASDAQ), not "Tesco PLC" (UK/LSE, real symbol "TSCO.L"). Format
      // validity can't catch that; only currency/exchange context (or the model) can. So: any time this
      // sheet shows evidence of a non-USD holding anywhere — a currency column value, a header symbol like
      // "(€)", or a non-US exchange name — every ticker gets verified by the model, not just obviously
      // broken ones. Only a sheet that's unambiguously all-USD skips the AI call.
      let hasNonUSDSignal = !!(headerCurrency && headerCurrency !== "USD");
      if (!hasNonUSDSignal && det.currencyColumn) {
        hasNonUSDSignal = rawRows.some(r => { const cur = normalizeCurrencyCode(r[det.currencyColumn]); return cur && cur !== "USD"; });
      }
      if (!hasNonUSDSignal && det.exchangeColumn) {
        hasNonUSDSignal = rawRows.some(r => { const info = resolveExchangeInfo(r[det.exchangeColumn]); return info && info.currency !== "USD"; });
      }
      const needsAI = !det.confident || hasNonUSDSignal;

      if (needsAI) {
        try {
          const sample = rawRows.slice(0, 8);
          // Always use the real ticker/name column as the identifier source when one exists — even if it
          // "looks valid" — so the model can re-verify it against currency/exchange/ISIN context instead of
          // only being asked to resolve company names.
          const identifierCol = det.tickerColumn;
          const isinCol = det.isinColumn;
          const curCol = det.currencyColumn;
          const exchCol = det.exchangeColumn;
          const seen = new Set();
          const uniqueIdentifiers = [];
          if (identifierCol) {
            for (const r of rawRows) {
              const val = String(r[identifierCol] ?? "").trim();
              if (!val || seen.has(val)) continue;
              seen.add(val);
              const entry = { value: val };
              if (isinCol) { const isin = String(r[isinCol] ?? "").trim(); if (isin) entry.isin = isin; }
              if (curCol) { const cur = normalizeCurrencyCode(r[curCol]); if (cur) entry.currency = cur; }
              if (exchCol) { const exch = String(r[exchCol] ?? "").trim(); if (exch) entry.exchange = exch; }
              uniqueIdentifiers.push(entry);
              if (uniqueIdentifiers.length >= 80) break;
            }
          }
          const userMsg = `HEADERS:\n${JSON.stringify(headers)}\n\nSAMPLE ROWS:\n${JSON.stringify(sample)}${uniqueIdentifiers.length ? `\n\nRESOLVE/VERIFY THE REAL TICKER FOR EACH OF THESE IDENTIFIERS (from column "${identifierCol}"):\n${JSON.stringify(uniqueIdentifiers)}` : ""}`;
          const ai = await callClaude(IMPORT_MAPPING_SYSTEM_PROMPT, userMsg, { maxTokens: 4400, maxSearches: 3 });
          // Spread the deterministic mapping first — the AI response only refines the columns it
          // was asked about. Rebuilding from scratch here used to drop nameColumn/typeColumn/
          // valueColumn, which silently broke cash-row detection in the preview.
          mapping = {
            ...mapping,
            tickerColumn: ai.tickerColumn || mapping.tickerColumn,
            sharesColumn: ai.sharesColumn || mapping.sharesColumn,
            costColumn: ai.costColumn || mapping.costColumn,
            totalCostColumn: ai.totalCostColumn || mapping.totalCostColumn,
            currencyColumn: ai.currencyColumn || mapping.currencyColumn,
            exchangeColumn: ai.exchangeColumn || mapping.exchangeColumn,
          };
          if (Array.isArray(ai.nameMappings)) {
            for (const m of ai.nameMappings) if (m?.input) nameMap[m.input] = { ticker: m.ticker || null, currency: m.currency || null };
          }
        } catch (_) {
          // AI verification failed — fall back to whatever was deterministically found; the user can remap by hand below.
        }
      }

      const rows = computeImportRows(headers, rawRows, mapping, nameMap);
      setImportPreview({ headers, rawRows, mapping, nameMap, rows, aiAssisted: needsAI, cashDetected, includeCash: true });
    } catch (err) {
      setImportError("Could not read that file. Make sure it's a valid .xlsx, .xls or .csv file.");
    } finally {
      setImportAnalyzing(false);
    }
  }

  // Lets the user override a detected column by hand — recomputes instantly, no extra AI call.
  function remapImport(field, value) {
    setImportPreview(prev => {
      if (!prev) return prev;
      const mapping = { ...prev.mapping, [field]: value || null };
      const rows = computeImportRows(prev.headers, prev.rawRows, mapping, prev.nameMap);
      return { ...prev, mapping, rows };
    });
  }
  function confirmImport() {
    const valid = importPreview.rows.filter(r => r.valid);
    persistHoldings([...holdings, ...valid.map(r => ({ ticker: r.ticker, shares: r.shares, cost: r.cost, currency: r.currency }))]);
    // Set (not add to) Spare Cash — the imported figure is the investor's CURRENT total uninvested cash,
    // not a top-up on whatever placeholder value happened to be sitting in the field already. Stored in
    // its OWN native currency (exactly what the preview showed, no forced conversion) — display always
    // converts it to match Portfolio Value's currency, so the two can never show mismatched currencies.
    if (importPreview.cashDetected && importPreview.includeCash) {
      updateSpareCash(String(importPreview.cashDetected.amount), importPreview.cashDetected.currency);
    }
    setImportPreview(null);
  }
  function addHolding() {
    const t = nt.trim().toUpperCase(); const s = parseNum(ns); const cst = parseNum(nc);
    if (!t || s == null || cst == null) return;
    persistHoldings([...holdings, { ticker: t, shares: String(s), cost: String(cst), currency: ncur }]);
    setNt(""); setNs(""); setNc(""); setNcur("USD"); setReview(null);
  }
  function removeHolding(idx) { persistHoldings(holdings.filter((_, i) => i !== idx)); setReview(null); }
  function clearAllHoldings() { persistHoldings([]); setReview(null); setConfirmClearOpen(false); }

  // Signing out wipes this device's copy — the durable copy lives in Firestore, so the same
  // account restores on next sign-in, and a different account never sees the previous user's
  // data on a shared device. That includes the pick-history log: only the localStorage copy is
  // wiped; the cloud docs under users/{uid}/pick_history persist for that account.
  function handleSignOut() {
    signOut(auth).then(() => {
      syncedUid.current = null;
      setFirebaseUser(null);
      setProfile(null); setHoldings([]); setSpareCash(""); setSpareCashCurrency("USD");
      setResearchHistory([]); setRecs(null); setReview(null); setResult(null); setError(null); setQuery("");
      setNewsItems(null); setNewsInsiderActivity(null); setMarketNews(null); setLivePrices({});
      setPhase("onboarding"); setNav("home");
      ["atlas_profile", "atlas_holdings", "atlas_spare_cash", "atlas_spare_cash_currency", "atlas_research_history", "atlas_market_news", "atlas_recs", PICK_HISTORY_KEY].forEach(kvDel);
    }).catch(() => {});
  }

  // ---- firebase gates ----
  if (firebaseUser === undefined) return (
    <AtlasMotionProvider><AtlasStyles /><div style={{ background: c.canvas, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}><Spinner size={20} /><span style={{ ...type.overline, color: c.text3 }}>Loading</span></div></AtlasMotionProvider>
  );
  const firebaseConfigured = !!import.meta.env.VITE_FIREBASE_API_KEY;
  if (firebaseConfigured && !firebaseUser) return <AtlasMotionProvider><AtlasStyles /><AuthScreen onAuth={(u) => setFirebaseUser(u)} /></AtlasMotionProvider>;

  if (phase === "onboarding") return (
    <AtlasMotionProvider><AtlasStyles /><Onboarding initial={profile} onDone={finishOnboarding} onExit={profile?.name ? () => setPhase("app") : null} /></AtlasMotionProvider>
  );

  // ---- portfolio derived figures ----
  // Each position is valued in its OWN recorded currency first (no mixing live-quote currency with
  // cost currency). The portfolio's display currency is that same currency when every holding shares
  // one — totals stay untouched, zero FX risk — and only becomes USD when holdings are genuinely mixed,
  // per the user's "keep it in whatever currency the holdings are in" preference.
  const expPalette = [c.accent, c.seriesAlt, c.positive, c.warning, "#C77DFF", "#5BA8FF", "#FF8A5C", "#3DDC84"];
  let lHaveVal = false;
  const positions = [];
  for (const h of holdings) {
    const sh = parseNum(h.shares), cb = parseNum(h.cost); if (sh == null || cb == null) continue;
    const curr = normalizeCurrencyCode(h.currency || "USD");
    const lp = livePrices[h.ticker];
    let priceNative = null;
    if (lp?.price != null) { priceNative = fxConvert(lp.price, lp.currency || curr, curr, fxRates); if (priceNative != null) lHaveVal = true; }
    else { const rv = reviewFor(h.ticker); const curRev = rv ? parseNum(rv.currentPrice) : null; if (curRev != null) { priceNative = curRev; lHaveVal = true; } }
    positions.push({ ticker: h.ticker, currency: curr, costNative: sh * cb, valueNative: (priceNative != null ? priceNative : cb) * sh });
  }
  const distinctCurrencies = [...new Set(positions.map(p => p.currency))];
  const portfolioCurrency = distinctCurrencies.length === 1 ? distinctCurrencies[0] : "USD";
  let lCost = 0, lValue = 0, fxIncomplete = false;
  const exposure = [];
  for (const p of positions) {
    const costConv = fxConvert(p.costNative, p.currency, portfolioCurrency, fxRates);
    const valConv = fxConvert(p.valueNative, p.currency, portfolioCurrency, fxRates);
    if (costConv == null || valConv == null) { fxIncomplete = true; continue; }
    lCost += costConv; lValue += valConv;
    exposure.push({ ticker: p.ticker, val: valConv });
  }
  const lPl = lHaveVal ? lValue - lCost : null;
  const lPlPct = lHaveVal && lCost ? ((lValue - lCost) / lCost) * 100 : null;
  const isUp = lPlPct != null && lPlPct >= 0;
  const totalExp = exposure.reduce((a, b) => a + b.val, 0) || 1;
  const expSegments = exposure.map((e, i) => ({ ...e, pct: (e.val / totalExp) * 100, color: expPalette[i % expPalette.length] })).sort((a, b) => b.pct - a.pct);

  // Spare Cash always DISPLAYS converted into whatever currency Portfolio Value is currently showing —
  // exactly like a holding's own currency gets converted for the aggregate — so the two can never disagree.
  const spareCashNum = parseNum(spareCash);
  const spareCashDisplay = spareCashNum != null && spareCashNum > 0 ? fxConvert(spareCashNum, spareCashCurrency, portfolioCurrency, fxRates) : null;

  const sectionTitle = { home: "Today", discover: "Discover", portfolio: "Portfolio", research: "Research", backtest: "Backtest" }[nav] || "Atlas";

  // ============================================================
  //  SCREENS
  // ============================================================
  const HomeScreen = nav !== "home" ? null : renderSafely("Home", () => (
    <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.05 } } }} style={{ maxWidth: 980, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <motion.div variants={{ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } }}>
        <Overline color={c.accent} style={{ marginBottom: 8 }}>Good to see you, {profile?.name || "Investor"}</Overline>
        <h1 style={{ ...type.displayL, color: c.text, margin: 0 }}>Your market, at a glance.</h1>
      </motion.div>

      {/* portfolio strip */}
      <motion.div variants={{ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } }}>
        <Card interactive onClick={() => setNav("portfolio")} pad={22}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <InfoTip title="Live pricing" body="Valued using real-time market prices and current exchange rates — not whatever prices were saved in a spreadsheet at import time. Totals will move as markets move, and won't match a static export.">
                <Overline color={c.text3} style={{ marginBottom: 8 }}>Portfolio value{distinctCurrencies.length > 1 ? ` (in ${portfolioCurrency})` : ""}</Overline>
              </InfoTip>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <span style={{ ...type.displayXl, fontSize: 40, color: c.text }}>{holdings.length ? <AnimatedNumber value={lHaveVal ? lValue : lCost} format={(v) => fmtCurrency(v, portfolioCurrency)} /> : "—"}</span>
                {lPl != null && <span style={{ ...type.data, fontSize: 16, color: isUp ? c.positive : c.negative }}>{isUp ? "+" : ""}{fmtCurrency(lPl, portfolioCurrency)} ({isUp ? "+" : ""}{lPlPct.toFixed(2)}%)</span>}
                {holdings.length > 0 && <LiveIndicator loading={livePricesLoading} lastUpdate={lastPriceUpdate} />}
              </div>
              <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap" }}>
                <div><div style={{ ...type.caption, color: c.text3 }}>Invested</div><div style={{ ...type.data, color: c.text2 }}>{fmtCurrency(lCost, portfolioCurrency)}</div></div>
                <div><div style={{ ...type.caption, color: c.text3 }}>Positions</div><div style={{ ...type.data, color: c.text2 }}>{holdings.length}</div></div>
                {spareCashDisplay != null && <div><div style={{ ...type.caption, color: c.text3 }}>Cash available</div><div style={{ ...type.data, color: c.accent }}>{fmtCurrency(spareCashDisplay, portfolioCurrency)}</div></div>}
              </div>
              {fxIncomplete && <div style={{ ...type.caption, color: c.warning, marginTop: 8 }}>Some positions excluded from the total — exchange rates still loading.</div>}
            </div>
            <span style={{ ...type.caption, color: c.accent }}>Open portfolio →</span>
          </div>
          {expSegments.length > 0 && <div style={{ marginTop: 18 }}><ExposureBar segments={expSegments} /></div>}
        </Card>
      </motion.div>

      {/* market pulse / today's news — kept deliberately compact, this is a glance screen */}
      <motion.div variants={{ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <Overline color={c.text3}>Today's market</Overline>
          <Button variant="ghost" size="sm" onClick={() => fetchMarketNews(false)} loading={marketNewsLoading}>{marketNews ? "Refresh" : "Load"}</Button>
        </div>
        {marketNewsLoading && <Card pad={14}><LoadingBlock title="Loading today's market news…" sub="Latest headlines + Atlas's read" /></Card>}
        {marketNewsError && !marketNewsLoading && <ErrorBanner msg={marketNewsError} onRetry={() => fetchMarketNews(false)} label="Try again" />}
        {marketNews && !marketNewsLoading && (
          <Card pad={14}>
            {marketNews.marketPulse && (
              <div style={{ ...type.caption, color: c.text2, lineHeight: 1.5, paddingBottom: 10, marginBottom: 6, borderBottom: `1px solid ${c.hairline}`, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                <b style={{ color: c.text }}>Pulse: </b>{marketNews.marketPulse}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              {(marketNews.items || []).slice(0, 5).map((item, i, arr) => {
                const hasUrl = item.url && item.url.startsWith("http");
                const sub = item.impact || item.summary || "";
                return (
                  <div key={i} style={{ padding: "9px 4px", borderBottom: i < arr.length - 1 ? `1px solid ${c.hairline}` : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {item.category && <Badge tone="accent" style={{ flexShrink: 0, fontSize: 10 }}>{item.category}</Badge>}
                      <div style={{ minWidth: 0, flex: 1, ...type.small, color: c.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {hasUrl ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="atlas-link">{item.headline}</a> : item.headline}
                      </div>
                      {item.relatedTicker && (
                        <button onClick={() => openTicker(item.relatedTicker)} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", ...type.caption, color: c.accent, fontWeight: 600 }}>
                          {item.relatedTicker} →
                        </button>
                      )}
                    </div>
                    {sub && <div style={{ ...type.caption, color: c.text3, lineHeight: 1.45, marginTop: 3, marginLeft: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{sub}</div>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
        {!marketNews && !marketNewsLoading && !marketNewsError && <Card pad={14}><EmptyState title="Today's market news" hint="Load the latest market-moving news and get Atlas's read on what it means." /></Card>}
      </motion.div>

      {/* top picks */}
      <motion.div variants={{ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Overline color={c.text3}>Top picks for you</Overline>
          <Button variant="ghost" size="sm" onClick={() => setNav("discover")}>See all →</Button>
        </div>
        {recsLoading && <Card><LoadingBlock title="Scanning markets for your best fits…" /></Card>}
        {!recsLoading && recs?.picks && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
            {recs.picks.slice(0, 3).map((p) => (
              <Card key={p.ticker} interactive onClick={() => openTicker(p.ticker)} pad={16}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <StockLogo ticker={p.ticker} size={34} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: font.mono, fontWeight: 700, fontSize: 12, color: c.accent }}>{p.ticker}</div>
                    <div style={{ ...type.caption, color: c.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.company}</div>
                  </div>
                  <div style={{ marginLeft: "auto" }}><ScoreRing score={p.fitScore} size={46} stroke={4} /></div>
                </div>
                <div style={{ ...type.caption, color: c.text2, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.reason}</div>
              </Card>
            ))}
          </div>
        )}
        {!recsLoading && !recs?.picks && (
          <Card><EmptyState title="No picks yet" hint="Atlas can scan global markets for stocks that fit how you invest." action={<Button onClick={() => { setNav("discover"); if (!recsLoading) discover(); }} glow>Scan markets</Button>} /></Card>
        )}
      </motion.div>

      {/* quick actions */}
      <motion.div variants={{ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: 12 }}>
          {[["research", "Research a stock", "Full AI dossier on any ticker"], ["portfolio", "Review portfolio", "Buy / hold / sell on every position"], ["backtest", "Backtest a strategy", "Does it beat buy-and-hold?"]].map(([k, t, d]) => (
            <Card key={k} interactive onClick={() => setNav(k)} pad={16}>
              <div style={{ ...type.bodyStrong, color: c.text, marginBottom: 4 }}>{t}</div>
              <div style={{ ...type.caption, color: c.text3, lineHeight: 1.5 }}>{d}</div>
              <div style={{ ...type.caption, color: c.accent, marginTop: 10 }}>Open →</div>
            </Card>
          ))}
        </div>
      </motion.div>
    </motion.div>
  ));

  const DiscoverScreen = nav !== "discover" ? null : renderSafely("Discover", () => (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Card pad={18} style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ ...type.heading, color: c.text, margin: "0 0 2px" }}>Best buys for you</h2>
            <span style={{ ...type.small, color: c.text3 }}>Ranked by fit to your profile · global markets{holdings.length ? ` · ${holdings.length} positions loaded` : ""}</span>
          </div>
          <Button onClick={discover} loading={recsLoading} glow>{recsLoading ? "Scanning…" : "Refresh picks"}</Button>
        </div>
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          {/* Picking a universe re-runs the scan immediately (only once a first scan exists —
              otherwise it just sets the filter for the upcoming one). */}
          <SegmentedControl value={universe} onChange={(v) => { setUniverse(v); if (recs || recsError || recsLoading) discover(v); }} options={["Global all-markets", "US markets", "Europe", "Asia-Pacific", "My interest sectors"]} size="sm" />
        </div>
      </Card>
      {recsLoading && <Card><LoadingBlock title="Finding your best picks…" sub="verifying current data · usually 15–20s" /></Card>}
      {recsError && !recsLoading && <ErrorBanner msg={recsError} onRetry={discover} label="Scan again" />}
      {recs?.picks && !recsLoading && (
        <div>
          {recs.marketContext && (
            <Card accentEdge pad={14} style={{ borderLeftColor: c.warning, marginBottom: 12 }}>
              <span style={{ ...type.small, color: c.text2, lineHeight: 1.5 }}><b style={{ color: c.text }}>Market context:</b> {recs.marketContext}</span>
            </Card>
          )}
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.04 } } }}
            style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            {recs.picks.map((p, i) => (
              <motion.div key={p.ticker || i} variants={{ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } }} style={i === 0 ? { gridColumn: isMobile ? "auto" : "1 / -1" } : {}}>
                <OpportunityCard pick={p} rank={i + 1} hero={i === 0 && !isMobile} onOpen={() => openTicker(p.ticker)} />
              </motion.div>
            ))}
          </motion.div>
          {recsAtRef.current > 0 && <div style={{ ...type.caption, color: c.text3, marginTop: 12, textAlign: "center" }}>Scanned {fmtHistoryDate(new Date(recsAtRef.current).toISOString())}</div>}
        </div>
      )}
      {/* Honest idle state — the old copy claimed "Scanning…" while nothing was running. */}
      {!recs && !recsLoading && !recsError && <Card><EmptyState title="No scan yet" hint="Atlas scans global markets and ranks stocks by fit to your profile and portfolio." action={<Button glow onClick={() => discover()}>Scan markets</Button>} /></Card>}
      {/* Scoreboard over the append-only pick log — how past Discover picks actually did vs the market. */}
      <TrackRecord />
    </div>
  ));

  const PortfolioScreen = nav !== "portfolio" ? null : renderSafely("Portfolio", () => (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}><SegmentedControl value={portfolioTab} onChange={(v) => { setPortfolioTab(v); if (v === "news" && !newsItems && !newsLoading) fetchPortfolioNews(); }} options={[{ value: "holdings", label: "Holdings" }, { value: "news", label: "Portfolio News" }]} /></div>

      <Card pad={isMobile ? 18 : 24} style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <InfoTip title="Live pricing" body="Valued using real-time market prices and current exchange rates — not whatever prices were saved in a spreadsheet at import time. Totals will move as markets move, and won't match a static export.">
              <Overline color={c.text3} style={{ marginBottom: 8 }}>Portfolio value{distinctCurrencies.length > 1 ? ` (in ${portfolioCurrency})` : ""}</Overline>
            </InfoTip>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ ...type.displayXl, fontSize: isMobile ? 28 : 40, color: c.text }}>{lHaveVal ? <AnimatedNumber value={lValue} format={(v) => fmtCurrency(v, portfolioCurrency)} /> : holdings.length ? fmtCurrency(lCost, portfolioCurrency) : "—"}</span>
              {lPl != null && <span style={{ ...type.data, fontSize: isMobile ? 13 : 16, color: isUp ? c.positive : c.negative }}>{isUp ? "+" : ""}{fmtCurrency(lPl, portfolioCurrency)} ({isUp ? "+" : ""}{lPlPct.toFixed(2)}%)</span>}
              <LiveIndicator loading={livePricesLoading} lastUpdate={lastPriceUpdate} />
            </div>
            <div style={{ display: "flex", gap: isMobile ? 16 : 28, marginTop: 12, flexWrap: "wrap" }}>
              <div><div style={{ ...type.caption, color: c.text3 }}>Invested</div><div style={{ ...type.data, color: c.text2 }}>{fmtCurrency(lCost, portfolioCurrency)}</div></div>
              <div><div style={{ ...type.caption, color: c.text3 }}>Positions</div><div style={{ ...type.data, color: c.text2 }}>{holdings.length}</div></div>
              {spareCashDisplay != null && <div><div style={{ ...type.caption, color: c.text3 }}>Cash available</div><div style={{ ...type.data, color: c.accent }}>{fmtCurrency(spareCashDisplay, portfolioCurrency)}</div></div>}
            </div>
            {fxIncomplete && <div style={{ ...type.caption, color: c.warning, marginTop: 8 }}>Some positions excluded from the total — exchange rates still loading.</div>}
          </div>
          <Button onClick={analyzePortfolio} loading={reviewLoading} disabled={!holdings.length} glow>{review ? "Re-analyse" : "Run AI Analysis"}</Button>
        </div>
        {expSegments.length > 0 && <div style={{ marginTop: 18 }}><ExposureBar segments={expSegments} /></div>}
      </Card>

      {portfolioTab === "holdings" && (
        <>
          {holdings.length > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <Button variant="ghost" size="sm" onClick={() => setConfirmClearOpen(true)} style={{ color: c.text3 }}>Clear all holdings</Button>
            </div>
          )}
          <Card pad={0} style={{ marginBottom: 14, overflow: "hidden" }}>
            {/* The desktop grid needs ~860px — on narrow desktop windows (768–900px) it scrolls
                horizontally instead of clipping the P&L/Call columns out of reach. */}
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: !isMobile && holdings.length > 0 ? 860 : 0 }}>
                {!isMobile && holdings.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 95px 80px 95px 110px 120px 92px 60px", padding: "10px 4px", background: c.surface2, borderBottom: `1px solid ${c.hairline}` }}>
                    <span />
                    {[["Asset","left"],["Price","right"],["Qty","right"],["Avg Cost","right"],["Mkt Value","right"],["P&L","right"],["Call","center"],["",""]].map(([h, al], i) => (
                      <span key={i} style={{ ...type.overline, color: c.text3, textAlign: al, padding: "0 8px" }}>{h}</span>
                    ))}
                  </div>
                )}
                {holdings.length === 0
                  ? <EmptyState title="No positions yet" hint="Add a holding below, or import from a spreadsheet, to track live P&L and run AI analysis." />
                  : holdings.map((h, i) => (
                      <HoldingRow key={`${h.ticker}-${i}`} h={h} fxRates={fxRates} livePrice={livePrices[h.ticker]} review={reviewFor(h.ticker)} onOpen={() => openTicker(h.ticker)} onRemove={() => setConfirmRemoveIdx(i)} />
                    ))}
              </div>
            </div>
          </Card>

          {reviewLoading && <Card><LoadingBlock title="Fetching live prices and running AI analysis…" sub="live data · tuned to your profile" /></Card>}
          {reviewError && !reviewLoading && <ErrorBanner msg={reviewError} onRetry={analyzePortfolio} label="Try again" />}

          {review?.portfolio && !reviewLoading && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {review.portfolio.cashAdvice && spareCashDisplay != null && (
                <Card accentEdge pad={18} style={{ background: c.accentSoft, borderColor: c.accentBorder }}>
                  <Overline color={c.accent} style={{ marginBottom: 8 }}>Deploy {fmtCurrency(spareCashDisplay, portfolioCurrency)} cash</Overline>
                  <p style={{ ...type.small, lineHeight: 1.6, color: c.text, margin: 0 }}>{review.portfolio.cashAdvice}</p>
                </Card>
              )}
              <Card pad={18}>
                <Overline color={c.text3} style={{ marginBottom: 12 }}>Advisor · portfolio analysis</Overline>
                {review.portfolio.summary && <p style={{ ...type.small, lineHeight: 1.6, color: c.text2, margin: "0 0 12px" }}>{review.portfolio.summary}</p>}
                {review.portfolio.concentration && <p style={{ ...type.caption, lineHeight: 1.55, color: c.text3, margin: "0 0 10px" }}>{review.portfolio.concentration}</p>}
                {Array.isArray(review.portfolio.suggestions) && review.portfolio.suggestions.map((s, i) => (
                  <div key={i} style={{ ...type.small, color: c.text2, padding: "4px 0", display: "flex", gap: 10 }}><span style={{ color: c.accent, flexShrink: 0 }}>→</span>{s}</div>
                ))}
              </Card>
            </motion.div>
          )}

          {/* Add position composer */}
          <Card pad={18} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <Overline color={c.text3}>Add position</Overline>
              <Button variant="secondary" size="sm" onClick={() => importRef.current?.click()} icon={<UploadIcon />} loading={importAnalyzing} disabled={importAnalyzing}>{importAnalyzing ? "Analyzing spreadsheet…" : "Import spreadsheet"}</Button>
              <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleImportFile} />
            </div>
            {importError && <ErrorBanner msg={importError} onRetry={() => { setImportError(null); importRef.current?.click(); }} label="Pick another file" />}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Ticker" style={{ flex: "0 0 120px" }}>
                <Input mono value={nt} onChange={e => setNt(e.target.value)} placeholder="AAPL" onKeyDown={e => e.key === "Enter" && addHolding()} style={{ color: c.accent, fontWeight: 700, textTransform: "uppercase" }} />
              </Field>
              <Field label="Shares" style={{ flex: "0 0 90px" }}>
                <Input mono value={ns} onChange={e => setNs(e.target.value)} placeholder="10" inputMode="decimal" onKeyDown={e => e.key === "Enter" && addHolding()} />
              </Field>
              <Field label="Avg buy price" style={{ flex: "1 1 180px", minWidth: 160 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <Select value={ncur} onChange={e => setNcur(e.target.value)} options={CURRENCIES} style={{ flex: "0 0 86px" }} />
                  <Input mono value={nc} onChange={e => setNc(e.target.value)} placeholder="182.50" inputMode="decimal" onKeyDown={e => e.key === "Enter" && addHolding()} style={{ flex: 1 }} />
                </div>
              </Field>
              <Button onClick={addHolding} icon={<PlusIcon />}>Add</Button>
            </div>
            <div style={{ ...type.caption, color: c.text3, marginTop: 8, lineHeight: 1.5 }}>Non-US stocks need an exchange suffix — e.g. <span style={{ fontFamily: font.mono, color: c.text2 }}>SAF.PA</span> (Paris), <span style={{ fontFamily: font.mono, color: c.text2 }}>SHEL.L</span> (London), <span style={{ fontFamily: font.mono, color: c.text2 }}>9988.HK</span> (HK)</div>
            <Divider style={{ margin: "14px 0" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Overline color={c.text3}>Spare cash</Overline>
              {/* The field edits the amount in ITS OWN currency (e.g. GBP cash from an import) —
                  labeling it with the portfolio's display currency silently re-tagged the number
                  as a different currency without converting it. A new amount starts in the
                  portfolio's currency. */}
              {(() => {
                const cashCur = spareCash ? normalizeCurrencyCode(spareCashCurrency || "USD") : portfolioCurrency;
                return (
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontFamily: font.mono, fontSize: 11, fontWeight: 600, color: c.text3, pointerEvents: "none" }}>{cashCur}</span>
                    <Input mono value={spareCash} onChange={e => updateSpareCash(e.target.value.replace(/[^0-9.]/g, ""), cashCur)} placeholder="0.00" inputMode="decimal" style={{ width: 160, paddingLeft: 46, color: c.accent, fontWeight: 600 }} />
                  </div>
                );
              })()}
              {spareCashDisplay != null
                ? <span style={{ ...type.caption, color: c.text3 }}>Atlas will advise how to deploy <b style={{ color: c.accent }}>{fmtCurrency(spareCashDisplay, portfolioCurrency)}</b> on analysis.</span>
                : <span style={{ ...type.caption, color: c.text3 }}>Enter cash to get specific deployment advice.</span>}
            </div>
          </Card>
        </>
      )}

      {portfolioTab === "news" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <span style={{ ...type.small, color: c.text3 }}>Latest news for your {holdings.length} holding{holdings.length !== 1 ? "s" : ""}, sourced live.</span>
            <Button variant="outline" size="sm" onClick={fetchPortfolioNews} loading={newsLoading} disabled={!holdings.length}>{newsItems ? "Refresh" : "Fetch news"}</Button>
          </div>
          {!holdings.length && <Card><EmptyState title="No holdings yet" hint="Add some holdings first to see portfolio news." /></Card>}
          {newsLoading && <Card><LoadingBlock title="Searching for latest news on your holdings…" sub="Live search · usually 15–25s" /></Card>}
          {newsError && !newsLoading && <ErrorBanner msg={newsError} onRetry={fetchPortfolioNews} label="Try again" />}
          {newsInsiderActivity && !newsLoading && (
            <Card pad={16} style={{ marginBottom: 14 }}>
              <Overline color={c.accent} style={{ marginBottom: 8 }}>Insider activity across your portfolio</Overline>
              <div style={{ ...type.small, color: c.text2, lineHeight: 1.55, marginBottom: (newsInsiderActivity.transactions || []).length ? 10 : 0 }}>{newsInsiderActivity.summary}</div>
              {(newsInsiderActivity.transactions || []).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {newsInsiderActivity.transactions.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...type.caption, color: c.text3 }}>
                      <Badge tone="accent">{t.ticker}</Badge>
                      <span style={{ fontWeight: 600, color: t.type === "Buy" ? c.positive : t.type === "Sell" ? c.negative : c.text2 }}>{t.type}</span>
                      <span>{t.insider}</span>
                      {t.shares && <span>· {t.shares} sh</span>}
                      {t.value && <span>· {t.value}</span>}
                      {t.date && <span>· {t.date}</span>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          {newsItems && !newsLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {newsItems.length === 0 && <Card><EmptyState title="No news found" /></Card>}
              {newsItems.map((item, i) => {
                const sentColor = item.sentiment === "bullish" ? c.positive : item.sentiment === "bearish" ? c.negative : c.warning;
                const isMacro = item.ticker === "MACRO";
                const hasUrl = item.url && item.url.startsWith("http");
                return (
                  <Card key={i} pad={16} accentEdge style={{ borderLeftColor: sentColor }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <Badge tone={isMacro ? "warning" : "accent"}>{isMacro ? "MACRO" : item.ticker}</Badge>
                      {item.category && <Badge tone={item.category === "Insider Trading" ? "accent" : "neutral"}>{item.category}</Badge>}
                      {item.source && <span style={{ ...type.caption, color: c.text3 }}>{item.source}</span>}
                      {item.date && <span style={{ ...type.caption, color: c.text3 }}>{item.date}</span>}
                      <span style={{ ...type.overline, color: sentColor, marginLeft: "auto" }}>{item.sentiment}</span>
                    </div>
                    <div style={{ ...type.bodyStrong, color: c.text, marginBottom: 6, lineHeight: 1.4 }}>
                      {hasUrl ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="atlas-link">{item.headline} ↗</a> : item.headline}
                    </div>
                    {item.summary && <div style={{ ...type.small, color: c.text2, lineHeight: 1.6 }}>{item.summary}</div>}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  ));

  const ResearchScreen = nav !== "research" ? null : renderSafely("Research", () => (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Card pad={18} style={{ marginBottom: 14 }}>
        <h2 style={{ ...type.heading, color: c.text, margin: "0 0 4px" }}>Equity Research</h2>
        <p style={{ ...type.small, color: c.text3, margin: "0 0 14px" }}>Full AI-powered dossier on any stock — scored to your profile and portfolio</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && evaluate()} placeholder="Enter ticker or company name (e.g. NVDA, Apple, TSMC)…" style={{ flex: "1 1 240px", fontSize: 15, height: 46 }} />
          <Button size="lg" glow onClick={() => evaluate()} loading={loading}>Run analysis</Button>
        </div>
      </Card>
      {researchHistory.length > 0 && (
        <Card pad={16} style={{ marginBottom: 14 }}>
          <Overline color={c.text3} style={{ marginBottom: 10 }}>Past research ({researchHistory.length})</Overline>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {researchHistory.map((h) => (
              <div key={h.ticker} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: radius.sm, background: c.surface1 }}>
                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => openResearchHistory(h)}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ ...type.bodyStrong, color: c.accent }}>{h.ticker}</span>
                    <span style={{ ...type.small, color: c.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.company}</span>
                  </div>
                  <div style={{ ...type.caption, color: c.text3, marginTop: 2 }}>{fmtHistoryDate(h.savedAt)}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => updateResearchHistory(h.ticker)} loading={loading && query === h.ticker}>Update</Button>
                <IconButton label="Remove from history" size={28} onClick={() => removeResearchHistory(h.ticker)} style={{ color: c.text3 }}>×</IconButton>
              </div>
            ))}
          </div>
        </Card>
      )}
      {loading && (
        <Card>
          <LoadingBlock
            title={LOADING_MSGS[msgIdx]}
            sub={elapsedSec < 45
              ? "Analyzing real fundamentals, price history & news · usually 30–90s"
              : `Still working — ${elapsedSec}s so far. A full institutional dossier is a lot to write out.`}
          />
        </Card>
      )}
      {error && !loading && <ErrorBanner msg={error} onRetry={() => evaluate()} />}
      {result && !loading && <Results result={result} profile={profile} backtestSnapshot={backtestSnapshot && (!result.ticker || backtestSnapshot.ticker === String(result.ticker).toUpperCase()) ? backtestSnapshot : null} onOpenBacktest={() => setNav("backtest")} />}
      {!result && !loading && !error && <Card><EmptyState title="Research any stock" hint="Enter a ticker or company name above to generate a full dossier scored to your profile and portfolio." /></Card>}
    </div>
  ));

  const screens = { home: HomeScreen, discover: DiscoverScreen, portfolio: PortfolioScreen, research: ResearchScreen, backtest: null };

  return (
    <AtlasMotionProvider>
      <AtlasStyles />
      <div style={{ display: "flex", background: c.canvas, minHeight: "100vh" }}>
        {!isMobile && <NavRail nav={nav} setNav={setNav} profile={profile} holdingsCount={holdings.length} onEdit={() => setShowProfileEditor(true)} onSignOut={firebaseConfigured ? handleSignOut : null} />}
        {isMobile && <BottomNav nav={nav} setNav={setNav} holdingsCount={holdings.length} />}
        {isMobile && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 52, background: c.sunken, borderBottom: `1px solid ${c.hairline}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", zIndex: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}><AtlasMark size={26} /><span style={{ ...type.heading, color: c.text }}>Atlas</span></div>
            <IconButton label="Profile" onClick={() => setShowProfileEditor(true)}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: c.accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", ...type.caption, fontWeight: 700 }}>{(profile?.name || "U")[0].toUpperCase()}</div>
            </IconButton>
          </div>
        )}

        <SlideOver open={showProfileEditor} onClose={() => setShowProfileEditor(false)}>
          {/* onSignOut here is also the ONLY sign-out path on mobile (no NavRail there). */}
          <ProfileEditor profile={profile} onSave={saveProfile} onClose={() => setShowProfileEditor(false)}
            onSignOut={firebaseConfigured && firebaseUser ? () => { setShowProfileEditor(false); handleSignOut(); } : null} />
        </SlideOver>

        <Modal open={!!importPreview} onClose={() => setImportPreview(null)} width={660}>
          {importPreview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <Overline color={c.accent} style={{ marginBottom: 4 }}>Import preview</Overline>
                  <div style={{ ...type.small, color: c.text2 }}>
                    {importPreview.rows.filter(r => r.valid).length} of {importPreview.rows.length} rows ready
                    {importPreview.aiAssisted && <span style={{ color: c.accent }}> · columns auto-detected with AI</span>}
                  </div>
                </div>
                <IconButton label="Close" onClick={() => setImportPreview(null)}><CloseIcon /></IconButton>
              </div>

              <div>
                <Overline color={c.text3} style={{ marginBottom: 8 }}>Column mapping</Overline>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                  <Field label="Ticker / name">
                    <Select value={importPreview.mapping.tickerColumn || ""} onChange={e => remapImport("tickerColumn", e.target.value)}
                      options={[{ value: "", label: "— none —" }, ...importPreview.headers.map(h => ({ value: h, label: h }))]} />
                  </Field>
                  <Field label="Shares">
                    <Select value={importPreview.mapping.sharesColumn || ""} onChange={e => remapImport("sharesColumn", e.target.value)}
                      options={[{ value: "", label: "— none —" }, ...importPreview.headers.map(h => ({ value: h, label: h }))]} />
                  </Field>
                  <Field label="Avg cost / share">
                    <Select value={importPreview.mapping.costColumn || ""} onChange={e => remapImport("costColumn", e.target.value)}
                      options={[{ value: "", label: "— none —" }, ...importPreview.headers.map(h => ({ value: h, label: h }))]} />
                  </Field>
                  <Field label="Currency column">
                    <Select value={importPreview.mapping.currencyColumn || ""} onChange={e => remapImport("currencyColumn", e.target.value)}
                      options={[{ value: "", label: "— none —" }, ...importPreview.headers.map(h => ({ value: h, label: h }))]} />
                  </Field>
                  <Field label="Exchange column">
                    <Select value={importPreview.mapping.exchangeColumn || ""} onChange={e => remapImport("exchangeColumn", e.target.value)}
                      options={[{ value: "", label: "— none —" }, ...importPreview.headers.map(h => ({ value: h, label: h }))]} />
                  </Field>
                  <Field label="Sheet currency">
                    <Select value={importPreview.mapping.sheetCurrency || ""} onChange={e => remapImport("sheetCurrency", e.target.value)}
                      options={[{ value: "", label: "auto-detect" }, ...CURRENCIES.map(cur => ({ value: cur, label: cur }))]} />
                  </Field>
                </div>
                <div style={{ ...type.caption, color: c.text3, marginTop: 8, lineHeight: 1.5 }}>
                  Didn't get it right? Adjust any column above — it re-maps instantly. <b style={{ color: c.text2 }}>Sheet currency</b> applies to every row without its own currency column (auto-detected from symbols like "(€)" in your headers, or set it yourself). <b style={{ color: c.text2 }}>Exchange column</b> lets Atlas append the right suffix to international tickers (e.g. "SAF" + "Euronext Paris" → "SAF.PA") so prices resolve correctly.
                </div>
              </div>

              {importPreview.cashDetected && (() => {
                const cd = importPreview.cashDetected;
                const converted = fxConvert(cd.amount, cd.currency, portfolioCurrency, fxRates);
                const showConverted = converted != null && normalizeCurrencyCode(cd.currency) !== normalizeCurrencyCode(portfolioCurrency);
                return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, background: c.accentSoft, border: `1px solid ${c.accentBorder}`, borderRadius: radius.sm, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ ...type.small, color: c.text2 }}>
                      {/* Show the converted portfolio-currency figure too, so the previewed amount matches the
                          "Cash available" tile shown after import (which displays in the portfolio currency). */}
                      Found <b style={{ color: c.accent }}>{fmtCurrency(cd.amount, cd.currency)}</b>{showConverted ? <> (≈ <b style={{ color: c.accent }}>{fmtCurrency(converted, portfolioCurrency)}</b> in your portfolio currency)</> : null} of uninvested cash — not a security, so it's kept separate and set as your Spare Cash (replacing any current value).
                    </span>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, ...type.caption, color: c.text3, cursor: "pointer", flexShrink: 0 }}>
                      <input type="checkbox" checked={importPreview.includeCash} onChange={e => setImportPreview(prev => ({ ...prev, includeCash: e.target.checked }))} />
                      Include it
                    </label>
                  </div>
                  {cd.multiCurrency && (
                    <div style={{ ...type.caption, color: c.warning }}>
                      Cash was found in multiple currencies ({cd.breakdown.map(b => fmtCurrency(b.amount, b.currency)).join(", ")}). Only the largest is set automatically — add the rest to Spare Cash manually.
                    </div>
                  )}
                </div>
                );
              })()}

              <div style={{ overflowY: "auto", maxHeight: "42vh", border: `1px solid ${c.hairline}`, borderRadius: radius.sm }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 60px", ...type.overline, color: c.text3, padding: "8px 14px", borderBottom: `1px solid ${c.hairline}`, background: c.surface2 }}>
                  <span>Ticker</span><span>Shares</span><span>Avg Cost</span><span>Cur</span>
                </div>
                {importPreview.rows.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 60px", padding: "9px 14px", borderBottom: `1px solid ${c.hairline}`, background: r.valid ? "transparent" : c.negativeSoft, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 700, color: r.valid ? c.accent : c.negative }}>{r.ticker || <em style={{ opacity: 0.4 }}>unresolved</em>}</div>
                      {r.sourceLabel && <div style={{ ...type.caption, color: c.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>from "{r.sourceLabel}"</div>}
                    </div>
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: r.shares ? c.text : c.negative }}>{r.shares || "—"}</span>
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: r.cost ? c.text : c.negative }}>{r.cost ? `${r.currency !== "USD" ? r.currency + " " : "$"}${r.cost}` : "—"}</span>
                    <span style={{ fontFamily: font.mono, fontSize: 11, color: c.text2 }}>{r.currency}</span>
                  </div>
                ))}
              </div>
              {importPreview.rows.filter(r => !r.valid).length > 0 && <div style={{ ...type.caption, color: c.warning }}>Rows highlighted in red are missing required fields and will be skipped.</div>}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Button variant="secondary" onClick={() => setImportPreview(null)}>Cancel</Button>
                {/* A cash-only sheet is importable too — the detected cash goes to Spare Cash even
                    when there isn't a single valid security row. */}
                {(() => {
                  const validCount = importPreview.rows.filter(r => r.valid).length;
                  const cashOnly = validCount === 0 && importPreview.cashDetected && importPreview.includeCash;
                  return (
                    <Button onClick={confirmImport} disabled={validCount === 0 && !cashOnly}>
                      {cashOnly ? "Import cash only" : `Import ${validCount} holding${validCount === 1 ? "" : "s"}`}
                    </Button>
                  );
                })()}
              </div>
            </div>
          )}
        </Modal>

        <Modal open={confirmRemoveIdx != null} onClose={() => setConfirmRemoveIdx(null)} width={400}>
          <Overline color={c.negative} style={{ marginBottom: 8 }}>Remove position</Overline>
          <p style={{ ...type.body, color: c.text2, margin: "0 0 20px", lineHeight: 1.6 }}>
            Remove <b style={{ color: c.text, fontFamily: font.mono }}>{holdings[confirmRemoveIdx]?.ticker}</b> ({fmtShares(holdings[confirmRemoveIdx]?.shares)} shares) from your portfolio? This can't be undone.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setConfirmRemoveIdx(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { removeHolding(confirmRemoveIdx); setConfirmRemoveIdx(null); }}>Remove</Button>
          </div>
        </Modal>

        <Modal open={confirmClearOpen} onClose={() => setConfirmClearOpen(false)} width={420}>
          <Overline color={c.negative} style={{ marginBottom: 8 }}>Clear all holdings</Overline>
          <p style={{ ...type.body, color: c.text2, margin: "0 0 20px", lineHeight: 1.6 }}>
            Remove all {holdings.length} position{holdings.length !== 1 ? "s" : ""} from your portfolio? Your spare cash amount stays as-is, but the AI portfolio review will be cleared since it's tied to these positions. This can't be undone.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setConfirmClearOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={clearAllHoldings}>Clear {holdings.length} holdings</Button>
          </div>
        </Modal>

        <HelpChat />

        <div style={{ marginLeft: isMobile ? 0 : 76, flex: 1, padding: isMobile ? "64px 14px calc(84px + env(safe-area-inset-bottom))" : "0 36px 60px", maxWidth: isMobile ? "100vw" : "calc(100vw - 76px)", boxSizing: "border-box", overflowX: "hidden" }}>
          {!isMobile && <TopBar title={sectionTitle} onSearch={openTicker} />}
          {/* No AnimatePresence/exit animation here on purpose: with mode="wait" the next screen
              only mounts once the previous one's exit transition reports done, and a heavy tree
              (e.g. a full research dossier with many animated children) can leave that exit
              tracking stuck — the result is a permanently blank content pane with working nav.
              A plain keyed enter-only transition can't get stuck this way: the old screen is
              simply gone and the new one mounts immediately, whether or not anything animates. */}
          <motion.div key={nav} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.16,1,0.3,1] }} style={{ paddingTop: isMobile ? 0 : 28 }}>
            <ScreenErrorBoundary key={nav}>
              {screens[nav]}
            </ScreenErrorBoundary>
          </motion.div>
          {/* The backtester lives OUTSIDE the keyed transition wrapper and is hidden rather than
              unmounted — otherwise every tab switch threw away its results, params and stress
              tests. Mounted lazily on first visit so its chunk still stays out of the first load. */}
          {backtestMounted && (
            <div style={{ display: nav === "backtest" ? undefined : "none", paddingTop: isMobile ? 0 : 28 }}>
              <ScreenErrorBoundary>
                <Suspense fallback={<Card><LoadingBlock title="Loading backtester…" /></Card>}>
                  <Backtester initialTicker={result?.ticker || query} />
                </Suspense>
              </ScreenErrorBoundary>
            </div>
          )}

          <footer style={{ marginTop: 44, paddingTop: 16, borderTop: `1px solid ${c.hairline}` }}>
            <p style={{ ...type.caption, lineHeight: 1.6, color: c.text3, margin: 0 }}>Atlas surfaces research ideas for educational purposes only — not investment advice. All scores, calls and picks are AI-generated from public data and may be incomplete or outdated. Always conduct independent due diligence before any transaction.</p>
          </footer>
        </div>
      </div>
    </AtlasMotionProvider>
  );
}

// ============================================================
//  ICONS (consistent 1.7 stroke, currentColor)
// ============================================================
const sIcon = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
function HomeIcon({ active }) { return <svg width="20" height="20" viewBox="0 0 24 24" {...sIcon} fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.12 : 0}><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>; }
function CompassIcon({ active }) { return <svg width="20" height="20" viewBox="0 0 24 24" {...sIcon}><circle cx="12" cy="12" r="9" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.12 : 0}/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>; }
function WalletIcon({ active }) { return <svg width="20" height="20" viewBox="0 0 24 24" {...sIcon}><rect x="3" y="6" width="18" height="13" rx="2" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.12 : 0}/><path d="M3 10h18M16 14h2"/></svg>; }
function SearchIcon({ active, size = 20 }) { return <svg width={size} height={size} viewBox="0 0 24 24" {...sIcon}><circle cx="11" cy="11" r="7" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.12 : 0}/><path d="m20 20-3.2-3.2"/></svg>; }
function ChartIcon({ active }) { return <svg width="20" height="20" viewBox="0 0 24 24" {...sIcon}><path d="M4 19V5M4 19h16"/><path d="m7 14 3-4 3 3 4-6"/></svg>; }
function HelpIcon({ size = 20 }) { return <svg width={size} height={size} viewBox="0 0 24 24" {...sIcon}><circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.2A2.8 2.8 0 0 1 12 6.5c1.5 0 2.8 1.1 2.8 2.6 0 1.7-1.7 2.2-1.7 3.9"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/></svg>; }
function CloseIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" {...sIcon}><path d="M6 6l12 12M18 6 6 18"/></svg>; }
function SignOutIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" {...sIcon}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>; }
function UploadIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" {...sIcon}><path d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16"/></svg>; }
function PlusIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" {...sIcon}><path d="M12 5v14M5 12h14"/></svg>; }
function ChevronIcon({ open }) { return <svg width="14" height="14" viewBox="0 0 24 24" {...sIcon} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}><path d="m6 9 6 6 6-6"/></svg>; }
