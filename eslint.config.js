// Deliberately ONE rule: no-undef. An undefined bare identifier is a guaranteed runtime
// ReferenceError that `vite build` does NOT catch (bundlers don't resolve free identifiers) —
// this class shipped to prod twice, most recently when discoverSystemPrompt() was extracted to
// module scope while still referencing the component-scoped UNIVERSE_RULES, silently breaking
// every real Discover scan behind a green build. `npm run build` now runs this first, so an
// undefined identifier fails the Vercel build instead of throwing at call time in prod.
// This is NOT a style linter — don't add formatting/opinion rules here.
import globals from "globals";

export default [
  {
    files: ["src/**/*.{js,jsx}", "api/**/*.js", "vite.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    // The source carries a couple of pre-existing `eslint-disable react-hooks/exhaustive-deps`
    // directives (from editor tooling); the plugin isn't installed, and an unresolvable rule in
    // a directive is itself an error. A no-op stub lets those comments resolve without pulling
    // in the whole plugin this config deliberately doesn't run.
    plugins: { "react-hooks": { rules: { "exhaustive-deps": { create: () => ({}) } } } },
    rules: {
      "no-undef": "error",
    },
  },
];
