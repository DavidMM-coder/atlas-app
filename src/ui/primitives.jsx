// ============================================================
//  ATLAS · "Obsidian" primitives
//  The reusable component system. Pages compose ONLY from here.
//  Built on inline tokens + Framer Motion. Dark theme, one accent.
// ============================================================
import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, animate, useReducedMotion, MotionConfig } from "framer-motion";
import { color as c, font, type, radius, shadow, space, motion as MOT, z, scoreColor, grade } from "./tokens.js";
import { hoverLift, pressable, sheetPresence, slideOver, scrim } from "./motion.js";

// ────────────────────────────────────────────────────────────
//  Global style injection (focus rings, scrollbars, fonts hooks)
// ────────────────────────────────────────────────────────────
export function AtlasStyles() {
  return (
    <style>{`
      *{box-sizing:border-box;}
      ::selection{ background:${c.accentSoft}; color:${c.text}; }
      ::-webkit-scrollbar{ width:10px; height:10px; }
      ::-webkit-scrollbar-track{ background:transparent; }
      ::-webkit-scrollbar-thumb{ background:${c.border}; border-radius:99px; border:3px solid ${c.canvas}; }
      ::-webkit-scrollbar-thumb:hover{ background:${c.borderStrong}; }
      @keyframes atlas-spin{ to{ transform:rotate(360deg); } }
      @keyframes atlas-shimmer{ 0%{ background-position:-400px 0; } 100%{ background-position:400px 0; } }
      .atlas-input{ transition:border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
      .atlas-input::placeholder{ color:${c.text3}; opacity:1; }
      .atlas-input:focus{ outline:none; border-color:${c.accent}!important; box-shadow:${shadow.focus}; }
      .atlas-input:focus-visible{ outline:none; }
      .atlas-input:-webkit-autofill,.atlas-input:-webkit-autofill:focus{
        -webkit-text-fill-color:${c.text}; -webkit-box-shadow:0 0 0 1000px ${c.surface2} inset; caret-color:${c.text};
      }
      .atlas-btn{ transition:background-color .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, filter .15s ease; }
      .atlas-btn:focus-visible{ outline:none; box-shadow:${shadow.focus}; }
      .atlas-row{ transition:background-color .14s ease; }
      .atlas-row:hover{ background:${c.surface2}; }
      .atlas-card-int{ transition:border-color .18s ease, box-shadow .18s ease, background-color .18s ease; }
      .atlas-card-int:hover{ border-color:${c.borderStrong}!important; box-shadow:${shadow.e2}; }
      .atlas-link{ color:${c.text}; text-decoration:none; transition:color .15s ease; }
      .atlas-link:hover{ color:${c.accent}; }
      .atlas-ghost:hover{ background:${c.surface2}!important; color:${c.text}!important; }
      .atlas-tab:hover{ color:${c.text}!important; }
      input[type=number]::-webkit-inner-spin-button{ opacity:.4; }
    `}</style>
  );
}

// Wrap app once so reduced-motion is honored everywhere.
export function AtlasMotionProvider({ children }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

// ────────────────────────────────────────────────────────────
//  Brand mark
// ────────────────────────────────────────────────────────────
export function AtlasMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="9" fill={c.accent} />
      <path d="M16 7L23.5 23H18.4L16.7 19H15.3L13.6 23H8.5L16 7Z" fill="#fff" opacity="0.95" />
      <line x1="12" y1="17" x2="20" y2="17" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" opacity="0.95" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
//  Text helpers
// ────────────────────────────────────────────────────────────
export function Overline({ children, style, color = c.text3 }) {
  return <div style={{ ...type.overline, color, ...style }}>{children}</div>;
}
export function Text({ as: As = "span", variant = "body", color = c.text2, style, children, ...rest }) {
  return <As style={{ ...type[variant], color, ...style }} {...rest}>{children}</As>;
}

// ────────────────────────────────────────────────────────────
//  Button
// ────────────────────────────────────────────────────────────
const BTN_SIZES = {
  sm: { padding: "7px 14px", fontSize: 13, height: 34, radius: radius.sm },
  md: { padding: "10px 18px", fontSize: 14, height: 40, radius: radius.sm },
  lg: { padding: "13px 24px", fontSize: 15, height: 48, radius: radius.md },
};
function btnVariant(variant) {
  switch (variant) {
    case "secondary": return { background: c.surface2, color: c.text, border: `1px solid ${c.border}` };
    case "ghost":     return { background: "transparent", color: c.text2, border: "1px solid transparent" };
    case "danger":    return { background: c.negativeSoft, color: c.negative, border: `1px solid rgba(255,92,92,0.32)` };
    case "outline":   return { background: "transparent", color: c.accent, border: `1px solid ${c.accentBorder}` };
    default:          return { background: c.accent, color: c.onAccent, border: `1px solid ${c.accent}` }; // primary
  }
}
export function Button({
  children, variant = "primary", size = "md", loading, disabled, icon, iconRight,
  onClick, type: htmlType = "button", style, full, glow, className = "", ...rest
}) {
  const s = BTN_SIZES[size] || BTN_SIZES.md;
  const v = btnVariant(variant);
  const isDisabled = disabled || loading;
  return (
    <motion.button
      type={htmlType}
      onClick={onClick}
      disabled={isDisabled}
      className={`atlas-btn ${variant === "ghost" ? "atlas-ghost" : ""} ${className}`}
      {...(isDisabled ? {} : pressable)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontFamily: font.sans, fontWeight: 600, fontSize: s.fontSize, lineHeight: 1,
        padding: s.padding, minHeight: s.height, borderRadius: s.radius, cursor: isDisabled ? "default" : "pointer",
        width: full ? "100%" : "auto", whiteSpace: "nowrap",
        opacity: isDisabled ? 0.45 : 1, boxShadow: glow && variant === "primary" ? shadow.glow : "none",
        ...v, ...style,
      }}
      {...rest}
    >
      {loading ? <Spinner size={16} color={v.color} /> : icon}
      {children}
      {iconRight}
    </motion.button>
  );
}

export function IconButton({ children, label, onClick, active, size = 36, style, ...rest }) {
  return (
    <motion.button
      type="button" aria-label={label} title={label} onClick={onClick}
      className="atlas-btn atlas-ghost" {...pressable}
      style={{
        width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: radius.sm, cursor: "pointer", border: "1px solid transparent",
        background: active ? c.accentSoft : "transparent", color: active ? c.accent : c.text3, ...style,
      }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

// ────────────────────────────────────────────────────────────
//  Surfaces — Card / Panel
// ────────────────────────────────────────────────────────────
export function Card({ children, interactive, onClick, accentEdge, pad = 20, style, className = "", ...rest }) {
  const base = {
    background: c.surface1, border: `1px solid ${c.hairline}`, borderRadius: radius.md,
    boxShadow: shadow.e1, padding: pad,
    ...(accentEdge ? { borderLeft: `2px solid ${c.accent}` } : {}),
    ...style,
  };
  if (interactive) {
    return (
      <motion.div
        onClick={onClick}
        className={`atlas-card-int ${className}`}
        variants={hoverLift} initial="rest" whileHover="hover" whileTap="tap"
        style={{ ...base, cursor: "pointer" }}
        {...rest}
      >{children}</motion.div>
    );
  }
  return <div className={className} style={base} {...rest}>{children}</div>;
}

export function Divider({ vertical, style }) {
  return <div style={vertical
    ? { width: 1, alignSelf: "stretch", background: c.hairline, ...style }
    : { height: 1, width: "100%", background: c.hairline, ...style }} />;
}

// ────────────────────────────────────────────────────────────
//  Inputs
// ────────────────────────────────────────────────────────────
const inputBase = {
  width: "100%", boxSizing: "border-box", fontFamily: font.sans, fontSize: 14, color: c.text,
  background: c.surface2, border: `1px solid ${c.border}`, borderRadius: radius.sm, padding: "11px 14px",
};
// forwardRef so callers can focus programmatically (help chat autofocus, ⌘K search) — a plain
// function component silently drops the ref in React 18.
export const Input = React.forwardRef(function Input({ mono, style, className = "", ...rest }, ref) {
  return <input ref={ref} className={`atlas-input ${className}`} style={{ ...inputBase, ...(mono ? { fontFamily: font.mono, ...type.mono, fontSize: 14 } : {}), ...style }} {...rest} />;
});
export function TextArea({ style, rows = 4, ...rest }) {
  return <textarea rows={rows} className="atlas-input" style={{ ...inputBase, lineHeight: 1.6, resize: "vertical", ...style }} {...rest} />;
}
export function Field({ label, hint, children, htmlFor, style }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, ...style }}>
      {label && <label htmlFor={htmlFor} style={{ ...type.overline, color: c.text3 }}>{label}</label>}
      {children}
      {hint && <div style={{ ...type.caption, color: c.text3, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}
export function Select({ value, onChange, options, style, ...rest }) {
  return (
    <div style={{ position: "relative", ...style }}>
      <select
        value={value} onChange={onChange} className="atlas-input"
        style={{ ...inputBase, appearance: "none", paddingRight: 34, cursor: "pointer", fontFamily: font.mono, fontSize: 13 }}
        {...rest}
      >
        {options.map(o => typeof o === "string"
          ? <option key={o} value={o} style={{ background: c.surface2, color: c.text }}>{o}</option>
          : <option key={o.value} value={o.value} style={{ background: c.surface2, color: c.text }}>{o.label}</option>)}
      </select>
      <svg width="12" height="12" viewBox="0 0 12 12" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
        <path d="M2 4l4 4 4-4" stroke={c.text3} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  SegmentedControl (sliding indicator via shared layout)
// ────────────────────────────────────────────────────────────
export function SegmentedControl({ value, onChange, options, size = "md", style }) {
  const id = useRef("seg" + Math.random().toString(36).slice(2)).current;
  const padY = size === "sm" ? 6 : 8;
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, background: c.surface2, border: `1px solid ${c.hairline}`, borderRadius: radius.sm, ...style }}>
      {options.map(o => {
        const val = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        const on = value === val;
        return (
          <button key={val} onClick={() => onChange(val)} className="atlas-btn atlas-tab" aria-pressed={on}
            style={{ position: "relative", border: "none", background: "transparent", cursor: "pointer",
              padding: `${padY}px 14px`, borderRadius: radius.xs, fontFamily: font.sans, fontWeight: on ? 600 : 500,
              fontSize: size === "sm" ? 12.5 : 13.5, color: on ? c.text : c.text3, whiteSpace: "nowrap" }}>
            {on && <motion.div layoutId={id} transition={MOT.spring}
              style={{ position: "absolute", inset: 0, background: c.surface3, border: `1px solid ${c.border}`, borderRadius: radius.xs, boxShadow: shadow.e1, zIndex: 0 }} />}
            <span style={{ position: "relative", zIndex: 1 }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  Tabs (underline, sliding indicator)
// ────────────────────────────────────────────────────────────
export function Tabs({ value, onChange, items, style }) {
  const id = useRef("tabs" + Math.random().toString(36).slice(2)).current;
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${c.hairline}`, overflowX: "auto", ...style }}>
      {items.map(it => {
        const val = typeof it === "string" ? it : it.value;
        const label = typeof it === "string" ? it : it.label;
        const on = value === val;
        return (
          <button key={val} onClick={() => onChange(val)} className="atlas-btn atlas-tab" aria-pressed={on}
            style={{ position: "relative", border: "none", background: "transparent", cursor: "pointer",
              padding: "10px 14px", fontFamily: font.sans, fontWeight: on ? 600 : 500, fontSize: 13.5,
              color: on ? c.text : c.text3, whiteSpace: "nowrap", flexShrink: 0 }}>
            {label}
            {on && <motion.div layoutId={id} transition={MOT.spring}
              style={{ position: "absolute", left: 8, right: 8, bottom: -1, height: 2, background: c.accent, borderRadius: 2 }} />}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  Badge / Tag / Chip
// ────────────────────────────────────────────────────────────
const TONES = {
  neutral:  { bg: c.surface2, fg: c.text2, bd: c.border },
  accent:   { bg: c.accentSoft, fg: c.accent, bd: c.accentBorder },
  positive: { bg: c.positiveSoft, fg: c.positive, bd: "rgba(61,220,132,0.30)" },
  negative: { bg: c.negativeSoft, fg: c.negative, bd: "rgba(255,92,92,0.30)" },
  warning:  { bg: c.warningSoft, fg: c.warning, bd: "rgba(251,184,69,0.30)" },
};
export function Badge({ children, tone = "neutral", style }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: radius.xs,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, fontFamily: font.sans, fontWeight: 600, fontSize: 11.5, ...style }}>
      {children}
    </span>
  );
}
export function Tag({ children, style }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: radius.xs,
      background: c.accentSoft, color: c.accent, border: `1px solid ${c.accentBorder}`,
      fontFamily: font.mono, fontWeight: 500, fontSize: 10.5, letterSpacing: "0.04em", textTransform: "uppercase", ...style }}>
      {children}
    </span>
  );
}
// Action call chip (Buy / Hold / Sell …) — tone derived from action color
export function CallChip({ action, style }) {
  if (!action) return null;
  const a = action.toLowerCase();
  const tone = a.includes("buy") || a === "add" ? "positive" : a.includes("sell") || a.includes("avoid") ? "negative" : a.includes("trim") ? "warning" : "neutral";
  return <Badge tone={tone} style={{ textTransform: "uppercase", letterSpacing: "0.03em", fontSize: 10.5, ...style }}>{action}</Badge>;
}

// ────────────────────────────────────────────────────────────
//  AnimatedNumber (count-up, reduced-motion aware)
// ────────────────────────────────────────────────────────────
export function AnimatedNumber({ value, format, duration = MOT.data, style }) {
  const [display, setDisplay] = useState(value || 0);
  const reduce = useReducedMotion();
  const prev = useRef(value || 0);
  useEffect(() => {
    const target = value || 0;
    if (reduce) { setDisplay(target); prev.current = target; return; }
    const controls = animate(prev.current, target, {
      duration, ease: MOT.easeOut, onUpdate: v => setDisplay(v),
    });
    prev.current = target;
    return () => controls.stop();
  }, [value, reduce, duration]);
  return <span style={style}>{format ? format(display) : Math.round(display)}</span>;
}

// ────────────────────────────────────────────────────────────
//  ScoreRing (animated gauge + count-up + grade)
// ────────────────────────────────────────────────────────────
export function ScoreRing({ score, size = 168, stroke = 9, color, showGrade, sub }) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2 - 4;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, score || 0)) / 100;
  const col = color || (score == null ? c.text3 : scoreColor(score));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={c.surface2} strokeWidth={stroke} />
        <motion.circle
          cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: reduce ? circ * (1 - p) : circ }}
          animate={{ strokeDashoffset: circ * (1 - p) }}
          transition={{ duration: 0.6, ease: MOT.easeOut }}
          style={{ filter: `drop-shadow(0 0 6px ${col}66)` }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: font.sans, fontWeight: 600, fontVariantNumeric: "tabular-nums", fontSize: size * 0.3, color: col, lineHeight: 1 }}>
          {score != null ? <AnimatedNumber value={score} /> : "—"}
        </div>
        {showGrade && score != null && <div style={{ ...type.overline, color: col, marginTop: 4 }}>{grade(score)}</div>}
        {sub && <div style={{ ...type.overline, color: c.text3, marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}
// Pillar / metric bar
export function MeterBar({ score, color, height = 5 }) {
  const col = color || scoreColor(score);
  const w = Math.max(0, Math.min(100, score || 0));
  return (
    <div style={{ height, background: c.surface2, borderRadius: 99, overflow: "hidden" }}>
      <motion.div initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.6, ease: MOT.easeOut }}
        style={{ height: "100%", background: col, borderRadius: 99 }} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  StatTile
// ────────────────────────────────────────────────────────────
export function StatTile({ label, value, delta, deltaTone, hint, style }) {
  return (
    <div style={{ background: c.surface2, border: `1px solid ${c.hairline}`, borderRadius: radius.sm, padding: "13px 15px", minWidth: 120, ...style }}>
      <div style={{ ...type.caption, color: c.text3, marginBottom: 7 }}>{label}</div>
      <div style={{ ...type.data, fontSize: 20, fontWeight: 600, color: c.text }}>{value}</div>
      {delta != null && <div style={{ ...type.caption, color: deltaTone === "negative" ? c.negative : deltaTone === "positive" ? c.positive : c.text3, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{delta}</div>}
      {hint && <div style={{ ...type.caption, color: c.text3, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  MetricTable
// ────────────────────────────────────────────────────────────
export function MetricTable({ title, items = [], style }) {
  if (!items.length) return null;
  return (
    <div style={{ ...style }}>
      {title && <Overline color={c.accent} style={{ marginBottom: 8 }}>{title}</Overline>}
      <div style={{ border: `1px solid ${c.hairline}`, borderRadius: radius.sm, overflow: "hidden" }}>
        {items.map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16,
            padding: "9px 14px", background: i % 2 ? "transparent" : c.surface2,
            borderBottom: i < items.length - 1 ? `1px solid ${c.hairline}` : "none" }}>
            <span style={{ ...type.small, color: c.text3 }}>{m.label}</span>
            {/* minWidth 0 + overflowWrap: AI-written values can contain long unbreakable tokens
                (ranges, big numbers) — the box's overflow:hidden would clip them; this wraps them. */}
            <span style={{ ...type.mono, color: m.value === "N/A" ? c.text3 : c.text, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  Sparkline
// ────────────────────────────────────────────────────────────
export function Sparkline({ data = [], width = 96, height = 28, stroke, animate: doAnimate = true }) {
  const reduce = useReducedMotion();
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [ (i / (data.length - 1)) * width, height - ((v - min) / span) * (height - 4) - 2 ]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  const col = stroke || (up ? c.positive : c.negative);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <motion.path d={d} fill="none" stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        initial={doAnimate && !reduce ? { pathLength: 0, opacity: 0 } : false}
        animate={doAnimate && !reduce ? { pathLength: 1, opacity: 1 } : {}}
        transition={{ duration: 0.5, ease: MOT.easeOut }} />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
//  Tooltip (hover + focus)
// ────────────────────────────────────────────────────────────
export function InfoTip({ title, body, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
      {children}
      <span tabIndex={0} role="button" aria-label={title}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15,
          borderRadius: "50%", border: `1px solid ${c.border}`, fontFamily: font.sans, fontSize: 9, fontWeight: 700,
          color: c.text3, cursor: "help", flexShrink: 0, lineHeight: 1 }}>?</span>
      <AnimatePresence>
        {open && (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14 }}
            style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
              width: 250, background: c.surface3, border: `1px solid ${c.border}`, borderRadius: radius.sm,
              padding: "10px 12px", zIndex: z.toast, boxShadow: shadow.e3, pointerEvents: "none" }}>
            <span style={{ display: "block", ...type.caption, color: c.accent, marginBottom: 4 }}>{title}</span>
            <span style={{ display: "block", ...type.caption, fontWeight: 400, color: c.text2, lineHeight: 1.5 }}>{body}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

// ────────────────────────────────────────────────────────────
//  Spinner / Skeleton
// ────────────────────────────────────────────────────────────
export function Spinner({ size = 18, color }) {
  return (
    <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%",
      border: `2px solid ${color ? "rgba(255,255,255,0.25)" : c.border}`, borderTopColor: color || c.accent,
      animation: "atlas-spin .7s linear infinite", flexShrink: 0 }} />
  );
}
export function Skeleton({ width = "100%", height = 14, radius: rad = radius.xs, style }) {
  return (
    <div style={{ width, height, borderRadius: rad,
      background: `linear-gradient(90deg, ${c.surface2} 0px, ${c.surface3} 200px, ${c.surface2} 400px)`,
      backgroundSize: "800px 100%", animation: "atlas-shimmer 1.4s linear infinite", ...style }} />
  );
}
export function LoadingBlock({ title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "44px 0 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <Spinner size={24} />
      <div style={{ ...type.body, color: c.text2 }}>{title}</div>
      {sub && <div style={{ ...type.caption, color: c.text3 }}>{sub}</div>}
    </div>
  );
}
export function ErrorBanner({ msg, onRetry, label = "Retry" }) {
  return (
    <div style={{ marginTop: 14, background: c.negativeSoft, border: `1px solid rgba(255,92,92,0.32)`, borderRadius: radius.sm,
      padding: "12px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <span style={{ ...type.small, color: c.negative, flex: "1 1 220px" }}>{msg}</span>
      {onRetry && <Button variant="danger" size="sm" onClick={onRetry}>{label}</Button>}
    </div>
  );
}
export function EmptyState({ title, hint, icon, action }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {icon && <div style={{ color: c.text3 }}>{icon}</div>}
      <div style={{ ...type.heading, color: c.text }}>{title}</div>
      {hint && <div style={{ ...type.body, color: c.text3, maxWidth: 420, lineHeight: 1.6 }}>{hint}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  Overlays — Modal (centered) & SlideOver (right sheet)
// ────────────────────────────────────────────────────────────
// Shared dialog behavior: Escape closes, background scroll locks, and focus moves into the
// panel on open (with restore to the opener on close) — the pieces keyboard and screen-reader
// users need that a bare scrim-click can't provide.
function useDialogBehavior(open, onClose, panelRef) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prevFocus = document.activeElement;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus({ preventScroll: true });
    };
  }, [open, onClose, panelRef]);
}

export function Modal({ open, onClose, children, width = 560, style }) {
  const panelRef = useRef(null);
  useDialogBehavior(open, onClose, panelRef);
  return (
    <AnimatePresence>
      {open && (
        <motion.div {...scrim} onClick={onClose}
          style={{ position: "fixed", inset: 0, zIndex: z.modal, background: c.scrim, backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <motion.div {...sheetPresence} onClick={e => e.stopPropagation()}
            ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1}
            style={{ width: "100%", maxWidth: width, maxHeight: "85vh", overflowY: "auto", outline: "none",
              background: c.surface1, border: `1px solid ${c.border}`, borderRadius: radius.lg, boxShadow: shadow.e3,
              padding: 24, ...style }}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export function SlideOver({ open, onClose, children, width = 560 }) {
  const panelRef = useRef(null);
  useDialogBehavior(open, onClose, panelRef);
  return (
    <AnimatePresence>
      {open && (
        <motion.div {...scrim} onClick={onClose}
          style={{ position: "fixed", inset: 0, zIndex: z.modal, background: c.scrim, backdropFilter: "blur(4px)", display: "flex", justifyContent: "flex-end" }}>
          <motion.div {...slideOver} onClick={e => e.stopPropagation()}
            ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1}
            style={{ width: `min(${width}px, 100%)`, height: "100%", background: c.surface1, borderLeft: `1px solid ${c.border}`,
              boxShadow: shadow.e3, overflowY: "auto", outline: "none" }}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { motion, AnimatePresence };
