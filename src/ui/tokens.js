// ============================================================
//  ATLAS · "Obsidian" design tokens — single source of truth
//  Dark, high-contrast, premium fintech. ONE accent (indigo-violet).
//  Consumed by every primitive and page via inline styles.
//  NOTE: This file replaces the old per-file `P` / `F` palette objects.
// ============================================================

// ---------- raw color ramp ----------
export const color = {
  // surfaces — elevation by layered near-black
  canvas:    "#0B0B10",
  sunken:    "#08080C",
  surface1:  "#131319", // cards / panels
  surface2:  "#1A1A22", // inputs, insets, raised-within-card
  surface3:  "#20202A", // popovers, hover-raise, command palette

  // borders — structure drawn with hairlines
  hairline:  "#1F1F27",
  border:    "#292932",
  borderStrong: "#383843",

  // text
  text:      "#F4F4F6", // primary
  text2:     "#9B9BA6", // secondary
  text3:     "#82828E", // tertiary / labels / neutral "hold" — lightened from #6A6A76 to clear WCAG AA (4.5:1) on raised surfaces at the tiny sizes it's used at
  textDim:   "#45454E", // disabled

  // accent — the single confident signature
  accent:      "#7C5CFF",
  accentHover: "#9277FF",
  accentPress: "#6A48F0",
  accentSoft:  "rgba(124,92,255,0.12)",
  accentBorder:"rgba(124,92,255,0.30)",
  accentGlow:  "rgba(124,92,255,0.45)",
  onAccent:    "#FFFFFF",

  // semantic
  positive:     "#3DDC84",
  positiveSoft: "rgba(61,220,132,0.12)",
  negative:     "#FF5C5C",
  negativeSoft: "rgba(255,92,92,0.12)",
  warning:      "#FBB845",
  warningSoft:  "rgba(251,184,69,0.12)",

  // data-viz
  series:      "#7C5CFF", // primary line
  seriesAlt:   "#46B3C9", // comparison (e.g. buy & hold)
  grid:        "#23232E",

  // scrim
  scrim:       "rgba(5,5,8,0.62)",
};

// ---------- score gradient (0–100) ----------
const SCORE_STOPS = [
  [0,  "#FF5C5C"],
  [35, "#FF8A5C"],
  [55, "#FBB845"],
  [70, "#9CD16A"],
  [85, "#3DDC84"],
];
export function scoreColor(s) {
  if (s == null || isNaN(s)) return color.text3;
  let out = SCORE_STOPS[0][1];
  for (const [n, c] of SCORE_STOPS) if (s >= n) out = c;
  return out;
}
export function grade(s) {
  if (s == null) return "—";
  const t = [[90,"A+"],[85,"A"],[80,"A−"],[75,"B+"],[70,"B"],[65,"B−"],[60,"C+"],[55,"C"],[50,"C−"],[40,"D"]];
  for (const [n, g] of t) if (s >= n) return g;
  return "F";
}

// ---------- action / call colors ----------
export function actionColor(action = "") {
  const a = action.toLowerCase();
  if (a.includes("strong buy") || a.includes("buy more") || a === "buy" || a === "add") return color.positive;
  if (a.includes("sell") || a.includes("avoid")) return color.negative;
  if (a.includes("trim")) return color.warning;
  return color.text3; // hold / neutral
}

// ---------- fonts ----------
export const font = {
  display: "'Space Grotesk', 'Inter', system-ui, sans-serif",
  sans:    "'Inter', system-ui, -apple-system, sans-serif",
  mono:    "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
};

// ---------- type scale ----------
// each entry is a ready-to-spread style object
const tabular = { fontVariantNumeric: "tabular-nums" };
export const type = {
  displayXl: { fontFamily: font.display, fontSize: 48, lineHeight: "1.05", fontWeight: 600, letterSpacing: "-0.02em" },
  displayL:  { fontFamily: font.display, fontSize: 34, lineHeight: "1.1",  fontWeight: 600, letterSpacing: "-0.02em" },
  title:     { fontFamily: font.display, fontSize: 24, lineHeight: "1.2",  fontWeight: 600, letterSpacing: "-0.015em" },
  heading:   { fontFamily: font.sans,    fontSize: 18, lineHeight: "1.3",  fontWeight: 600, letterSpacing: "-0.01em" },
  bodyL:     { fontFamily: font.sans,    fontSize: 16, lineHeight: "1.55", fontWeight: 400 },
  body:      { fontFamily: font.sans,    fontSize: 14, lineHeight: "1.5",  fontWeight: 400 },
  bodyStrong:{ fontFamily: font.sans,    fontSize: 14, lineHeight: "1.5",  fontWeight: 600 },
  small:     { fontFamily: font.sans,    fontSize: 13, lineHeight: "1.45", fontWeight: 400 },
  caption:   { fontFamily: font.sans,    fontSize: 12, lineHeight: "1.4",  fontWeight: 500 },
  overline:  { fontFamily: font.sans,    fontSize: 11, lineHeight: "1.3",  fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase" },
  dataXl:    { fontFamily: font.sans,    fontSize: 36, lineHeight: "1.0",  fontWeight: 600, ...tabular },
  data:      { fontFamily: font.sans,    fontSize: 14, lineHeight: "1.4",  fontWeight: 500, ...tabular },
  mono:      { fontFamily: font.mono,    fontSize: 13, lineHeight: "1.4",  fontWeight: 500, ...tabular },
};

// ---------- spacing (4px base) ----------
export const space = { 0:0, 0.5:2, 1:4, 1.5:6, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 10:40, 12:48, 16:64, 20:80, 24:96 };

// ---------- radius ----------
export const radius = { xs:6, sm:8, md:12, lg:16, xl:20, full:999 };

// ---------- elevation / shadow ----------
export const shadow = {
  e1: "inset 0 1px 0 rgba(255,255,255,0.03), 0 1px 2px rgba(0,0,0,0.4)",
  e2: "0 6px 20px rgba(0,0,0,0.45)",
  e3: "0 20px 50px rgba(0,0,0,0.6)",
  focus: `0 0 0 1px ${color.accent}, 0 0 0 4px ${color.accentSoft}`,
  glow: `0 0 24px ${color.accentGlow}`,
};

// ---------- motion ----------
export const motion = {
  fast: 0.15, base: 0.2, slow: 0.25, data: 0.5,   // seconds (framer-motion)
  easeOut:  [0.16, 1, 0.3, 1],
  easeInOut:[0.4, 0, 0.2, 1],
  easeIn:   [0.4, 0, 1, 1],
  spring:   { type: "spring", stiffness: 420, damping: 38, mass: 0.8 },
};

// ---------- z-index scale ----------
export const z = { base:0, raised:10, sticky:20, nav:100, overlay:900, modal:1000, toast:1100 };

// convenience default export bundling everything
const tokens = { color, font, type, space, radius, shadow, motion, z, scoreColor, grade, actionColor };
export default tokens;
