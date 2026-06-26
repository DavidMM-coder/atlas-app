# Verdict

A personalized AI stock-evaluation app. You build an investor profile, and Verdict
scores companies, recommends buys that fit you, and reviews your portfolio with
buy / hold / trim / add / sell calls.

> **Note:** Verdict is a research and education tool, **not investment advice**.
> Scores and picks are AI-generated estimates and can be wrong or out of date.

---

## What you need first

1. **Node.js 18 or newer** — https://nodejs.org (download the "LTS" version, install it).
2. **An Anthropic API key** — get one at https://console.anthropic.com.
   This is the developer Console, which is **separate from your Claude app subscription**
   and is billed per use. The app uses it to do its AI evaluations.

You don't have to type any commands yourself if you're using **Claude Code** — just
open this folder in it and tell it "run the app," and it will handle the steps below.

---

## Setup (one time)

1. Open this folder.
2. Make a copy of the file `.env.example` and name the copy exactly **`.env`**.
3. Open `.env` and paste your key after the `=`, like:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxx
   ```
4. Install dependencies (in a terminal, inside this folder):
   ```
   npm install
   ```

## Run it

```
npm run dev
```

Then open the address it prints (usually **http://localhost:5173**) in your browser.

The first screen is the onboarding questionnaire. After that you get the three
sections: **Discover**, **Portfolio**, and **Research**. Your profile and holdings
are saved in your browser between visits.

---

## How it's wired (for when you keep building)

- `src/App.jsx` — the entire app (UI, onboarding, scoring prompts, portfolio logic).
- `vite.config.js` — a small built-in proxy. The browser calls `/api/messages`; the
  proxy adds your API key and forwards to Anthropic. **Your key never reaches the
  browser** — it stays server-side, loaded from `.env`.
- The app's AI calls live in `src/App.jsx` in the functions `evaluate` (deep dossier),
  `discover` (recommendations), and `analyzePortfolio` (holdings review). Each sends a
  prompt to the proxy and parses the JSON that comes back.

### The most important next step
Right now the financial numbers come from the AI doing **live web research** on each
call. That's why it's slowish and why two runs can differ slightly. The big upgrade is
to plug in a **market-data provider** (e.g. Financial Modeling Prep, Finnhub, Polygon)
so the numbers are hard, instant, and consistent, with the AI only interpreting them.
That work would go in a new server-side function alongside the proxy in `vite.config.js`,
feeding clean data into the same prompts. Ask Claude Code to help you add it.

---

## Troubleshooting

- **"ANTHROPIC_API_KEY is not set"** in the app → you didn't create `.env`, or it's
  empty, or you need to stop and re-run `npm run dev` after adding it.
- **Nothing loads / blank page** → make sure you ran `npm install` first, then `npm run dev`.
- **AI calls fail** → check the key is valid and your Console account has billing set up.
