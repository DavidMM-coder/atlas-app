import React, { useState, useEffect, useRef } from "react";
import Backtester from "./Backtester.jsx";
import AuthScreen from "./Auth.jsx";
import { auth, onAuthStateChanged, signOut, saveUserToFirestore } from "./firebase.js";
import * as XLSX from "xlsx";

// ============================================================
//  VERDICT v3
//  Trading-style shell · Discover / Portfolio / Research
//  Deep personalized onboarding · holdings with buy/hold/sell calls
//  Evaluation by Claude with bounded live web search.
// ============================================================

const P = {
  paper: "#060a06", card: "#0b110b", ink: "#e8f5e9", slate: "#a5d6a7",
  faint: "#4a7a4a", line: "#163016", brass: "#00e676", red: "#ff5252",
  amber: "#ffab40", green: "#00e676", wash: "#080d08",
  cardBorder: "#1a301a", accent: "#00e676", dim: "#1e3a1e",
  accentDim: "#00e67622", accentBorder: "#00e67644",
  header: "#040804", rowHover: "#0f1a0f",
};
const F = { serif: "Inter, sans-serif", sans: "Inter, sans-serif", mono: "'IBM Plex Mono', monospace" };

const ACTION_COLOR = { "Buy more": "#00e5a0", "Add": "#00e5a0", "Hold": "#4a5568", "Trim": "#f5a623", "Sell": "#ff4d4d" };

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

function Tooltip({ term, children }) {
  const [visible, setVisible] = useState(false);
  const def = GLOSSARY[term];
  if (!def) return children || null;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
      {children}
      <span
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", border: `1px solid ${P.faint}`, fontFamily: F.sans, fontSize: 9, fontWeight: 700, color: P.faint, cursor: "default", flexShrink: 0, lineHeight: 1 }}
      >?</span>
      {visible && (
        <span style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", width: 260, background: P.card, border: `1px solid ${P.accent}55`, borderRadius: 8, padding: "10px 12px", zIndex: 999, boxShadow: `0 4px 20px #000a`, pointerEvents: "none" }}>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: P.accent, marginBottom: 4 }}>{term}</span>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: 12, color: P.slate, lineHeight: 1.5 }}>{def}</span>
        </span>
      )}
    </span>
  );
}

// ---------- home screen ----------
function HomeScreen({ profile, setNav }) {
  const name = profile?.name || "Investor";

  const features = [
    {
      tab: "discover",
      label: "Discover",
      headline: "Find your next move",
      desc: "Atlas scans global markets and surfaces stocks that actually fit you — your risk tolerance, your timeline, your goals. Not a generic hot list.",
      cta: "See picks →",
      accent: P.accent,
    },
    {
      tab: "research",
      label: "Research",
      headline: "Know before you buy",
      desc: "Type any ticker and get a full picture: financials, technicals, risk, recent news, and a straight-talking verdict on whether this stock belongs in your portfolio.",
      cta: "Research a stock →",
      accent: P.accent,
    },
    {
      tab: "portfolio",
      label: "Portfolio",
      headline: "See the full picture",
      desc: "Add what you own and Atlas reviews the whole portfolio — balance, exposure, how to deploy spare cash, and where you might be overexposed.",
      cta: "Review my portfolio →",
      accent: P.accent,
    },
    {
      tab: "backtest",
      label: "Backtest",
      headline: "Test before you trust",
      desc: "Pick a strategy — value, momentum, earnings surprises — and see exactly how it performed against real historical prices. Honest answer: did it actually work?",
      cta: "Run a backtest →",
      accent: P.amber,
    },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", paddingBottom: 40 }}>
      {/* Hero */}
      <div style={{ textAlign: "center", padding: "56px 0 52px", position: "relative" }}>
        {/* Subtle glow behind heading */}
        <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)", width: 400, height: 200, background: `radial-gradient(ellipse, ${P.accent}0d 0%, transparent 70%)`, pointerEvents: "none" }} />
        <div style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, letterSpacing: 1.5, color: P.accent, marginBottom: 18, textTransform: "uppercase", opacity: 0.8 }}>
          Good to see you, {name}
        </div>
        <h1 style={{ fontFamily: F.sans, fontWeight: 800, fontSize: 42, lineHeight: 1.15, color: P.ink, margin: "0 0 18px", letterSpacing: -1 }}>
          Research smarter.<br />
          <span style={{ color: P.accent }}>Invest with conviction.</span>
        </h1>
        <p style={{ fontFamily: F.sans, fontSize: 16, color: P.slate, margin: "0 auto", lineHeight: 1.65, maxWidth: 520 }}>
          Atlas is your personal AI stock analyst. Every score, every recommendation, every verdict — calibrated to your profile, your portfolio, and your goals.
        </p>
      </div>

      {/* Feature cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {features.map(f => (
          <button
            key={f.tab}
            onClick={() => setNav(f.tab)}
            className="home-card"
            style={{ textAlign: "left", background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 14, padding: "26px 28px", cursor: "pointer", display: "block", width: "100%" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: f.accent, opacity: 0.75 }}>{f.label}</span>
              <span style={{ fontFamily: F.sans, fontSize: 12, color: P.faint }}>→</span>
            </div>
            <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 20, color: P.ink, marginBottom: 10, lineHeight: 1.2 }}>{f.headline}</div>
            <div style={{ fontFamily: F.sans, fontSize: 14, color: P.faint, lineHeight: 1.65, marginBottom: 20 }}>{f.desc}</div>
            <div style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: f.accent }}>{f.cta}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- stock logo ----------
function StockLogo({ ticker, size = 32 }) {
  const [src, setSrc] = useState(`https://financialmodelingprep.com/image-stock/${ticker}.png`);
  const [failed, setFailed] = useState(false);
  const letters = (ticker || "").replace(/[^A-Z]/g, "").slice(0, 2);
  const colors = ["#00e5a0", "#00b4d8", "#f5a623", "#a78bfa", "#fb923c", "#38bdf8", "#4ade80"];
  const bg = colors[(ticker || "").charCodeAt(0) % colors.length];
  if (failed) {
    return (
      <div style={{ width: size, height: size, borderRadius: 6, background: `${bg}22`, border: `1px solid ${bg}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontFamily: F.mono, fontWeight: 600, fontSize: size * 0.3, color: bg }}>{letters}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={ticker}
      width={size} height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: 6, objectFit: "contain", background: P.wash, flexShrink: 0, border: `1px solid ${P.cardBorder}` }}
    />
  );
}

// ---------- deeper onboarding ----------
const STEPS = [
  { id: "name", kind: "text", title: "First — what should we call you?", sub: "This builds your investor profile. Verdict scores every stock and every holding against it.", ph: "Your name" },
  { id: "riskTolerance", kind: "choice", title: "How much risk can you stomach?", opts: [
    { v: "Conservative", note: "Protect what I have" }, { v: "Moderate", note: "Balanced" }, { v: "Aggressive", note: "Swing for growth" } ] },
  { id: "horizon", kind: "choice", title: "When will you likely need this money?", opts: [
    { v: "Short", note: "Under 1 year" }, { v: "Medium", note: "1 – 5 years" }, { v: "Long", note: "5 years or more" } ] },
  { id: "budget", kind: "choice", title: "Roughly how much are you investing?", sub: "Shapes how Verdict thinks about position sizing.", opts: [
    { v: "Under $1k" }, { v: "$1k – 10k" }, { v: "$10k – 50k" }, { v: "$50k – 250k" }, { v: "$250k +" } ] },
  { id: "goal", kind: "choice", title: "What are you mainly after?", opts: [
    { v: "Preserve capital", note: "Safety over upside" }, { v: "Income & dividends", note: "Steady cash" },
    { v: "Balanced growth", note: "Grow steadily" }, { v: "Aggressive growth", note: "Maximize upside" } ] },
  { id: "philosophy", kind: "choice", title: "Which style feels most like you?", sub: "There's no wrong answer — it tells Verdict what 'good' means to you.", opts: [
    { v: "Value", note: "Buy cheap, be patient" }, { v: "Growth", note: "Pay up for growth" },
    { v: "Quality", note: "Great businesses, fair price" }, { v: "Momentum", note: "Ride strength" },
    { v: "Dividends / income", note: "Get paid to wait" }, { v: "No strong style", note: "Open to all" } ] },
  { id: "targetReturn", kind: "choice", title: "What yearly return would make you happy?", sub: "Helps Verdict keep your expectations and risk in sync.", opts: [
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
  { id: "emergencyFund", kind: "choice", title: "Do you have a separate emergency fund?", sub: "So Verdict knows how much risk is actually prudent for you.", opts: [
    { v: "Yes, fully", note: "Several months saved" }, { v: "Partly", note: "Building it" }, { v: "No", note: "This is most of my cash" } ] },
  { id: "region", kind: "choice", title: "Any home-market preference?", opts: [
    { v: "United States" }, { v: "Europe" }, { v: "Global mix" }, { v: "No preference" } ] },
  { id: "interests", kind: "multi", title: "Any sectors you're drawn to?", sub: "Optional. Verdict will lean toward these.", opts: ["Technology", "Energy", "Healthcare", "Financials", "Consumer", "Industrials", "Materials", "Real estate", "Utilities", "Communications"] },
  { id: "avoid", kind: "multi", title: "Anything you'd rather not own?", sub: "Optional. Verdict will exclude and flag these.", opts: ["Tobacco", "Weapons", "Fossil fuels", "Gambling", "Alcohol", "Adult"] },
  { id: "intentions", kind: "longtext", title: "In your own words — what are you really trying to achieve?", sub: "Optional, but this is the single best way to make Verdict's read accurate. e.g. 'Build a retirement nest egg I won't touch for 20 years' or 'grow $5k aggressively, I can afford to lose it.'", ph: "Type as much or as little as you like…", optional: true },
];

// ---------- profile editor (quick panel, no re-doing all 17 steps) ----------
function ProfileEditor({ profile, onSave, onClose }) {
  const [p, setP] = useState({ ...profile });
  function set(k, v) { setP(prev => ({ ...prev, [k]: v })); }

  const Field = ({ label, id, opts, multi }) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.accent, opacity: 0.7, marginBottom: 8, textTransform: "uppercase" }}>{label}</div>
      {multi ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {opts.map(o => {
            const on = (p[id] || []).includes(o);
            return <button key={o} onClick={() => set(id, on ? (p[id]||[]).filter(x=>x!==o) : [...(p[id]||[]),o])}
              style={{ padding: "6px 14px", borderRadius: 999, border: `1.5px solid ${on ? P.accent : P.dim}`, background: on ? `${P.accent}18` : "transparent", fontFamily: F.sans, fontSize: 13, color: on ? P.accent : P.slate, cursor: "pointer" }}>{o}</button>;
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {opts.map(o => {
            const on = p[id] === o.v;
            return <button key={o.v} onClick={() => set(id, o.v)}
              style={{ padding: "7px 16px", borderRadius: 6, border: `1.5px solid ${on ? P.accent : P.dim}`, background: on ? `${P.accent}18` : "transparent", fontFamily: F.sans, fontSize: 13, color: on ? P.accent : P.slate, cursor: "pointer", whiteSpace: "nowrap" }}>
              {o.v}{o.note ? <span style={{ color: P.faint, marginLeft: 6, fontSize: 11 }}>{o.note}</span> : null}
            </button>;
          })}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.7)", display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, 100%)", height: "100%", background: P.card, borderLeft: `1px solid ${P.cardBorder}`, overflowY: "auto", padding: "28px 28px 60px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 2, color: P.accent, marginBottom: 4 }}>INVESTOR PROFILE</div>
            <h2 style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 20, color: P.ink, margin: 0 }}>Edit your profile</h2>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: P.faint, margin: "4px 0 0" }}>Changes update all stock scores immediately.</p>
          </div>
          <button onClick={onClose} style={{ fontFamily: F.sans, fontSize: 20, color: P.faint, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}>✕</button>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.accent, opacity: 0.7, marginBottom: 8, textTransform: "uppercase" }}>Your name</div>
          <input className="vd-input" value={p.name || ""} onChange={e => set("name", e.target.value)} placeholder="Your name"
            style={{ width: "100%", boxSizing: "border-box", fontFamily: F.sans, fontSize: 16, fontWeight: 600, color: P.ink, background: P.wash, border: `1px solid ${P.dim}`, borderRadius: 6, padding: "10px 14px" }} />
        </div>

        <Field label="Risk tolerance" id="riskTolerance" opts={[{v:"Conservative",note:"Protect what I have"},{v:"Moderate",note:"Balanced"},{v:"Aggressive",note:"Swing for growth"}]} />
        <Field label="Time horizon" id="horizon" opts={[{v:"Short",note:"Under 1yr"},{v:"Medium",note:"1–5 yrs"},{v:"Long",note:"5yrs+"}]} />
        <Field label="Investment budget" id="budget" opts={[{v:"Under $1k"},{v:"$1k – 10k"},{v:"$10k – 50k"},{v:"$50k – 250k"},{v:"$250k +"}]} />
        <Field label="Primary goal" id="goal" opts={[{v:"Preserve capital"},{v:"Income & dividends"},{v:"Balanced growth"},{v:"Aggressive growth"}]} />
        <Field label="Investing style" id="philosophy" opts={[{v:"Value"},{v:"Growth"},{v:"Quality"},{v:"Momentum"},{v:"Dividends / income"},{v:"No strong style"}]} />
        <Field label="Target annual return" id="targetReturn" opts={[{v:"Safety first (~5%)"},{v:"Solid (8–12%)"},{v:"Ambitious (15–20%)"},{v:"Swing big (20%+)"}]} />
        <Field label="Position sizing preference" id="positionConviction" opts={[{v:"Spread across many"},{v:"Balanced mix"},{v:"Few high-conviction bets"}]} />
        <Field label="How hands-on are you?" id="activityLevel" opts={[{v:"Set and forget"},{v:"Check now and then"},{v:"Active"},{v:"Very hands-on"}]} />
        <Field label="Experience level" id="experience" opts={[{v:"New"},{v:"Some"},{v:"Experienced"},{v:"Professional"}]} />
        <Field label="If a stock drops 20%, you…" id="drawdownReaction" opts={[{v:"Sell most of it"},{v:"Trim a little"},{v:"Hold"},{v:"Buy more"}]} />
        <Field label="Income stability" id="incomeStability" opts={[{v:"Stable"},{v:"Somewhat variable"},{v:"Unpredictable"}]} />
        <Field label="Emergency fund" id="emergencyFund" opts={[{v:"Yes, fully"},{v:"Partly"},{v:"No"}]} />
        <Field label="Market preference" id="region" opts={[{v:"United States"},{v:"Europe"},{v:"Global mix"},{v:"No preference"}]} />
        <Field label="Sectors of interest" id="interests" multi opts={["Technology","Energy","Healthcare","Financials","Consumer","Industrials","Materials","Real estate","Utilities","Communications"]} />
        <Field label="Industries to avoid" id="avoid" multi opts={["Tobacco","Weapons","Fossil fuels","Gambling","Alcohol","Adult"]} />

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.accent, opacity: 0.7, marginBottom: 8, textTransform: "uppercase" }}>In your own words (optional)</div>
          <textarea className="vd-input" value={p.intentions || ""} onChange={e => set("intentions", e.target.value)} placeholder="e.g. 'Build a retirement fund I won't touch for 20 years'" rows={3}
            style={{ width: "100%", boxSizing: "border-box", fontFamily: F.sans, fontSize: 14, lineHeight: 1.6, color: P.ink, background: P.wash, border: `1px solid ${P.dim}`, borderRadius: 6, padding: "10px 14px", resize: "vertical" }} />
        </div>

        <button className="vd-eval" onClick={() => onSave(p)} style={{ width: "100%", fontFamily: F.sans, fontWeight: 700, fontSize: 15, color: "#000", background: P.accent, border: "none", borderRadius: 8, padding: "14px", cursor: "pointer" }}>
          Save profile
        </button>
      </div>
    </div>
  );
}

const DOSSIER_TABS = ["Verdict", "Fundamentals", "Technicals", "Risk", "News", "Catalysts", "Your fit"];
const LOADING_MSGS = ["Searching Yahoo Finance & Stockanalysis…", "Pulling live financials and balance sheet…", "Reading price action and technicals…", "Scanning recent news and sentiment…", "Checking analyst ratings and targets…", "Matching everything to your profile…", "Writing the full dossier…"];

// ---------- helpers ----------
function scoreColor(s) {
  if (s == null) return P.faint;
  if (s >= 78) return P.green; if (s >= 60) return "#5C8A3A";
  if (s >= 45) return P.amber; if (s >= 30) return "#C2703A"; return P.red;
}
function grade(s) {
  if (s == null) return "—";
  const t = [[90,"A+"],[85,"A"],[80,"A−"],[75,"B+"],[70,"B"],[65,"B−"],[60,"C+"],[55,"C"],[50,"C−"],[40,"D"]];
  for (const [n, g] of t) if (s >= n) return g; return "F";
}
function parseNum(x) { const n = parseFloat(String(x ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(n) ? null : n; }
function money(n) { if (n == null) return "—"; return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function pct(n) { if (n == null) return "—"; return (n >= 0 ? "+" : "") + n.toFixed(1) + "%"; }
function fmtShares(x) {
  const n = parseNum(x); if (n == null) return "—";
  if (Number.isInteger(n)) return n.toLocaleString();
  // up to 4 sig decimal places, strip trailing zeros
  return parseFloat(n.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// Local persistence: profile + holdings survive page reloads in your browser.
async function kvGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
async function kvSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

function closeJSON(raw) {
  let s = raw, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; } else if (c === '"') inStr = true; }
  if (inStr) s += '"';
  s = s.replace(/[\s,]*$/, "").replace(/"[^"]*"\s*:\s*$/, "").replace(/[\s,]*$/, "");
  const st = []; inStr = false; esc = false;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; } else { if (c === '"') inStr = true; else if (c === "{") st.push("}"); else if (c === "[") st.push("]"); else if (c === "}" || c === "]") st.pop(); } }
  while (st.length) s += st.pop();
  return s;
}
function extractJSON(text) {
  const start = text.indexOf("{"); if (start === -1) return null;
  const end = text.lastIndexOf("}");
  if (end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  try { return JSON.parse(closeJSON(text.slice(start))); } catch { return null; }
}

// Points to Vercel in production/desktop, local proxy in dev
const API_BASE = import.meta.env.VITE_API_URL || "";

// One shared call. maxSearches bounds latency.
async function callClaude(system, user, { maxTokens = 4000, maxSearches = 4 } = {}) {
  const resp = await fetch(`${API_BASE}/api/messages`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: maxTokens, system,
      messages: [{ role: "user", content: user }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }],
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "API error");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const parsed = extractJSON(text);
  if (!parsed) {
    const stopReason = data.stop_reason;
    if (stopReason === "max_tokens") throw new Error("The response was too long and got cut off. Try again — it usually works on the second attempt.");
    console.error("extractJSON failed, raw text:", text.slice(0, 500));
    throw new Error("The response came back unreadable. Try again.");
  }
  return parsed;
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

// ---------- shared UI ----------
function Gauge({ score, size = 168 }) {
  const r = 78, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, score || 0)) / 100, col = scoreColor(score);
  return (
    <svg viewBox="0 0 200 200" style={{ width: size, height: size }}>
      <circle cx="100" cy="100" r={r} fill="none" stroke={P.cardBorder} strokeWidth="8" />
      <circle cx="100" cy="100" r={r} fill="none" stroke={col} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 100 100)" style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.7,.2,1)", filter: `drop-shadow(0 0 6px ${col}88)` }} />
      <text x="100" y="95" textAnchor="middle" style={{ fontFamily: F.mono, fontSize: 48, fontWeight: 600, fill: col }}>{score != null ? Math.round(score) : "—"}</text>
      <text x="100" y="118" textAnchor="middle" style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: 3, fill: P.faint }}>/ 100</text>
    </svg>
  );
}
function MiniBar({ label, score }) {
  const col = scoreColor(score);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1, color: P.faint, textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontFamily: F.mono, fontSize: 12, fontWeight: 600, color: col }}>{score != null ? Math.round(score) : "—"}</span>
      </div>
      <div style={{ height: 3, background: P.dim, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, score || 0))}%`, background: col, borderRadius: 2, transition: "width 1s cubic-bezier(.2,.7,.2,1)", boxShadow: `0 0 6px ${col}88` }} />
      </div>
    </div>
  );
}
function MetricGroup({ group }) {
  if (!group?.items?.length) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: P.accent, marginBottom: 6, opacity: 0.8 }}>{group.title}</div>
      <div style={{ border: `1px solid ${P.cardBorder}`, borderRadius: 6, overflow: "hidden" }}>
        {group.items.map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, padding: "9px 14px", background: i % 2 === 0 ? P.wash : "transparent", borderBottom: i < group.items.length - 1 ? `1px solid ${P.cardBorder}55` : "none" }}>
            <span style={{ fontFamily: F.sans, fontSize: 12.5, color: P.faint, flexShrink: 0 }}>{m.label}</span>
            <span style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 600, color: m.value === "N/A" ? P.faint : P.ink, textAlign: "right" }}>{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function Conclusion({ text }) {
  if (!text) return null;
  return (
    <div style={{ marginTop: 4, background: `${P.accent}08`, border: `1px solid ${P.accent}22`, borderLeft: `3px solid ${P.accent}`, borderRadius: 6, padding: "13px 16px" }}>
      <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: P.accent, marginBottom: 7, opacity: 0.8 }}>Summary</div>
      <p style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.65, color: P.slate, margin: 0 }}>{text}</p>
    </div>
  );
}
function ScoreBadge({ label, score, hint }) {
  const col = scoreColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22, padding: "14px 18px", background: P.wash, border: `1px solid ${P.cardBorder}`, borderRadius: 8 }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", border: `3px solid ${col}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 0 16px ${col}33` }}>
        <span style={{ fontFamily: F.mono, fontSize: 18, fontWeight: 700, color: col }}>{score != null ? Math.round(score) : "—"}</span>
      </div>
      <div>
        <div style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 14, color: P.ink }}>{label}</div>
        <div style={{ fontFamily: F.sans, fontSize: 12, color: P.faint, marginTop: 2 }}>{hint || "Score 0–100"}</div>
      </div>
    </div>
  );
}
function Spinner({ title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 0 8px" }}>
      <div style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: 2, color: P.accent, marginBottom: 10, opacity: 0.8 }}>◈ PROCESSING</div>
      <div style={{ fontFamily: F.sans, fontSize: 16, color: P.slate }}>{title}</div>
      <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1, color: P.faint, marginTop: 8 }}>{sub}</div>
    </div>
  );
}
function ErrorBox({ msg, onRetry, label = "Retry" }) {
  return (
    <div style={{ marginTop: 16, background: `${P.red}11`, border: `1px solid ${P.red}44`, borderLeft: `3px solid ${P.red}`, borderRadius: 4, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <span style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: 0.5, color: P.red, flex: "1 1 220px" }}>⚠ {msg}</span>
      <button className="vd-eval" onClick={onRetry} style={{ fontFamily: F.mono, fontWeight: 600, fontSize: 11, letterSpacing: 1, color: P.red, background: "none", border: `1px solid ${P.red}`, borderRadius: 4, padding: "7px 16px", cursor: "pointer" }}>{label.toUpperCase()}</button>
    </div>
  );
}

// ---------- recommendation card ----------
function RecCard({ pick, rank, onOpen }) {
  const col = scoreColor(pick.fitScore);
  const score = pick.fitScore != null ? Math.round(pick.fitScore) : null;
  return (
    <div onClick={onOpen} className="vd-row" style={{ padding: "14px 20px", borderBottom: `1px solid ${P.cardBorder}`, cursor: "pointer", transition: "background .12s" }}>
      <div style={{ display: "grid", gridTemplateColumns: "24px 36px 1fr auto", alignItems: "center", gap: 14 }}>
        {/* Rank */}
        <span style={{ fontFamily: F.mono, fontSize: 11, color: P.faint, textAlign: "center" }}>{rank}</span>
        {/* Logo */}
        <StockLogo ticker={pick.ticker} size={34} />
        {/* Name + sector + tags */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3, flexWrap: "wrap" }}>
            <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 13, color: P.accent }}>{pick.ticker}</span>
            <span style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 14, color: P.ink }}>{pick.company}</span>
            {pick.sector && <span style={{ fontFamily: F.sans, fontSize: 11, color: P.faint, background: P.dim, borderRadius: 4, padding: "2px 8px" }}>{pick.sector}</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(pick.tags || []).slice(0, 3).map((t, i) => <span key={i} className="vd-tag">{t}</span>)}
          </div>
        </div>
        {/* Score */}
        <div style={{ textAlign: "center", flexShrink: 0, minWidth: 60 }}>
          <div style={{ fontFamily: F.mono, fontSize: 28, fontWeight: 700, color: col, lineHeight: 1, textShadow: `0 0 16px ${col}44` }}>{score ?? "—"}</div>
          <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginTop: 2 }}>fit score</div>
        </div>
      </div>
      {/* Why now + concern + metrics row */}
      <div style={{ marginTop: 10, marginLeft: 74, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 280px" }}>
          {pick.reason && (
            <div style={{ display: "flex", gap: 8, marginBottom: 5 }}>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: P.accent, flexShrink: 0, marginTop: 1 }}>↑</span>
              <span style={{ fontFamily: F.sans, fontSize: 12.5, color: P.slate, lineHeight: 1.5 }}>{pick.reason}</span>
            </div>
          )}
          {pick.concern && (
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: P.amber, flexShrink: 0, marginTop: 1 }}>⚠</span>
              <span style={{ fontFamily: F.sans, fontSize: 12, color: P.faint, lineHeight: 1.5 }}>{pick.concern}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end", flexShrink: 0 }}>
          {(pick.snapshot || []).slice(0, 3).map((m, i) => (
            <span key={i} style={{ fontFamily: F.mono, fontSize: 11, color: P.faint, whiteSpace: "nowrap" }}>{m.label} <b style={{ color: P.ink }}>{m.value}</b></span>
          ))}
          <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: P.accent, marginTop: 2 }}>Full dossier →</span>
        </div>
      </div>
    </div>
  );
}

// ---------- onboarding ----------
function Onboarding({ initial, onDone, onExit }) {
  const [i, setI] = useState(0);
  const [profile, setProfile] = useState(initial || {});
  const step = STEPS[i], last = i === STEPS.length - 1, total = STEPS.length;
  const isExisting = !!(initial && initial.name);
  function setVal(v) { setProfile((p) => ({ ...p, [step.id]: v })); }
  function next() { last ? onDone(profile) : setI(i + 1); }
  function choose(v) { const np = { ...profile, [step.id]: v }; setProfile(np); last ? onDone(np) : setI(i + 1); }
  function toggle(v) { const cur = profile[step.id] || []; setVal(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]); }
  const isText = step.kind === "text" || step.kind === "longtext";
  const canContinue = step.id === "name" ? (profile.name || "").trim().length > 0 : true;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 20px", minHeight: "100%" }}>
      {/* Top bar */}
      <div style={{ paddingTop: 32, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ flex: 1 }}>
          <div style={{ height: 4, background: P.line, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${((i + 1) / total) * 100}%`, background: P.accent, transition: "width .4s ease" }} />
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: P.faint, marginTop: 8 }}>{i + 1} / {total}</div>
        </div>
        {/* Exit button — only show if user already has a profile */}
        {isExisting && onExit && (
          <button onClick={onExit} style={{ marginLeft: 20, fontFamily: F.sans, fontSize: 13, color: P.faint, background: "none", border: `1px solid ${P.dim}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", whiteSpace: "nowrap" }}>
            ✕ Back to app
          </button>
        )}
      </div>
      <div className="vd-reveal" key={step.id} style={{ marginTop: 28 }}>
        <h2 style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 26, lineHeight: 1.2, color: P.ink, margin: 0 }}>{step.title}</h2>
        {step.sub && <p style={{ fontFamily: F.sans, fontSize: 14, color: P.faint, marginTop: 8, lineHeight: 1.55 }}>{step.sub}</p>}
        <div style={{ marginTop: 22 }}>
          {step.kind === "text" && (
            <input autoFocus value={profile.name || ""} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canContinue && next()} placeholder={step.ph} className="vd-input"
              style={{ width: "100%", boxSizing: "border-box", fontFamily: F.sans, fontSize: 22, fontWeight: 500, color: P.ink, background: P.card, border: `1px solid ${P.dim}`, borderRadius: 8, padding: "14px 16px" }} />
          )}
          {step.kind === "longtext" && (
            <textarea autoFocus value={profile.intentions || ""} onChange={(e) => setVal(e.target.value)} placeholder={step.ph} className="vd-input" rows={4}
              style={{ width: "100%", boxSizing: "border-box", fontFamily: F.sans, fontSize: 15, lineHeight: 1.6, color: P.ink, background: P.card, border: `1px solid ${P.dim}`, borderRadius: 8, padding: "14px 16px", resize: "vertical" }} />
          )}
          {step.kind === "choice" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {step.opts.map((o) => {
                const active = profile[step.id] === o.v;
                return (
                  <button key={o.v} onClick={() => choose(o.v)} className="vd-opt" style={{ textAlign: "left", cursor: "pointer", padding: "14px 18px", borderRadius: 8, border: `2px solid ${active ? P.accent : P.dim}`, background: active ? `${P.accent}18` : P.card, transition: "all .15s ease" }}>
                    <span style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 15, color: active ? P.accent : P.ink }}>{o.v}</span>
                    {o.note && <span style={{ fontFamily: F.sans, fontSize: 13, color: P.faint, marginLeft: 10 }}>{o.note}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {step.kind === "multi" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {step.opts.map((o) => {
                const active = (profile[step.id] || []).includes(o);
                return (
                  <button key={o} onClick={() => toggle(o)} className="vd-opt" style={{ cursor: "pointer", padding: "10px 18px", borderRadius: 999, border: `2px solid ${active ? P.accent : P.dim}`, background: active ? `${P.accent}18` : P.card, fontFamily: F.sans, fontWeight: 500, fontSize: 14, color: active ? P.accent : P.ink, transition: "all .15s ease" }}>{o}</button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 28 }}>
          {i > 0 && (
            <button onClick={() => setI(i - 1)} style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 500, color: P.slate, background: "none", border: `1px solid ${P.dim}`, borderRadius: 6, padding: "10px 18px", cursor: "pointer" }}>← Back</button>
          )}
          {(isText || step.kind === "multi") && (
            <button onClick={next} disabled={!canContinue} className="vd-eval" style={{ marginLeft: "auto", fontFamily: F.sans, fontWeight: 600, fontSize: 15, color: "#000", background: P.accent, border: "none", borderRadius: 8, padding: "12px 28px", cursor: canContinue ? "pointer" : "default", opacity: canContinue ? 1 : 0.4 }}>
              {last ? "Finish" : (step.optional || step.kind === "multi") && !(profile[step.id] && profile[step.id].length) ? "Skip" : "Continue →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- dossier ----------
function Results({ result, profile }) {
  const [tab, setTab] = useState("Verdict");
  const r = result, overall = r.overall?.score;
  const act = r.overall?.action;
  const actColor = act === "Strong Buy" || act === "Buy" ? P.green : act === "Sell" || act === "Avoid" ? P.red : act === "Trim" ? P.amber : P.slate;

  const DataSources = () => r.dataSources?.length > 0 ? (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${P.cardBorder}` }}>
      <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.faint, marginBottom: 8, textTransform: "uppercase" }}>Sources</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {r.dataSources.map((s, i) => <span key={i} className="vd-tag">{s}</span>)}
      </div>
    </div>
  ) : null;

  return (
    <div className="vd-reveal" style={{ marginTop: 20 }}>
      {/* ── Header card ── */}
      <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: "10px 10px 0 0", padding: "20px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          {r.ticker && <StockLogo ticker={r.ticker} size={48} />}
          <div style={{ flex: "1 1 200px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {r.ticker && <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 14, color: P.accent, letterSpacing: 1 }}>{r.ticker}</span>}
              <h2 style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 20, color: P.ink, margin: 0 }}>{r.company}</h2>
              {act && <span style={{ padding: "4px 12px", borderRadius: 5, border: `1px solid ${actColor}55`, background: `${actColor}18`, fontFamily: F.sans, fontWeight: 700, fontSize: 12, color: actColor, whiteSpace: "nowrap" }}>{act}</span>}
            </div>
            {r.asOf && <div style={{ fontFamily: F.sans, fontSize: 11, color: P.faint, marginTop: 4 }}>Analysis as of {r.asOf}</div>}
          </div>
          {/* Pillar score pills */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
            {[["Fundamentals", r.pillars?.fundamentals], ["Valuation", r.pillars?.valuation], ["Technicals", r.pillars?.technicals], ["Risk", r.pillars?.risk]].map(([label, score]) => {
              const col = scoreColor(score);
              return (
                <div key={label} style={{ textAlign: "center", padding: "8px 14px", background: P.wash, border: `1px solid ${P.cardBorder}`, borderRadius: 8 }}>
                  <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 17, color: col, lineHeight: 1 }}>{score != null ? Math.round(score) : "—"}</div>
                  <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginTop: 3 }}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${P.cardBorder}`, overflowX: "auto" }}>
          {DOSSIER_TABS.map((t) => {
            const on = t === tab;
            return <button key={t} onClick={() => setTab(t)} style={{ fontFamily: F.sans, fontWeight: on ? 600 : 400, fontSize: 13, whiteSpace: "nowrap", color: on ? P.accent : P.faint, background: "none", border: "none", borderBottom: `2px solid ${on ? P.accent : "transparent"}`, padding: "10px 18px", marginBottom: -1, cursor: "pointer", transition: "color .15s" }}>{t}</button>;
          })}
        </div>
      </div>

      {/* ── Tab body ── */}
      <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderTop: "none", borderRadius: "0 0 10px 10px", padding: "24px" }}>

        {/* VERDICT */}
        {tab === "Verdict" && (
          <div>
            {/* Thesis banner */}
            <div style={{ background: P.wash, border: `1px solid ${actColor}33`, borderLeft: `3px solid ${actColor}`, borderRadius: 8, padding: "16px 20px", marginBottom: 24 }}>
              <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.accent, opacity: 0.8, marginBottom: 8, textTransform: "uppercase" }}>Atlas Verdict</div>
              <p style={{ fontFamily: F.sans, fontSize: 15, lineHeight: 1.6, color: P.ink, margin: 0, fontWeight: 500 }}>{r.overall?.thesis}</p>
            </div>

            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
              {/* Score gauge */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <Gauge score={overall} />
                <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 18, color: scoreColor(overall), letterSpacing: 2 }}>{grade(overall)}</span>
                <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 1, color: P.faint }}>SCORE FOR {(profile.name || "YOU").toUpperCase()}</span>
              </div>

              {/* Right column */}
              <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Pillar bars */}
                <div style={{ border: `1px solid ${P.cardBorder}`, borderRadius: 8, overflow: "hidden" }}>
                  {[["Fundamentals", r.pillars?.fundamentals, "earnings, margins, balance sheet"], ["Valuation", r.pillars?.valuation, "cheapness vs peers & history"], ["Technicals", r.pillars?.technicals, "trend, momentum, chart setup"], ["Risk (safety)", r.pillars?.risk, "higher = safer investment"]].map(([label, score, sub], i, arr) => {
                    const col = scoreColor(score);
                    return (
                      <div key={label} style={{ padding: "11px 16px", background: i % 2 === 0 ? P.wash : "transparent", borderBottom: i < arr.length - 1 ? `1px solid ${P.cardBorder}55` : "none" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <div>
                            <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 500, color: P.ink }}>{label}</span>
                            <span style={{ fontFamily: F.sans, fontSize: 11, color: P.faint, marginLeft: 8 }}>{sub}</span>
                          </div>
                          <span style={{ fontFamily: F.mono, fontSize: 14, fontWeight: 700, color: col, minWidth: 28, textAlign: "right" }}>{score != null ? Math.round(score) : "—"}</span>
                        </div>
                        <div style={{ height: 4, background: P.dim, borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, score || 0))}%`, background: col, borderRadius: 2, transition: "width 1s cubic-bezier(.2,.7,.2,1)" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Sentiment + consensus row */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {r.news?.overallSentiment && (() => {
                    const sc = r.news.sentimentScore || 0;
                    const sCol = sc > 20 ? P.green : sc < -20 ? P.red : P.amber;
                    return (
                      <div style={{ flex: "1 1 160px", padding: "12px 16px", background: P.wash, border: `1px solid ${P.cardBorder}`, borderRadius: 8 }}>
                        <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginBottom: 4 }}>News sentiment</div>
                        <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 15, color: sCol, marginBottom: 6 }}>{r.news.overallSentiment}</div>
                        <div style={{ height: 3, background: P.dim, borderRadius: 2 }}>
                          <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, (sc + 100) / 2))}%`, background: sCol, borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })()}
                  {r.analystConsensus?.rating && (
                    <div style={{ flex: "1 1 200px", padding: "12px 16px", background: P.wash, border: `1px solid ${P.cardBorder}`, borderRadius: 8 }}>
                      <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginBottom: 4 }}>Wall Street consensus</div>
                      <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 15, color: r.analystConsensus.rating.includes("Buy") ? P.green : r.analystConsensus.rating.includes("Sell") ? P.red : P.slate }}>{r.analystConsensus.rating}</span>
                        {r.analystConsensus.targetPrice && <span style={{ fontFamily: F.mono, fontSize: 13, color: P.ink }}>PT {r.analystConsensus.targetPrice}</span>}
                        {r.analystConsensus.upside && <span style={{ fontFamily: F.mono, fontSize: 13, color: P.green }}>{r.analystConsensus.upside} upside</span>}
                      </div>
                      {r.analystConsensus.numAnalysts > 0 && <div style={{ fontFamily: F.sans, fontSize: 11, color: P.faint, marginTop: 4 }}>{r.analystConsensus.numAnalysts} analysts · {r.analystConsensus.recentRevisions}</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FUNDAMENTALS */}
        {tab === "Fundamentals" && (
          <div>
            <ScoreBadge label="Fundamentals" score={r.pillars?.fundamentals} hint="Quality of the business — earnings, margins, balance sheet strength" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
              {(r.fundamentals?.groups || []).map((g, i) => <MetricGroup key={i} group={g} />)}
            </div>
            <Conclusion text={r.fundamentals?.conclusion} />
            <DataSources />
          </div>
        )}

        {/* TECHNICALS */}
        {tab === "Technicals" && (
          <div>
            <ScoreBadge label="Technicals" score={r.pillars?.technicals} hint="Price trend, momentum, and chart setup right now" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
              {(r.technicals?.groups || []).map((g, i) => <MetricGroup key={i} group={g} />)}
            </div>
            <Conclusion text={r.technicals?.conclusion} />
            <DataSources />
          </div>
        )}

        {/* RISK */}
        {tab === "Risk" && (
          <div>
            <ScoreBadge label="Risk Safety Score" score={r.pillars?.risk} hint="Higher = safer. Accounts for debt, volatility, moat, and business risk." />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
              {(r.risk?.groups || []).map((g, i) => <MetricGroup key={i} group={g} />)}
            </div>
            <Conclusion text={r.risk?.conclusion} />
            <DataSources />
          </div>
        )}

        {/* NEWS */}
        {tab === "News" && (() => {
          const n = r.news;
          if (!n) return <div style={{ fontFamily: F.sans, fontSize: 13, color: P.faint }}>No news data available.</div>;
          const sc = n.sentimentScore || 0;
          const sCol = sc > 20 ? P.green : sc < -20 ? P.red : P.amber;
          const sentimentMap = { Positive: P.green, Negative: P.red, Neutral: P.faint };
          return (
            <div>
              {/* Sentiment bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "16px 20px", background: P.wash, border: `1px solid ${P.cardBorder}`, borderRadius: 8, marginBottom: 20, flexWrap: "wrap" }}>
                <div style={{ flexShrink: 0 }}>
                  <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginBottom: 3 }}>Overall Sentiment</div>
                  <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 20, color: sCol }}>{n.overallSentiment}</div>
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontFamily: F.sans, fontSize: 10, color: P.red }}>Bearish −100</span>
                    <span style={{ fontFamily: F.mono, fontSize: 12, fontWeight: 600, color: sCol }}>{sc > 0 ? "+" : ""}{sc}</span>
                    <span style={{ fontFamily: F.sans, fontSize: 10, color: P.green }}>+100 Bullish</span>
                  </div>
                  <div style={{ height: 6, background: P.dim, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, (sc + 100) / 2))}%`, background: sCol, borderRadius: 3, transition: "width 1s ease" }} />
                  </div>
                </div>
                {n.summary && <div style={{ flex: "2 1 300px", fontFamily: F.sans, fontSize: 13, lineHeight: 1.55, color: P.slate, borderLeft: `2px solid ${sCol}`, paddingLeft: 14 }}>{n.summary}</div>}
              </div>

              {/* News items */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(n.items || []).map((item, i) => {
                  const col = sentimentMap[item.sentiment] || P.faint;
                  const hasUrl = item.url && item.url.startsWith("http");
                  return (
                    <div key={i} style={{ padding: "14px 18px", background: P.wash, border: `1px solid ${P.cardBorder}`, borderLeft: `3px solid ${col}`, borderRadius: 8 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                          {hasUrl
                            ? <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 14, color: P.ink, lineHeight: 1.45, textDecoration: "none", borderBottom: `1px solid ${P.faint}55` }}
                                onMouseEnter={e => e.currentTarget.style.color = P.accent}
                                onMouseLeave={e => e.currentTarget.style.color = P.ink}>
                                {item.headline} ↗
                              </a>
                            : <span style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 14, color: P.ink, lineHeight: 1.45 }}>{item.headline}</span>}
                        </div>
                        <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: col, whiteSpace: "nowrap", flexShrink: 0 }}>{item.sentiment}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: item.impact ? 10 : 0 }}>
                        <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: P.faint }}>{item.source}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 10, color: P.faint }}>·</span>
                        <span style={{ fontFamily: F.mono, fontSize: 10, color: P.faint }}>{item.date}</span>
                      </div>
                      {item.impact && <div style={{ fontFamily: F.sans, fontSize: 12.5, color: P.slate, lineHeight: 1.55, borderTop: `1px solid ${P.dim}`, paddingTop: 10 }}>{item.impact}</div>}
                    </div>
                  );
                })}
              </div>
              <DataSources />
            </div>
          );
        })()}

        {/* CATALYSTS */}
        {tab === "Catalysts" && (
          <div>
            {r.analystConsensus?.rating && (
              <div style={{ display: "flex", gap: 0, marginBottom: 24, border: `1px solid ${P.cardBorder}`, borderRadius: 8, overflow: "hidden" }}>
                {[
                  ["Consensus", r.analystConsensus.rating, r.analystConsensus.rating?.includes("Buy") ? P.green : r.analystConsensus.rating?.includes("Sell") ? P.red : P.slate],
                  ["Price Target", r.analystConsensus.targetPrice || "—", P.ink],
                  ["Upside", r.analystConsensus.upside || "—", P.green],
                  ["High / Low", r.analystConsensus.highTarget && r.analystConsensus.lowTarget ? `${r.analystConsensus.highTarget} / ${r.analystConsensus.lowTarget}` : "—", P.ink],
                  ["Analysts", r.analystConsensus.numAnalysts || "—", P.ink],
                ].map(([label, val, col], i) => (
                  <div key={label} style={{ flex: 1, padding: "14px 16px", background: i % 2 === 0 ? P.wash : "transparent", borderRight: i < 4 ? `1px solid ${P.cardBorder}` : "none" }}>
                    <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginBottom: 5 }}>{label}</div>
                    <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 15, color: col }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
            {r.analystConsensus?.recentRevisions && (
              <div style={{ marginBottom: 20, padding: "10px 16px", background: P.wash, border: `1px solid ${P.cardBorder}`, borderRadius: 6, fontFamily: F.sans, fontSize: 12.5, color: P.slate }}>
                <span style={{ color: P.faint, fontFamily: F.mono, fontSize: 9, letterSpacing: 1, marginRight: 8, textTransform: "uppercase" }}>Recent revisions</span>{r.analystConsensus.recentRevisions}
              </div>
            )}
            <div style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 14, color: P.ink, marginBottom: 12 }}>Upcoming Catalysts</div>
            {(r.catalysts || []).length === 0 && <div style={{ fontFamily: F.sans, fontSize: 13, color: P.faint }}>No catalyst data available.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(r.catalysts || []).map((c, i) => {
                const dirCol = c.direction === "Bullish" ? P.green : c.direction === "Bearish" ? P.red : P.amber;
                return (
                  <div key={i} style={{ display: "flex", gap: 0, border: `1px solid ${P.cardBorder}`, borderLeft: `3px solid ${dirCol}`, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ padding: "14px 16px", flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 13.5, color: P.ink }}>{c.label}</span>
                        {c.timeframe && <span style={{ fontFamily: F.mono, fontSize: 10, color: P.faint, background: P.wash, border: `1px solid ${P.dim}`, borderRadius: 4, padding: "2px 8px" }}>{c.timeframe}</span>}
                      </div>
                      <div style={{ fontFamily: F.sans, fontSize: 13, color: P.slate, lineHeight: 1.55 }}>{c.description}</div>
                    </div>
                    <div style={{ padding: "14px 16px", background: P.wash, borderLeft: `1px solid ${P.cardBorder}`, display: "flex", alignItems: "center", flexShrink: 0 }}>
                      <span style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: dirCol }}>{c.direction}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* YOUR FIT */}
        {tab === "Your fit" && (() => {
          const fitAct = r.fit?.action;
          const fitActCol = fitAct?.includes("Buy") ? P.green : fitAct?.includes("Sell") || fitAct?.includes("Avoid") ? P.red : fitAct?.includes("Trim") ? P.amber : P.accent;
          return (
            <div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <Gauge score={r.fit?.score} size={120} />
                  <span style={{ fontFamily: F.sans, fontSize: 11, color: P.faint }}>Fit score for {profile.name || "you"}</span>
                </div>
                <div style={{ flex: "1 1 280px" }}>
                  <p style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 1.65, color: P.slate, margin: "0 0 14px" }}>{r.fit?.summary}</p>
                  {fitAct && <div style={{ display: "inline-block", padding: "9px 20px", borderRadius: 7, border: `1px solid ${fitActCol}55`, background: `${fitActCol}18`, fontFamily: F.sans, fontWeight: 700, fontSize: 14, color: fitActCol }}>{fitAct}</div>}
                </div>
              </div>

              {r.fit?.positionSizing && (
                <div style={{ marginBottom: 16, background: `${P.accent}08`, border: `1px solid ${P.accent}22`, borderLeft: `3px solid ${P.accent}`, borderRadius: 8, padding: "13px 18px" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.accent, opacity: 0.8, marginBottom: 6, textTransform: "uppercase" }}>Position Sizing</div>
                  <p style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.6, color: P.slate, margin: 0 }}>{r.fit.positionSizing}</p>
                </div>
              )}

              {Array.isArray(r.fit?.watchouts) && r.fit.watchouts.length > 0 && (
                <div>
                  <div style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 13, color: P.amber, marginBottom: 10 }}>Watchouts for {profile.name || "you"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {r.fit.watchouts.map((w, i) => (
                      <div key={i} style={{ display: "flex", gap: 12, fontFamily: F.sans, fontSize: 13.5, color: P.slate, padding: "11px 16px", background: `${P.amber}09`, border: `1px solid ${P.amber}30`, borderRadius: 7, lineHeight: 1.55 }}>
                        <span style={{ color: P.amber, fontFamily: F.mono, flexShrink: 0, marginTop: 1 }}>!</span>{w}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <DataSources />
            </div>
          );
        })()}
      </div>

      {/* Flags footer */}
      {Array.isArray(r.flags) && r.flags.length > 0 && (
        <div style={{ marginTop: 12, padding: "12px 18px", background: P.wash, border: `1px solid ${P.cardBorder}`, borderRadius: 8 }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.faint, marginBottom: 8, textTransform: "uppercase" }}>Caveats & Limitations</div>
          {r.flags.map((f, i) => <div key={i} style={{ fontFamily: F.sans, fontSize: 12, color: P.faint, padding: "3px 0", lineHeight: 1.5 }}>· {f}</div>)}
        </div>
      )}
    </div>
  );
}

// ---------- portfolio ----------
function HoldingRow({ h, costUSD, livePrice, review, onOpen, onRemove }) {
  const curPrice = livePrice?.price ?? (review ? parseNum(review.currentPrice) : null);
  const cost = costUSD ?? parseNum(h.cost);
  const sh = parseNum(h.shares);
  const foreignCur = h.currency && h.currency !== "USD" ? h.currency : null;
  const pl = curPrice != null && cost != null ? (curPrice - cost) * sh : null;
  const plPct = curPrice != null && cost ? ((curPrice - cost) / cost) * 100 : null;
  const value = curPrice != null && sh != null ? curPrice * sh : null;
  const act = review?.action;
  const pillonClass = act === "Buy more" || act === "Add" ? "vd-pill-buy" : act === "Sell" ? "vd-pill-sell" : act === "Trim" ? "vd-pill-trim" : "vd-pill-hold";
  const name = livePrice?.name ?? review?.company ?? "";
  const isUp = plPct != null && plPct >= 0;
  return (
    <div className="vd-row" style={{ borderBottom: `1px solid ${P.cardBorder}22`, transition: "background .12s" }}>
      <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 95px 80px 90px 105px 120px 90px 36px", alignItems: "center", gap: 0, padding: "0 4px" }}>
        {/* Logo + ticker */}
        <div style={{ padding: "14px 0 14px 12px" }}><StockLogo ticker={h.ticker} size={30} /></div>
        <button onClick={onOpen} style={{ textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "14px 12px 14px 10px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
            <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 13, color: P.accent }}>{h.ticker}</span>
            {foreignCur && <span style={{ fontFamily: F.mono, fontSize: 8, fontWeight: 600, color: P.amber, background: `${P.amber}15`, border: `1px solid ${P.amber}40`, borderRadius: 3, padding: "1px 4px" }}>{foreignCur}</span>}
          </div>
          {name && <div style={{ fontFamily: F.sans, fontSize: 11, color: P.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>{name}</div>}
        </button>
        {/* Price */}
        <div style={{ padding: "14px 8px", textAlign: "right" }}>
          {curPrice != null
            ? <span style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 600, color: P.ink }}>{money(curPrice)}</span>
            : <span style={{ fontFamily: F.mono, fontSize: 11, color: P.faint }}>—</span>}
        </div>
        {/* Qty */}
        <div style={{ padding: "14px 8px", textAlign: "right" }}>
          <span style={{ fontFamily: F.mono, fontSize: 12, color: P.slate }}>{fmtShares(h.shares)}</span>
        </div>
        {/* Avg cost */}
        <div style={{ padding: "14px 8px", textAlign: "right" }}>
          <span style={{ fontFamily: F.mono, fontSize: 12, color: P.slate }}>{money(cost)}</span>
          {foreignCur && <div style={{ fontFamily: F.mono, fontSize: 9, color: P.faint }}>{h.currency} {parseNum(h.cost)?.toFixed(2)}</div>}
        </div>
        {/* Market value */}
        <div style={{ padding: "14px 8px", textAlign: "right" }}>
          {value != null
            ? <span style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 600, color: P.ink }}>{money(value)}</span>
            : <span style={{ fontFamily: F.mono, fontSize: 11, color: P.faint }}>—</span>}
        </div>
        {/* P&L */}
        <div style={{ padding: "14px 8px", textAlign: "right" }}>
          {pl != null ? (
            <>
              <div style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 600, color: isUp ? P.green : P.red }}>{isUp ? "+" : ""}{money(pl)}</div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: isUp ? P.green : P.red, opacity: 0.8 }}>{isUp ? "+" : ""}{plPct.toFixed(2)}%</div>
            </>
          ) : <span style={{ fontFamily: F.mono, fontSize: 11, color: P.faint }}>—</span>}
        </div>
        {/* Call */}
        <div style={{ padding: "14px 8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {act
            ? <span className={pillonClass} style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 10, borderRadius: 4, padding: "3px 9px", whiteSpace: "nowrap" }}>{act}</span>
            : review?.scoreForYou != null
              ? <span style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 700, color: scoreColor(review.scoreForYou) }}>{Math.round(review.scoreForYou)}</span>
              : null}
        </div>
        {/* Remove */}
        <div style={{ padding: "14px 6px 14px 0", textAlign: "center" }}>
          <button onClick={onRemove} title="Remove" style={{ fontSize: 14, color: P.faint, background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "2px 4px", opacity: 0.5 }}>×</button>
        </div>
      </div>
      {review?.rationale && <div style={{ fontFamily: F.sans, fontSize: 11.5, lineHeight: 1.5, color: P.slate, padding: "0 16px 12px 64px", opacity: 0.85 }}>{review.rationale}</div>}
    </div>
  );
}

// ---------- help chat ----------
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
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState([
    { role: "assistant", text: "Hi! I'm the Atlas assistant. Ask me anything about the app or finance — P/E ratios, how the backtester works, what CAGR means, anything." }
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const bottomRef = React.useRef(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 80); }
  }, [open]);
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const q = input.trim(); if (!q || loading) return;
    const next = [...messages, { role: "user", text: q }];
    setMessages(next); setInput(""); setLoading(true);
    try {
      const history = next.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
      const resp = await fetch(`${API_BASE}/api/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 600, system: HELP_SYSTEM,
          messages: history,
        }),
      });
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
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{ position: "fixed", bottom: 28, right: 28, zIndex: 1000, width: 48, height: 48, borderRadius: "50%", background: open ? P.dim : P.accent, border: `2px solid ${open ? P.faint : P.accent}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 24px ${P.accent}44`, transition: "all .2s" }}
        title="Atlas Help"
      >
        {open
          ? <span style={{ color: P.slate, fontSize: 18, lineHeight: 1 }}>✕</span>
          : <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="10" stroke="#000" strokeWidth="1.5"/><path d="M8.5 8.5C8.5 7.12 9.62 6 11 6s2.5 1.12 2.5 2.5c0 1.5-1.5 2-1.5 3.5" stroke="#000" strokeWidth="1.8" strokeLinecap="round"/><circle cx="11" cy="16" r="1" fill="#000"/></svg>}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{ position: "fixed", bottom: 86, right: 28, zIndex: 999, width: 360, maxHeight: 520, display: "flex", flexDirection: "column", background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 12, boxShadow: "0 12px 48px #000c", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${P.cardBorder}`, display: "flex", alignItems: "center", gap: 10, background: P.wash }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: P.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="10" stroke="#000" strokeWidth="1.5"/><path d="M8.5 8.5C8.5 7.12 9.62 6 11 6s2.5 1.12 2.5 2.5c0 1.5-1.5 2-1.5 3.5" stroke="#000" strokeWidth="1.8" strokeLinecap="round"/><circle cx="11" cy="16" r="1" fill="#000"/></svg>
            </div>
            <div>
              <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 13, color: P.ink }}>Atlas Assistant</div>
              <div style={{ fontFamily: F.sans, fontSize: 11, color: P.faint }}>Ask anything about the app or finance</div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "85%", padding: "9px 13px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", background: m.role === "user" ? P.accent : P.wash, border: m.role === "user" ? "none" : `1px solid ${P.dim}` }}>
                  <span style={{ fontFamily: F.sans, fontSize: 13, lineHeight: 1.55, color: m.role === "user" ? "#000" : P.ink, whiteSpace: "pre-wrap" }}>{m.text}</span>
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ padding: "9px 13px", borderRadius: "12px 12px 12px 2px", background: P.wash, border: `1px solid ${P.dim}` }}>
                  <span style={{ fontFamily: F.mono, fontSize: 12, color: P.faint, letterSpacing: 2 }}>···</span>
                </div>
              </div>
            )}
            {/* Quick suggestions — show only at start */}
            {messages.length === 1 && !loading && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingBottom: 4 }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50); }}
                    style={{ fontFamily: F.sans, fontSize: 11, color: P.slate, background: "none", border: `1px solid ${P.dim}`, borderRadius: 20, padding: "4px 12px", cursor: "pointer", transition: "border-color .15s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = P.accent}
                    onMouseLeave={e => e.currentTarget.style.borderColor = P.dim}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${P.cardBorder}`, display: "flex", gap: 8, background: P.wash }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask a question…"
              style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: P.ink, background: P.card, border: `1.5px solid ${P.dim}`, borderRadius: 8, padding: "9px 12px", outline: "none" }}
            />
            <button onClick={send} disabled={!input.trim() || loading}
              style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 13, color: "#000", background: (!input.trim() || loading) ? P.dim : P.accent, border: "none", borderRadius: 8, padding: "9px 16px", cursor: (!input.trim() || loading) ? "default" : "pointer", transition: "background .15s", flexShrink: 0 }}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- sidebar ----------
function Sidebar({ nav, setNav, profile, onEdit, holdingsCount, onSignOut }) {
  const items = [
    ["discover", "Discover"],
    ["portfolio", `Portfolio${holdingsCount ? ` (${holdingsCount})` : ""}`],
    ["research", "Research"],
    ["backtest", "Backtest"],
  ];
  const icons = { discover: "🎯", portfolio: "💼", research: "🔍", backtest: "📊" };

  return (
    <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 240, background: P.header, borderRight: `1px solid ${P.cardBorder}`, display: "flex", flexDirection: "column", zIndex: 100 }}>
      {/* Logo — click goes home */}
      <button onClick={() => setNav("home")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "22px 20px 20px", background: "none", border: "none", borderBottom: `1px solid ${P.cardBorder}`, cursor: "pointer", width: "100%" }}>
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <rect width="30" height="30" rx="8" fill={P.accent}/>
          <path d="M15 7L22 22H17.5L15.8 18H14.2L12.5 22H8L15 7Z" fill="#000" opacity="0.9"/>
          <line x1="11.5" y1="16" x2="18.5" y2="16" stroke="#000" strokeWidth="1.8" strokeLinecap="round" opacity="0.9"/>
        </svg>
        <span style={{ fontFamily: F.sans, fontSize: 17, fontWeight: 700, letterSpacing: 0.2, color: P.ink }}>Atlas</span>
      </button>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map(([k, label]) => {
          const on = nav === k;
          return (
            <button key={k} onClick={() => setNav(k)} style={{
              width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12,
              padding: "12px 14px", borderRadius: 9,
              background: on ? `${P.accent}15` : "transparent",
              border: `1px solid ${on ? P.accent + "44" : "transparent"}`,
              color: on ? P.accent : P.slate,
              fontFamily: F.sans, fontSize: 14, fontWeight: on ? 600 : 400,
              cursor: "pointer", transition: "all .15s",
            }}
            onMouseEnter={e => { if (!on) { e.currentTarget.style.background = P.dim; e.currentTarget.style.color = P.ink; } }}
            onMouseLeave={e => { if (!on) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = P.slate; } }}
            >
              <span style={{ fontSize: 17, lineHeight: 1 }}>{icons[k]}</span>
              <span style={{ flex: 1 }}>{label}</span>
              {on && <div style={{ width: 4, height: 18, background: P.accent, borderRadius: 2, flexShrink: 0 }} />}
            </button>
          );
        })}
      </nav>

      {/* User at bottom */}
      <div style={{ padding: "12px 10px", borderTop: `1px solid ${P.cardBorder}` }}>
        <button onClick={onEdit} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: "none", border: "none", cursor: "pointer", marginBottom: 6 }}
          onMouseEnter={e => e.currentTarget.style.background = P.dim}
          onMouseLeave={e => e.currentTarget.style.background = "none"}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: P.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: "#000" }}>{(profile.name || "U")[0].toUpperCase()}</span>
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: P.ink, lineHeight: 1.2 }}>{profile.name || "Profile"}</div>
            <div style={{ fontFamily: F.sans, fontSize: 11, color: P.faint }}>Edit profile</div>
          </div>
        </button>
        {onSignOut && (
          <button onClick={onSignOut} style={{ width: "100%", fontFamily: F.sans, fontSize: 12, color: P.faint, background: "none", border: `1px solid ${P.dim}`, borderRadius: 7, padding: "8px 12px", cursor: "pointer" }}>Sign out</button>
        )}
      </div>
    </div>
  );
}

// ============================================================
//  ROOT
// ============================================================
export default function VerdictApp() {
  const [phase, setPhase] = useState("onboarding");
  const [profile, setProfile] = useState(null);
  const [nav, setNav] = useState("home");
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(undefined); // undefined = loading

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
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const timerRef = useRef(null);

  // discover
  const [universe, setUniverse] = useState("Global all-markets");
  const [recs, setRecs] = useState(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState(null);

  // portfolio
  const [holdings, setHoldings] = useState([]);
  const [spareCash, setSpareCash] = useState("");
  const [review, setReview] = useState(null); // {asOf, holdings:[...], portfolio:{...}}
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [nt, setNt] = useState(""); const [ns, setNs] = useState(""); const [nc, setNc] = useState(""); const [ncur, setNcur] = useState("USD");
  const [fxRates, setFxRates] = useState({}); // rates relative to USD: { EUR: 0.92, GBP: 0.79, ... }
  const [livePrices, setLivePrices] = useState({}); // { AAPL: { price, currency, name } }
  const [livePricesLoading, setLivePricesLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // parsed rows from spreadsheet upload
  const importRef = useRef(null);
  const [portfolioTab, setPortfolioTab] = useState("holdings");
  const [newsItems, setNewsItems] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await kvGet("atlas_profile");
        const h = await kvGet("atlas_holdings");
        const cash = await kvGet("atlas_spare_cash");
        if (Array.isArray(h)) setHoldings(h);
        if (cash != null) setSpareCash(String(cash));
        if (p && p.name) { setProfile(p); setPhase("app"); setAutoDiscover(true); }
      } catch {}
    })();
    // Fetch FX rates once (Frankfurter is free, no key needed)
    fetch("https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,CAD,AUD,CHF,JPY,HKD,SGD")
      .then(r => r.json()).then(d => { if (d.rates) setFxRates(d.rates); }).catch(() => {});
  }, []);

  // Convert an amount from a foreign currency to USD
  function toUSD(amount, currency) {
    if (!currency || currency === "USD") return amount;
    const rate = fxRates[currency]; // units of foreign currency per 1 USD
    return rate ? amount / rate : amount;
  }

  // Auto-fetch live prices whenever holdings change
  useEffect(() => {
    if (!holdings.length) { setLivePrices({}); return; }
    setLivePricesLoading(true);
    const key = holdings.map(h => h.ticker).join(",");
    Promise.all(holdings.map(async h => {
      try {
        const r = await fetch(`/api/history?ticker=${encodeURIComponent(h.ticker)}&range=5d&interval=1d`);
        const d = await r.json();
        if (d.prices?.length) {
          const latest = d.prices[d.prices.length - 1];
          return [h.ticker, { price: latest.close, currency: d.currency, name: d.name }];
        }
      } catch (_) {}
      return [h.ticker, null];
    })).then(results => {
      const map = {};
      for (const [t, v] of results) if (v) map[t] = v;
      setLivePrices(map);
      setLivePricesLoading(false);
    });
  }, [holdings.map(h => h.ticker).join(",")]);

  const [autoDiscover, setAutoDiscover] = useState(false);
  useEffect(() => {
    if (autoDiscover && profile) { setAutoDiscover(false); discover(); }
  }, [autoDiscover, profile]);

  function finishOnboarding(p) { setProfile(p); kvSet("atlas_profile", p); setPhase("app"); setAutoDiscover(true); }
  function saveProfile(p) { setProfile(p); kvSet("atlas_profile", p); setShowProfileEditor(false); setRecs(null); setReview(null); }
  function updateSpareCash(v) { setSpareCash(v); kvSet("atlas_spare_cash", v); }
  function cycleMessages() { let k = 0; setMsgIdx(0); timerRef.current = setInterval(() => { k = (k + 1) % LOADING_MSGS.length; setMsgIdx(k); }, 2400); }
  function persistHoldings(h) { setHoldings(h); kvSet("atlas_holdings", h); }

  // ---- deep dossier ----
  async function evaluate(symbolArg) {
    const name = ((typeof symbolArg === "string" && symbolArg) ? symbolArg : query).trim();
    if (!name || loading) return;
    setNav("research"); setLoading(true); setError(null); setResult(null); cycleMessages();
    const sys = `You are a brutally honest, no-nonsense senior equity research analyst. Your job is to produce a complete, institutional-grade stock dossier using REAL, CURRENT data from live web searches. You have NO opinion of your own until the data speaks — if a stock is bad, say it is bad. Do not sugarcoat. Do not be a cheerleader. Scores below 40 are common when warranted.

SEARCH STRATEGY — maximum 4 searches, make each one count:
1. "[TICKER] stock financials price PE ratio revenue margins balance sheet 2025 2026" — Yahoo Finance or Stockanalysis — get price, valuation, fundamentals, technicals in one go
2. "[TICKER] stock news analyst rating price target 2025 2026" — get recent news AND analyst consensus together
3. Only if data is missing: one targeted follow-up search

Return ONE valid JSON object, nothing else. No markdown fences. No prose outside the JSON. If no real public company matches, return {"error":"not_found"}.

═══════════════════════════════════════
INVESTOR PROFILE — every score must reflect THIS investor, not a generic one:
${profileText(profile)}

CURRENT PORTFOLIO — assess overlap, concentration, correlation:
${holdingsText(holdings)}
SPARE CASH AVAILABLE TO DEPLOY: ${spareCash ? `$${spareCash}` : "not specified"}
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

6. NEWS & SENTIMENT (from actual recent searches — this is critical):
   - overallSentiment: "Very Bullish" / "Bullish" / "Neutral" / "Bearish" / "Very Bearish"
   - sentimentScore: -100 to +100 (negative = bad news dominating)
   - summary: 2 sentences on what the news flow says about this stock RIGHT NOW
   - items: 5–8 recent news items, each with:
     * headline: actual headline text (not paraphrased)
     * url: direct link to the article (full https URL — required, search for the real URL)
     * source: publication name (Reuters, Bloomberg, WSJ, Yahoo Finance, etc.)
     * date: approximate date (e.g. "Jun 2026", "May 2026")
     * sentiment: "Positive" / "Negative" / "Neutral"
     * impact: one sentence on why this matters for the stock

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
- Use "N/A" only when genuinely unavailable after searching
- JSON must be complete and syntactically valid — always close every bracket and brace
- If data is unavailable for any metric use "N/A" — never omit a field or leave JSON incomplete
- For small/obscure companies with limited data, still return the full schema with "N/A" values
- action field in overall must be one of: "Strong Buy", "Buy", "Hold", "Trim", "Sell", "Avoid"

FULL JSON SCHEMA:
{"company":"","ticker":"","asOf":"","pillars":{"fundamentals":0,"valuation":0,"technicals":0,"risk":0},"overall":{"score":0,"action":"","thesis":""},"fundamentals":{"groups":[{"title":"","items":[{"label":"","value":""}]}],"conclusion":""},"technicals":{"groups":[{"title":"","items":[{"label":"","value":""}]}],"conclusion":""},"risk":{"groups":[{"title":"","items":[{"label":"","value":""}]}],"conclusion":""},"news":{"overallSentiment":"","sentimentScore":0,"summary":"","items":[{"headline":"","url":"","source":"","date":"","sentiment":"","impact":""}]},"fit":{"score":0,"summary":"","action":"","positionSizing":"","watchouts":[""]},"catalysts":[{"label":"","description":"","timeframe":"","direction":""}],"analystConsensus":{"rating":"","targetPrice":"","upside":"","numAnalysts":0,"highTarget":"","lowTarget":"","recentRevisions":""},"dataSources":[""],"flags":[""]}`;
    try {
      const parsed = await callClaude(sys, `Evaluate: ${name}`, { maxTokens: 10000, maxSearches: 4 });
      if (parsed.error === "not_found") throw new Error(`Couldn't find a public company matching "${name}". Try a ticker or exact name.`);
      if (!parsed.pillars && !parsed.fundamentals) throw new Error("The dossier came back incomplete. Tap Retry.");
      setResult(parsed);
    } catch (err) { setError(err.message || "Something went wrong."); }
    finally { setLoading(false); if (timerRef.current) clearInterval(timerRef.current); }
  }
  function openTicker(t) { setQuery(t); evaluate(t); }

  // ---- discovery ----
  async function discover() {
    if (recsLoading) return;
    setRecsLoading(true); setRecsError(null); setRecs(null);
    const sys = `You are a brutally honest equity research analyst. Your only job is to find the BEST stocks for this specific investor RIGHT NOW. Use web_search to get current prices, valuations, and recent news. Return ONE JSON object only — no prose, no fences.

INVESTOR PROFILE:
${profileText(profile)}

CURRENT HOLDINGS:
${holdingsText(holdings)}

SPARE CASH TO DEPLOY: ${spareCash ? `$${spareCash}` : "not specified"}

═══ TASK ═══
Find the 6 best stock opportunities for this investor right now. Be decisive — use your training knowledge plus 1–2 targeted searches to verify current prices or recent catalysts.

Consider every publicly listed equity worldwide. Skip tickers they already own. Non-US tickers must include exchange prefix (e.g. "SHEL.L", "9988.HK", "SAP.DE"). No OTC/pink sheets.

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
      const parsed = await callClaude(sys, "Find the best stocks for me right now.", { maxTokens: 2000, maxSearches: 2 });
      if (!Array.isArray(parsed.picks)) throw new Error("Couldn't build the shortlist. Tap Scan again.");
      parsed.picks.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));
      setRecs(parsed);
    } catch (err) { setRecsError(err.message || "Something went wrong."); }
    finally { setRecsLoading(false); }
  }

  // ---- portfolio news ----
  async function fetchPortfolioNews() {
    if (newsLoading || !holdings.length) return;
    setNewsLoading(true); setNewsError(null);
    const tickers = holdings.map(h => h.ticker).join(", ");
    const sys = `You are a financial news analyst. The user holds these stocks: ${tickers}.
Search for the latest news (last 7 days) relevant to these holdings. Include:
- Company-specific news for each holding (earnings, product launches, management changes, analyst upgrades/downgrades, lawsuits, partnerships)
- Broader macro/sector news that materially affects these holdings

Return a JSON array. Each item:
{
  "ticker": "AAPL",          // which holding it's most relevant to, or "MACRO" for market-wide news
  "headline": "...",
  "source": "Reuters",       // publication name
  "date": "2026-06-26",      // approximate date, YYYY-MM-DD
  "summary": "...",          // 1-2 sentence plain English summary
  "url": "https://...",      // article URL if found, else ""
  "sentiment": "bullish"     // "bullish", "bearish", or "neutral" for the holding
}

Return ONLY a JSON object with a single "news" key containing the array, nothing else:
{"news": [...]}
Aim for 2-3 items per holding plus 2-3 macro items, max 20 total.`;
    try {
      const parsed = await callClaude(sys, `Find latest news for portfolio: ${tickers}`, { maxTokens: 3000, maxSearches: 4 });
      // callClaude returns parsed JSON — but news is an array not an object
      setNewsItems(parsed?.news || []);
    } catch (e) {
      setNewsError(e.message || "Could not fetch news.");
    } finally {
      setNewsLoading(false);
    }
  }

  // ---- portfolio review ----
  async function analyzePortfolio() {
    if (reviewLoading || !holdings.length) return;
    setReviewLoading(true); setReviewError(null);
    try {
      // Fetch live prices from Yahoo Finance for every holding in parallel
      const priceResults = await Promise.all(
        holdings.map(async (h) => {
          try {
            const r = await fetch(`/api/history?ticker=${encodeURIComponent(h.ticker)}&range=5d&interval=1d`);
            const d = await r.json();
            const prices = d.prices;
            if (prices && prices.length) {
              const latest = prices[prices.length - 1];
              return { ticker: h.ticker, price: latest.close, currency: d.currency, name: d.name };
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
          return `${h.ticker} (${p.name || h.ticker}): ${h.shares} shares @ ${costLabel} avg cost · current price ${p.currency || "USD"} ${p.price.toFixed(2)}`;
        }
        return `${h.ticker}: ${h.shares} shares @ ${costLabel} avg cost · current price unavailable`;
      }).join("\n");

      const sys = `You are a portfolio analyst giving brutally honest, hands-on advice. Current prices are already provided below — do NOT search for prices, they are live and accurate. Return ONE JSON object only.

INVESTOR PROFILE:
${profileText(profile)}

CURRENT HOLDINGS with live prices:
${holdingsWithPrices}

SPARE CASH AVAILABLE TO DEPLOY: ${spareCash ? `$${spareCash}` : "not specified"}

For EACH holding decide ONE action: "Buy more","Add","Hold","Trim","Sell". Use the exact currentPrice provided. Give scoreForYou 0–100 and one-sentence rationale referencing their cost basis and profile.

For the portfolio summary, if spare cash is specified give SPECIFIC deployment advice. Be concrete, not vague.

Schema:
{"asOf":"","holdings":[{"ticker":"","company":"","currentPrice":"","action":"","rationale":"","scoreForYou":0}],"portfolio":{"summary":"","concentration":"","cashAdvice":"","suggestions":[""]}}`;

      const parsed = await callClaude(sys, "Review my portfolio.", { maxTokens: 2500, maxSearches: 2 });
      if (!parsed.holdings) throw new Error("Couldn't analyze the portfolio. Try again.");

      // Override Claude's currentPrice with the real fetched price (belt-and-suspenders)
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

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (importRef.current) importRef.current.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (!rows.length) { alert("No data found in the file."); return; }
        const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
        const TICKER_KEYS   = ["ticker","symbol","stock","asset","security","name","company"];
        const SHARES_KEYS   = ["shares","quantity","qty","units","amount","position","numshares","numberofshares"];
        const COST_KEYS     = ["avgcost","averagecost","costbasis","avgprice","averageprice","purchaseprice","buyprice","cost","price","entryprice"];
        const CURRENCY_KEYS = ["currency","cur","ccy","curr"];
        const headers = Object.keys(rows[0]);
        const find = (keys) => headers.find(h => keys.includes(norm(h))) ?? null;
        const tickerCol   = find(TICKER_KEYS);
        const sharesCol   = find(SHARES_KEYS);
        const costCol     = find(COST_KEYS);
        const currencyCol = find(CURRENCY_KEYS);
        const VALID_CURRENCIES = ["USD","EUR","GBP","CAD","AUD","CHF","JPY","HKD","SGD"];
        const parsed = rows.map((row) => {
          const ticker   = tickerCol   ? String(row[tickerCol]).trim().toUpperCase()  : "";
          const shares   = sharesCol   ? parseFloat(row[sharesCol])  : NaN;
          const cost     = costCol     ? parseFloat(row[costCol])    : NaN;
          const rawCur   = currencyCol ? String(row[currencyCol]).trim().toUpperCase() : "USD";
          const currency = VALID_CURRENCIES.includes(rawCur) ? rawCur : "USD";
          const valid    = ticker.length > 0 && !isNaN(shares) && shares > 0 && !isNaN(cost) && cost > 0;
          return { ticker, shares: isNaN(shares) ? "" : String(shares), cost: isNaN(cost) ? "" : String(cost), currency, valid };
        }).filter(r => r.ticker || r.shares || r.cost);
        setImportPreview({ rows: parsed, tickerCol, sharesCol, costCol });
      } catch { alert("Could not read that file. Make sure it's a valid .xlsx, .xls or .csv file."); }
    };
    reader.readAsArrayBuffer(file);
  }

  function confirmImport() {
    const valid = importPreview.rows.filter(r => r.valid);
    persistHoldings([...holdings, ...valid.map(r => ({ ticker: r.ticker, shares: r.shares, cost: r.cost, currency: r.currency }))]);
    setImportPreview(null);
  }

  function addHolding() {
    const t = nt.trim().toUpperCase(); const s = parseNum(ns); const c = parseNum(nc);
    if (!t || s == null || c == null) return;
    persistHoldings([...holdings, { ticker: t, shares: String(s), cost: String(c), currency: ncur }]);
    setNt(""); setNs(""); setNc(""); setNcur("USD"); setReview(null);
  }
  function removeHolding(idx) { persistHoldings(holdings.filter((_, i) => i !== idx)); setReview(null); }

  const totals = (() => {
    let cost = 0, value = 0, haveVal = false;
    for (const h of holdings) {
      const sh = parseNum(h.shares), cb = parseNum(h.cost); if (sh == null || cb == null) continue;
      const cbUSD = toUSD(cb, h.currency);
      cost += sh * cbUSD;
      const rv = reviewFor(h.ticker); const cur = rv ? parseNum(rv.currentPrice) : null;
      if (cur != null) { value += sh * cur; haveVal = true; } else value += sh * cbUSD;
    }
    return { cost, value, haveVal, pl: haveVal ? value - cost : null, plPct: haveVal && cost ? ((value - cost) / cost) * 100 : null };
  })();

  const styles = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
      * { box-sizing: border-box; }
      .vd-eval { transition: all .15s ease; }
      .vd-eval:hover { filter: brightness(1.12); box-shadow: 0 0 16px ${P.accent}55; }
      .home-card { transition: border-color .18s, transform .18s, box-shadow .18s; }
      .home-card:hover { border-color: ${P.accent}55 !important; transform: translateY(-2px); box-shadow: 0 8px 32px #000a; }
      .vd-opt:hover { border-color: ${P.accent} !important; }
      .vd-input:focus { outline: none; border-color: ${P.accent} !important; box-shadow: 0 0 0 2px ${P.accent}22; }
      .vd-reveal { animation: vdUp .35s cubic-bezier(.2,.7,.2,1) both; }
      @keyframes vdUp { from { opacity:0; transform: translateY(8px);} to {opacity:1; transform:none;} }

      @media (prefers-reduced-motion: reduce){ .vd-reveal{animation:none;} }
      *::-webkit-scrollbar { width: 4px; height: 4px; }
      *::-webkit-scrollbar-track { background: ${P.paper}; }
      *::-webkit-scrollbar-thumb { background: ${P.dim}; border-radius: 2px; }
      .vd-tag { font-family: ${F.mono}; font-size: 10px; font-weight:500; color: ${P.accent}; background: ${P.accentDim}; border: 1px solid ${P.accentBorder}; border-radius: 3px; padding: 2px 8px; letter-spacing: 0.3px; text-transform: uppercase; }
      .vd-metric { font-family: ${F.mono}; font-size: 11px; color: ${P.faint}; }
      .vd-metric b { color: ${P.ink}; font-weight: 600; }
      .vd-row:hover { background: ${P.rowHover} !important; }
      ::selection { background: ${P.accent}33; }
      .vd-pill-buy { background: ${P.accent}18; border: 1px solid ${P.accent}55; color: ${P.accent}; }
      .vd-pill-sell { background: ${P.red}18; border: 1px solid ${P.red}55; color: ${P.red}; }
      .vd-pill-hold { background: ${P.dim}; border: 1px solid #2a4a2a; color: ${P.faint}; }
      .vd-pill-trim { background: ${P.amber}18; border: 1px solid ${P.amber}55; color: ${P.amber}; }
    `}</style>
  );

  // Firebase loading
  if (firebaseUser === undefined) return <div style={{ background: P.paper, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: 2, color: P.faint }}>LOADING…</span></div>;

  // Not signed in — show auth screen (skip if Firebase not configured)
  const firebaseConfigured = !!import.meta.env.VITE_FIREBASE_API_KEY;
  if (firebaseConfigured && !firebaseUser) return <AuthScreen onAuth={(u) => setFirebaseUser(u)} />;

  if (phase === "onboarding") return <div style={{ background: P.paper, minHeight: "100%", paddingBottom: 56 }}>{styles}<Onboarding initial={profile} onDone={finishOnboarding} onExit={profile?.name ? () => setPhase("app") : null} /></div>;

  return (
    <div style={{ display: "flex", background: P.paper, minHeight: "100vh" }}>
      {styles}
      <Sidebar nav={nav} setNav={setNav} profile={profile} onEdit={() => setShowProfileEditor(true)} holdingsCount={holdings.length} onSignOut={firebaseConfigured ? () => signOut(auth).then(() => setFirebaseUser(null)) : null} />
      {showProfileEditor && <ProfileEditor profile={profile} onSave={saveProfile} onClose={() => setShowProfileEditor(false)} />}

      <HelpChat />
      <div style={{ marginLeft: 240, flex: 1, padding: "32px 36px 60px", maxWidth: "calc(100vw - 240px)", boxSizing: "border-box" }}>
        {/* ===================== HOME ===================== */}
        {nav === "home" && <HomeScreen profile={profile} setNav={setNav} />}

        {/* ===================== DISCOVER ===================== */}
        {nav === "discover" && (
          <>
            <section style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h2 style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 18, color: P.ink, margin: "0 0 2px" }}>Best buys for you</h2>
                  <span style={{ fontFamily: F.sans, fontSize: 13, color: P.faint }}>Ranked by fit to your profile · global markets{holdings.length ? ` · ${holdings.length} positions loaded` : ""}</span>
                </div>
                <button className="vd-eval" onClick={discover} disabled={recsLoading} style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 13, color: "#000", background: P.accent, border: "none", borderRadius: 6, padding: "9px 20px", cursor: recsLoading ? "default" : "pointer", opacity: recsLoading ? 0.6 : 1, whiteSpace: "nowrap" }}>
                  {recsLoading ? "Scanning…" : "↺ Refresh picks"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
                {["Global all-markets", "US markets", "Europe", "Asia-Pacific", "My interest sectors"].map((u) => {
                  const on = universe === u;
                  return <button key={u} onClick={() => setUniverse(u)} className="vd-opt" style={{ cursor: "pointer", padding: "5px 14px", borderRadius: 20, border: `1px solid ${on ? P.accent : P.dim}`, background: on ? P.accentDim : "transparent", fontFamily: F.sans, fontWeight: 500, fontSize: 12.5, color: on ? P.accent : P.slate, transition: "all .15s" }}>{u}</button>;
                })}
              </div>
            </section>
            {recsLoading && <Spinner title="Finding your best picks…" sub="verifying current data · usually 15–20s" />}
            {recsError && !recsLoading && <ErrorBox msg={recsError} onRetry={discover} label="Scan again" />}
            {recs?.picks && !recsLoading && (
              <div className="vd-reveal" style={{ marginTop: 14 }}>
                {/* Market context banner */}
                {recs.marketContext && (
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 16px", marginBottom: 10, background: P.card, border: `1px solid ${P.cardBorder}`, borderLeft: `3px solid ${P.amber}`, borderRadius: 6 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 11, color: P.amber, flexShrink: 0 }}>◈</span>
                    <span style={{ fontFamily: F.sans, fontSize: 13, color: P.slate, lineHeight: 1.5 }}><b style={{ color: P.ink }}>Market context:</b> {recs.marketContext}</span>
                  </div>
                )}
                <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, overflow: "hidden" }}>
                  {/* Header */}
                  <div style={{ display: "grid", gridTemplateColumns: "24px 36px 1fr 60px", gap: 14, padding: "9px 20px", background: P.wash, borderBottom: `1px solid ${P.cardBorder}` }}>
                    <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>#</span>
                    <span />
                    <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>Company · Why now · Risk</span>
                    <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" }}>Score</span>
                  </div>
                  {recs.picks.map((p, i) => <RecCard key={p.ticker || i} pick={p} rank={i + 1} onOpen={() => openTicker(p.ticker)} />)}
                  {recs.asOf && <div style={{ padding: "9px 20px", borderTop: `1px solid ${P.cardBorder}`, fontFamily: F.sans, fontSize: 11, color: P.faint }}>Updated {recs.asOf}</div>}
                </div>
              </div>
            )}
            {!recs && !recsLoading && !recsError && <div style={{ textAlign: "center", padding: "30px 20px 0", fontFamily: F.sans, fontSize: 14, color: P.faint, lineHeight: 1.6 }}>Atlas is scanning global markets for stocks that fit how you invest…</div>}
          </>
        )}

        {/* ===================== PORTFOLIO ===================== */}
        {nav === "portfolio" && (() => {
          // Compute totals using live prices where available
          let lCost = 0, lValue = 0, lHaveVal = false;
          for (const h of holdings) {
            const sh = parseNum(h.shares), cb = parseNum(h.cost); if (sh == null || cb == null) continue;
            const cbUSD = toUSD(cb, h.currency);
            lCost += sh * cbUSD;
            const lp = livePrices[h.ticker];
            if (lp?.price != null) { lValue += sh * lp.price; lHaveVal = true; }
            else { const rv = reviewFor(h.ticker); const cur = rv ? parseNum(rv.currentPrice) : null;
              if (cur != null) { lValue += sh * cur; lHaveVal = true; } else lValue += sh * cbUSD; }
          }
          const lPl = lHaveVal ? lValue - lCost : null;
          const lPlPct = lHaveVal && lCost ? ((lValue - lCost) / lCost) * 100 : null;
          const isUp = lPlPct != null && lPlPct >= 0;

          return (
          <>
            {/* ── Sub-tab switcher ── */}
            <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
              {[["holdings", "Holdings"], ["news", "Portfolio News"]].map(([id, label]) => (
                <button key={id} onClick={() => { setPortfolioTab(id); if (id === "news" && !newsItems && !newsLoading) fetchPortfolioNews(); }}
                  style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer", background: portfolioTab === id ? P.accent : P.card, color: portfolioTab === id ? "#000" : P.faint, transition: "all .15s" }}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Top summary bar ── */}
            <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 10, padding: "22px 28px", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: P.faint, textTransform: "uppercase", marginBottom: 6 }}>Portfolio Value</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: F.mono, fontSize: 30, fontWeight: 700, color: P.ink, letterSpacing: -1 }}>
                      {lHaveVal ? money(lValue) : holdings.length ? money(lCost) : "—"}
                    </span>
                    {lPl != null && (
                      <span style={{ fontFamily: F.mono, fontSize: 15, fontWeight: 600, color: isUp ? P.green : P.red }}>
                        {isUp ? "+" : ""}{money(lPl)} <span style={{ fontSize: 13, opacity: 0.85 }}>({isUp ? "+" : ""}{lPlPct.toFixed(2)}%)</span>
                      </span>
                    )}
                    {livePricesLoading && <span style={{ fontFamily: F.mono, fontSize: 10, color: P.faint, letterSpacing: 1 }}>REFRESHING…</span>}
                  </div>
                  <div style={{ display: "flex", gap: 28, marginTop: 14, flexWrap: "wrap" }}>
                    <div><div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginBottom: 2 }}>Invested</div><div style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 600, color: P.slate }}>{money(lCost)}</div></div>
                    <div><div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginBottom: 2 }}>Positions</div><div style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 600, color: P.slate }}>{holdings.length}</div></div>
                    {spareCash && parseNum(spareCash) > 0 && <div><div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginBottom: 2 }}>Cash available</div><div style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 600, color: P.accent }}>${Number(parseNum(spareCash)).toLocaleString()}</div></div>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                  <button className="vd-eval" onClick={analyzePortfolio} disabled={reviewLoading || !holdings.length} style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 13, color: "#000", background: P.accent, border: "none", borderRadius: 7, padding: "11px 24px", cursor: (reviewLoading || !holdings.length) ? "default" : "pointer", opacity: (reviewLoading || !holdings.length) ? 0.6 : 1, whiteSpace: "nowrap" }}>
                    {reviewLoading ? "Analysing…" : review ? "↺ Re-analyse" : "Run AI Analysis"}
                  </button>
                </div>
              </div>
            </div>

            {portfolioTab === "holdings" && <>
            {/* ── Positions table ── */}
            <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 95px 80px 90px 105px 120px 90px 36px", gap: 0, padding: "8px 4px", background: P.wash, borderBottom: `1px solid ${P.cardBorder}` }}>
                <span />
                <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5, padding: "0 10px" }}>Asset</span>
                <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", padding: "0 8px" }}>Price</span>
                <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", padding: "0 8px" }}>Qty</span>
                <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", padding: "0 8px" }}>Avg Cost</span>
                <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", padding: "0 8px" }}>Mkt Value</span>
                <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", padding: "0 8px" }}>P&L</span>
                <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center", padding: "0 8px" }}>Call</span>
                <span />
              </div>

              {holdings.length === 0
                ? <div style={{ padding: "36px 20px", textAlign: "center", fontFamily: F.mono, fontSize: 11, letterSpacing: 1, color: P.faint }}>NO POSITIONS — ADD ONE BELOW</div>
                : holdings.map((h, i) => (
                    <HoldingRow key={`${h.ticker}-${i}`} h={h}
                      costUSD={toUSD(parseNum(h.cost), h.currency)}
                      livePrice={livePrices[h.ticker]}
                      review={reviewFor(h.ticker)}
                      onOpen={() => openTicker(h.ticker)}
                      onRemove={() => removeHolding(i)} />
                  ))}
            </div>

            {reviewLoading && <Spinner title="Fetching live prices and running AI analysis…" sub="live data · tuned to your profile" />}
            {reviewError && !reviewLoading && <ErrorBox msg={reviewError} onRetry={analyzePortfolio} label="Try again" />}

            {/* ── AI analysis results ── */}
            {review?.portfolio && !reviewLoading && (
              <div className="vd-reveal" style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {review.portfolio.cashAdvice && spareCash && parseNum(spareCash) > 0 && (
                  <div style={{ background: P.card, border: `1px solid ${P.accent}33`, borderLeft: `3px solid ${P.accent}`, borderRadius: 8, padding: "16px 20px" }}>
                    <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.accent, marginBottom: 8, textTransform: "uppercase" }}>Deploy ${Number(spareCash).toLocaleString()} cash</div>
                    <p style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.6, color: P.ink, margin: 0 }}>{review.portfolio.cashAdvice}</p>
                  </div>
                )}
                <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "16px 20px" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.faint, marginBottom: 12, textTransform: "uppercase" }}>Portfolio Analysis</div>
                  {review.portfolio.summary && <p style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.6, color: P.slate, margin: "0 0 12px" }}>{review.portfolio.summary}</p>}
                  {review.portfolio.concentration && <p style={{ fontFamily: F.sans, fontSize: 12.5, lineHeight: 1.55, color: P.faint, margin: "0 0 10px" }}>{review.portfolio.concentration}</p>}
                  {Array.isArray(review.portfolio.suggestions) && review.portfolio.suggestions.map((s, i) => (
                    <div key={i} style={{ fontFamily: F.sans, fontSize: 13, color: P.slate, padding: "4px 0", display: "flex", gap: 10 }}><span style={{ color: P.accent, fontFamily: F.mono, flexShrink: 0 }}>→</span>{s}</div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Spreadsheet import modal ── */}
            {importPreview && (
              <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
                <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 12, padding: "24px 28px", width: "100%", maxWidth: 560, maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 2, color: P.accent, textTransform: "uppercase", marginBottom: 4 }}>Import Preview</div>
                      <div style={{ fontFamily: F.sans, fontSize: 13, color: P.slate }}>
                        {importPreview.rows.filter(r => r.valid).length} of {importPreview.rows.length} rows ready to import
                        {!importPreview.tickerCol && <span style={{ color: P.amber }}> · Ticker column not found</span>}
                        {!importPreview.sharesCol && <span style={{ color: P.amber }}> · Shares column not found</span>}
                        {!importPreview.costCol   && <span style={{ color: P.amber }}> · Cost column not found</span>}
                      </div>
                    </div>
                    <button onClick={() => setImportPreview(null)} style={{ background: "none", border: "none", color: P.faint, fontSize: 20, cursor: "pointer", padding: "0 4px" }}>×</button>
                  </div>
                  <div style={{ overflowY: "auto", border: `1px solid ${P.dim}`, borderRadius: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 60px", gap: 0, fontFamily: F.mono, fontSize: 10, letterSpacing: 1, color: P.faint, textTransform: "uppercase", padding: "8px 14px", borderBottom: `1px solid ${P.dim}`, background: P.wash }}>
                      <span>Ticker</span><span>Shares</span><span>Avg Cost</span><span>Cur</span>
                    </div>
                    {importPreview.rows.map((r, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 60px", gap: 0, padding: "9px 14px", borderBottom: i < importPreview.rows.length - 1 ? `1px solid ${P.dim}22` : "none", background: r.valid ? "transparent" : `${P.red}0a`, alignItems: "center" }}>
                        <span style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 700, color: r.valid ? P.accent : P.red }}>{r.ticker || <em style={{ opacity: 0.4 }}>missing</em>}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 12, color: r.shares ? P.ink : P.red }}>{r.shares || <em style={{ opacity: 0.4 }}>—</em>}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 12, color: r.cost ? P.ink : P.red }}>{r.cost ? `${r.currency !== "USD" ? r.currency + " " : "$"}${r.cost}` : <em style={{ opacity: 0.4 }}>—</em>}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 11, color: P.slate }}>{r.currency}</span>
                      </div>
                    ))}
                  </div>
                  {importPreview.rows.filter(r => !r.valid).length > 0 && (
                    <div style={{ fontFamily: F.sans, fontSize: 12, color: P.amber }}>Rows highlighted in red are missing required fields and will be skipped.</div>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button onClick={() => setImportPreview(null)} style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: P.slate, background: P.wash, border: `1px solid ${P.dim}`, borderRadius: 6, padding: "9px 18px", cursor: "pointer" }}>Cancel</button>
                    <button onClick={confirmImport} disabled={!importPreview.rows.some(r => r.valid)} style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 700, color: "#000", background: P.accent, border: "none", borderRadius: 6, padding: "9px 22px", cursor: "pointer", opacity: importPreview.rows.some(r => r.valid) ? 1 : 0.4 }}>
                      Import {importPreview.rows.filter(r => r.valid).length} Holdings
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Add position + spare cash ── */}
            <div style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 10, padding: "16px 20px", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.faint, textTransform: "uppercase" }}>Add Position</div>
                <button onClick={() => importRef.current?.click()} style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: P.slate, background: P.wash, border: `1px solid ${P.dim}`, borderRadius: 5, padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13 }}>⬆</span> Import from spreadsheet
                </button>
                <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleImportFile} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "0 0 110px" }}>
                  <div style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Ticker</div>
                  <input className="vd-input" value={nt} onChange={e => setNt(e.target.value)} placeholder="AAPL" onKeyDown={e => e.key === "Enter" && addHolding()}
                    style={{ width: "100%", boxSizing: "border-box", fontFamily: F.mono, fontSize: 14, fontWeight: 700, color: P.accent, background: P.wash, border: `1.5px solid ${P.dim}`, borderRadius: 6, padding: "9px 10px", textTransform: "uppercase" }} />
                  <div style={{ fontFamily: F.sans, fontSize: 10, color: P.faint, marginTop: 5, lineHeight: 1.4 }}>Non-US stocks need an exchange suffix — e.g. <span style={{ fontFamily: F.mono, color: P.slate }}>SAF.PA</span> (Paris), <span style={{ fontFamily: F.mono, color: P.slate }}>SHEL.L</span> (London), <span style={{ fontFamily: F.mono, color: P.slate }}>9988.HK</span> (HK)</div>
                </div>
                <div style={{ flex: "0 0 80px" }}>
                  <div style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Shares</div>
                  <input className="vd-input" value={ns} onChange={e => setNs(e.target.value)} placeholder="10" inputMode="decimal" onKeyDown={e => e.key === "Enter" && addHolding()}
                    style={{ width: "100%", boxSizing: "border-box", fontFamily: F.mono, fontSize: 14, color: P.ink, background: P.wash, border: `1.5px solid ${P.dim}`, borderRadius: 6, padding: "9px 10px" }} />
                </div>
                <div style={{ flex: "1 1 160px", minWidth: 140 }}>
                  <div style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Avg buy price</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    <select value={ncur} onChange={e => setNcur(e.target.value)}
                      style={{ fontFamily: F.mono, fontSize: 11, fontWeight: 600, color: P.slate, background: P.wash, border: `1.5px solid ${P.dim}`, borderRadius: 6, padding: "9px 6px", cursor: "pointer", flexShrink: 0 }}>
                      {["USD","EUR","GBP","CAD","AUD","CHF","JPY","HKD","SGD"].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input className="vd-input" value={nc} onChange={e => setNc(e.target.value)} placeholder="182.50" inputMode="decimal" onKeyDown={e => e.key === "Enter" && addHolding()}
                      style={{ flex: 1, minWidth: 0, boxSizing: "border-box", fontFamily: F.mono, fontSize: 14, color: P.ink, background: P.wash, border: `1.5px solid ${P.dim}`, borderRadius: 6, padding: "9px 10px" }} />
                  </div>
                </div>
                <button className="vd-eval" onClick={addHolding} style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 13, color: "#000", background: P.accent, border: "none", borderRadius: 6, padding: "9px 20px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, height: 38 }}>+ Add</button>
              </div>

              {/* Spare cash inline */}
              <div style={{ borderTop: `1px solid ${P.dim}`, marginTop: 14, paddingTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: P.faint, textTransform: "uppercase", letterSpacing: 0.3, flexShrink: 0 }}>Spare cash</div>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontFamily: F.mono, fontSize: 13, color: P.faint, pointerEvents: "none" }}>$</span>
                  <input className="vd-input" value={spareCash} onChange={e => updateSpareCash(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" inputMode="decimal"
                    style={{ width: 140, boxSizing: "border-box", fontFamily: F.mono, fontSize: 13, fontWeight: 600, color: P.accent, background: P.wash, border: `1.5px solid ${P.dim}`, borderRadius: 6, padding: "8px 10px 8px 24px" }} />
                </div>
                {spareCash && parseNum(spareCash) > 0
                  ? <span style={{ fontFamily: F.sans, fontSize: 12, color: P.slate }}>Atlas will advise how to deploy <b style={{ color: P.accent }}>${Number(parseNum(spareCash)).toLocaleString()}</b> when you run an analysis.</span>
                  : <span style={{ fontFamily: F.sans, fontSize: 12, color: P.faint }}>Enter cash to get specific deployment advice.</span>}
              </div>
            </div>
            </>}

            {/* ── Portfolio News ── */}
            {portfolioTab === "news" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ fontFamily: F.sans, fontSize: 13, color: P.faint }}>
                    Latest news for your {holdings.length} holding{holdings.length !== 1 ? "s" : ""}, sourced live.
                  </div>
                  <button onClick={fetchPortfolioNews} disabled={newsLoading || !holdings.length}
                    style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: newsLoading ? P.faint : P.accent, background: "none", border: `1px solid ${newsLoading ? P.dim : P.accent}44`, borderRadius: 6, padding: "6px 14px", cursor: newsLoading ? "default" : "pointer" }}>
                    {newsLoading ? "Fetching…" : newsItems ? "↺ Refresh" : "Fetch news"}
                  </button>
                </div>
                {!holdings.length && (
                  <div style={{ fontFamily: F.sans, fontSize: 13, color: P.faint, padding: "40px 0", textAlign: "center" }}>Add some holdings first to see portfolio news.</div>
                )}
                {newsLoading && <Spinner title="Searching for latest news on your holdings…" sub="Live search · usually 15–25s" />}
                {newsError && !newsLoading && <ErrorBox msg={newsError} onRetry={fetchPortfolioNews} label="Try again" />}
                {newsItems && !newsLoading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {newsItems.length === 0 && <div style={{ fontFamily: F.sans, fontSize: 13, color: P.faint, textAlign: "center", padding: "30px 0" }}>No news found.</div>}
                    {newsItems.map((item, i) => {
                      const sentColor = item.sentiment === "bullish" ? P.accent : item.sentiment === "bearish" ? P.red : P.amber;
                      const isMacro = item.ticker === "MACRO";
                      const hasUrl = item.url && item.url.startsWith("http");
                      return (
                        <div key={i} className="vd-reveal" style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 10, padding: "16px 20px", borderLeft: `3px solid ${sentColor}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: isMacro ? `${P.amber}22` : `${P.accent}18`, color: isMacro ? P.amber : P.accent }}>
                              {isMacro ? "MACRO" : item.ticker}
                            </span>
                            {item.source && <span style={{ fontFamily: F.sans, fontSize: 11, color: P.faint }}>{item.source}</span>}
                            {item.date && <span style={{ fontFamily: F.sans, fontSize: 11, color: P.faint }}>{item.date}</span>}
                            <span style={{ fontFamily: F.mono, fontSize: 9, fontWeight: 700, letterSpacing: 1, color: sentColor, marginLeft: "auto", textTransform: "uppercase" }}>{item.sentiment}</span>
                          </div>
                          <div style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: P.ink, marginBottom: 6, lineHeight: 1.4 }}>
                            {hasUrl
                              ? <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: P.ink, textDecoration: "none" }} onMouseOver={e => e.currentTarget.style.color = P.accent} onMouseOut={e => e.currentTarget.style.color = P.ink}>{item.headline} ↗</a>
                              : item.headline}
                          </div>
                          {item.summary && <div style={{ fontFamily: F.sans, fontSize: 13, color: P.slate, lineHeight: 1.6 }}>{item.summary}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
          );
        })()}

        {/* ===================== RESEARCH ===================== */}
        {nav === "research" && (
          <>
            <section style={{ background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "18px 20px" }}>
              <h2 style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 18, color: P.ink, margin: "0 0 4px" }}>Equity Research</h2>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: P.faint, margin: "0 0 14px" }}>Full AI-powered dossier on any stock — scored to your profile and portfolio</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input className="vd-input" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && evaluate()} placeholder="Enter ticker or company name (e.g. NVDA, Apple, TSMC)…" style={{ flex: "1 1 240px", fontFamily: F.sans, fontSize: 15, color: P.ink, background: P.wash, border: `1px solid ${P.dim}`, borderRadius: 6, padding: "11px 16px" }} />
                <button className="vd-eval" onClick={() => evaluate()} disabled={loading} style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 13, color: "#000", background: P.accent, border: "none", borderRadius: 6, padding: "0 24px", minHeight: 44, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>{loading ? "Analysing…" : "Run analysis"}</button>
              </div>
            </section>
            {loading && <Spinner title={LOADING_MSGS[msgIdx]} sub="Searching live sources · est. 20–40s" />}
            {error && !loading && <ErrorBox msg={error} onRetry={() => evaluate()} />}
            {result && !loading && <Results result={result} profile={profile} />}
            {!result && !loading && !error && <div style={{ textAlign: "center", padding: "40px 20px 0", fontFamily: F.sans, fontSize: 14, color: P.faint, lineHeight: 1.7 }}>Enter any ticker or company name above to generate a full research dossier scored to your profile and portfolio.</div>}
          </>
        )}

        {/* ===================== BACKTEST ===================== */}
        {nav === "backtest" && <Backtester />}

        <footer style={{ marginTop: 44, paddingTop: 16, borderTop: `1px solid ${P.cardBorder}` }}>
          <p style={{ fontFamily: F.mono, fontSize: 10, lineHeight: 1.6, color: P.faint, margin: 0, letterSpacing: 0.3 }}>Atlas surfaces research ideas for educational purposes only — not investment advice. All scores, calls and picks are AI-generated from public data and may be incomplete or outdated. Always conduct independent due diligence before any transaction.</p>
        </footer>
      </div>
    </div>
  );
}
