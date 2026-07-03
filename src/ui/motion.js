// ============================================================
//  ATLAS · motion presets (Framer Motion variants)
//  Fast & intentional: 150–250ms, no decorative bounce.
//  All transforms respect prefers-reduced-motion via <MotionConfig>.
// ============================================================
import { motion as M } from "./tokens.js";

// page / route presence — fade + small rise
export const pagePresence = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: M.slow, ease: M.easeOut } },
  exit:    { opacity: 0, y: -6, transition: { duration: M.fast, ease: M.easeIn } },
};

// staggered list container — children rise in sequence (first ~8 feel snappy)
export const staggerParent = {
  initial: {},
  animate: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
};
export const staggerChild = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: M.base, ease: M.easeOut } },
};

// simple fade+rise for single elements
export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: M.base, ease: M.easeOut } },
};

// hover lift for interactive cards
export const hoverLift = {
  rest:  { y: 0 },
  hover: { y: -2, transition: { duration: M.fast, ease: M.easeOut } },
  tap:   { scale: 0.99 },
};

// press feedback for buttons
export const pressable = {
  whileHover: { scale: 1.0 },
  whileTap:   { scale: 0.97, transition: { duration: 0.08 } },
};

// sheet / modal — scale + fade from source
export const sheetPresence = {
  initial: { opacity: 0, scale: 0.97, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: M.base, ease: M.easeOut } },
  exit:    { opacity: 0, scale: 0.98, y: 6, transition: { duration: M.fast, ease: M.easeIn } },
};
export const slideOver = {
  initial: { x: "100%" },
  animate: { x: 0, transition: { duration: M.slow, ease: M.easeOut } },
  exit:    { x: "100%", transition: { duration: M.base, ease: M.easeIn } },
};
export const scrim = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: M.base } },
  exit:    { opacity: 0, transition: { duration: M.fast } },
};
