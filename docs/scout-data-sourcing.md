# Scout — Data Sourcing Decision (Stage 0)

**Status:** investigation complete, nothing implemented. **Date:** 2026-08-24.
**Scope:** quantitative screen of all US + Western-European listed companies under $600m market cap, refreshed weekly, personal use, free-first.
**Verification basis:** all provider claims checked against live docs/pricing pages on 2026-08-24 (not training data); SEC EDGAR claims verified with real API probes; FMP screener tier-gating independently re-verified twice the same day. Reference artifact: https://claude.ai/code/artifact/d6f94091-0674-4dd7-82d8-bb86f5f12914

## Recommendation

Build free-first on **EDGAR + Yahoo (already integrated in Atlas) + a free Finnhub key** for US universe enumeration. Buy nothing for Stage 1. The one field money can't reasonably buy — European director dealings — is dropped for Stage 1 (revisit if the screen proves out). EODHD All-In-One ($99.99/mo, cancellable monthly) is the pre-identified escape hatch if Yahoo hard-blocks.

**Ownership framing (design principle): Yahoo = ownership LEVELS, EDGAR Form 4 = buying FLOW.**
`heldPercentInsiders` / `heldPercentInstitutions` come from the Yahoo quoteSummary payload the existing fundamentals route already fetches (US and EU alike). EDGAR Form 4 supplies recent insider transactions. **No 13F pipeline anywhere in this design.**

## What Atlas already has

| Route | Upstream | Scout-relevant | Per-user limit |
|---|---|---|---|
| `/api/fundamentals` | SEC EDGAR XBRL (primary) + Yahoo quoteSummary v10 (crumb/cookie) | Quarterly revenue/income/EPS 8–18yr (tag-merge + first-filed restatement discipline already solved); P/E, P/B, growth, dividends, surprises | 100/min, CDN 1h |
| `/api/history` | Yahoo chart v8 | EOD/intraday prices incl. EU suffixes, extended-session quotes | 600/min, CDN 30s |
| `/api/lookup` | Yahoo search v1 | Symbol resolution (6 results — not a screener) | 120/min, CDN 1h |
| `/api/news`, `/api/fx` | Yahoo search + CNBC RSS; frankfurter.app | Per-ticker headlines; ECB FX | 50/min; 30/min |

No paid market-data keys exist; the only secret is `ANTHROPIC_API_KEY`. The lone FMP reference is a keyless logo-image URL (`src/App.jsx` HoldingRow).

**Unexploited payload:** the quoteSummary modules already requested (`defaultKeyStatistics`, `financialData`, `summaryDetail`) contain, un-extracted: insider ownership %, institutional ownership %, analyst count (`numberOfAnalystOpinions`), gross/operating margins, total cash, total debt — for EU listings too (.PA .AS .BR .LS .L .DE .F .ST .HE .CO .OL). Six of nine required field groups already flow through the existing route.

## Provider verdicts (free tiers, verified 2026-08-24)

- **FMP — rejected.** Free tier is a demo-symbol sandbox: ~85–205 whitelisted tickers, annual-only statements, 250 EOD calls/day, 500MB/30d bandwidth, **no screener access at all**. Re-verified directly on the live pricing table (second pass, same day): the Stock Screener row has **no cell in the Basic column**; tier icons read Starter = "Symbol Limited to US Exchanges", Premium = "US, UK, and Canada", Ultimate = "Full Global Coverage". Non-US screening requires Ultimate ($99/mo annual, $139 monthly). Legacy v3 endpoints closed to new signups (`/stable/*` only). No European director-dealing data at any tier.
- **Finnhub — adopted for the US universe leg only.** Free tier: 60 calls/min, 30/s burst, **no daily cap**, but US symbols only (EU symbols 403 on free keys). Usable free: `/stock/symbol` (US list), `/stock/profile2` (market cap), `/stock/metric` (TTM margins/growth), `/stock/financials-reported` (quarterly as-reported), `/stock/insider-transactions` (US), `/stock/recommendation`. No screener endpoint exists. Paid: the old ~$50 personal all-in-one is gone — now $3,500/mo all-in-one, or modular **$50/mo per market** for fundamentals (LSE+XETRA+Euronext+Nordics ≈ $200–500/mo; "market" granularity is behind a login wall — verify before ever paying).
- **EODHD — reserve option.** Free tier unusable (20 calls/day, no fundamentals). Best European coverage of the three when paid (Euronext PA/AS/BR/LS, LSE direct contract, XETRA/Frankfurt, ST/HE/CO/OL). Workable config is **All-In-One $99.99/mo ($83.33 annual)** — the screener (5 calls/req) is not in the $59.99 Fundamentals plan. Weekly refresh ≈ 21k of 100k daily calls. Insider data US Form 4 only even paid. Caveat: names missing a filtered field are silently excluded from screens.
- **SEC EDGAR direct — adopted for US insiders (and already primary for US fundamentals).** Fair use 10 req/s, no daily cap, User-Agent mandatory (403 without). Form 4 chain verified end-to-end on a real filing: insider name, role flags, officer title, date, transaction code, shares, price, shares-after — stable XML. Weekly batch via **daily index files: ~60–210 requests for a 1,500-name watchlist** (vs ~1,550 polling submissions per-company). Filter to codes P/S; down-weight F/M/A/G. Bulk backfill: `submissions.zip` (~1.56GB, nightly).

## Architecture (on paper)

```
US universe    EDGAR company_tickers.json (1 req) + Finnhub /stock/symbol (1 req)
               → mcap via Finnhub profile2 → filter < $600m
EU universe    official exchange instrument files: Euronext · LSE · Deutsche Börse ·
               Nasdaq Nordic · Oslo Børs (5–8 downloads, free)
               → mcap via Yahoo quoteSummary (existing route) → filter
Fundamentals   existing /api/fundamentals, extraction extended (margins, cash,
               debt, heldPercent*, analyst count) — US: EDGAR-primary · EU: Yahoo
US insiders    EDGAR daily-index Form 4 batch (new route, ~60–210 req/wk)
EU insiders    dropped in Stage 1 (see pay-or-drop)
AI dossiers    existing dossier path, cached until next earnings date
```

### Firestore caching

| Store | Shape | Refresh |
|---|---|---|
| `scout_universe/{region}` | one doc per region: [{ticker, name, exchange, mcap}] — ~2,000 rows ≈ 150KB, under the 1MB doc cap | weekly (sharded); full rebuild monthly |
| `scout_fundamentals/{ticker}` | {data, fetchedAt, source} — screen survivors only | weekly if fetchedAt > 6 days |
| `scout_insiders/{ticker}` | {transactions[], fetchedAt} — Form 4 P/S rows | weekly batch append |
| dossier cache | existing research-history entries; freshUntil = next earnings date (already available in earningsHistory) | on demand |
| `scout_refresh_state` | {shard, index, pausedAt, reason} + per-shard lastCompletedAt heartbeats | continuous |

### Weekly call budget (free-first)

| Step | Calls | Against | Fits free? |
|---|---|---|---|
| US universe (~1,500 survivors) | ~1,500 | Finnhub 60/min, no daily cap | yes (~25 min, sharded) |
| EU universe (~800 survivors) | 5–8 files + ~800 | Yahoo, paced (see below) | yes |
| Fundamentals for ~300 screen survivors | ~600 | Yahoo + EDGAR via existing route | yes |
| Form 4 weekly batch | ~60–210 | SEC 10/s | yes |
| **Total** | **~3,200–3,900/wk** | smeared across the week | **yes** |

Firestore free tier (20k writes/day) absorbs the ~2–3k weekly writes. Vercel function timeouts make a serverless batch runner a poor fit — the batch runs client-side or as a local scheduled job.

## Yahoo burst-mitigation spec (a blocked batch fails silently — designed out now)

1. **Smear.** No weekly burst: shard the universe by `hash(ticker) % 7` → weekday; each day refreshes ~1/7 (~330 names ≈ 6–8 min). The screen always computes from cache; per-name `fetchedAt` defines staleness, not a global refresh date.
2. **Jitter.** ≤1 request / 1.2s with ±0–800ms random jitter; randomize the daily start within an hour window. Never parallelize Yahoo calls.
3. **Stale-only.** Skip names with `fetchedAt` < 6 days (universe caps: < 20h). Names drifting out of the sub-$600m band demote to monthly rechecks rather than churning the fetch list.
4. **Circuit breaker + resume.** Refusal signals: HTTP 429/403/999, crumb-fetch failure, empty quoteSummary with error body. After **3 consecutive** refusals: stop immediately, persist cursor to `scout_refresh_state` (shard, index, pausedAt, reason), resume from cursor after 30 min → 2h → next day (give up for the day after 3 failed resumes). Single failures: one per-name retry, then skip with `fetchFailedAt`.
5. **Visibility.** Every shard run writes a `lastCompletedAt` heartbeat. Scout UI shows a "data X days stale" banner (pause reason verbatim) once the oldest heartbeat exceeds 9 days — blockage surfaces as a banner, never as silently missing data.

## Pay-or-drop ledger

| Field | Cheapest unlock | Price | Call |
|---|---|---|---|
| EU director dealings (MAR Art. 19) | Finnhub Fundamental-1, per market | $50/mo × market (≈$200–500/mo across LSE+XETRA+Euronext+Nordics) | **DROP for Stage 1.** No free API exists anywhere; freemium sites (insiderscreener, Tracefour) aren't APIs; scraping 5+ national regulators is the only free path. |
| Insider / institutional ownership % | — | $0 | **Solved free** via Yahoo heldPercent fields (levels). EU provenance is indicative-quality — acceptable for a screen. No 13F work. |
| Single-provider safety net (screener + EU fundamentals) | EODHD All-In-One | $99.99/mo (monthly, cancellable) | **Hold in reserve** — switch on only if Yahoo hard-blocks. |
| Clean standardized EU quarterly statements | EODHD Fundamentals $59.99 / Finnhub $50/market | — | Partly moot: many EU small caps report **semi-annually** — quarterly burn precision is structurally limited in Europe at any price. Score with nulls. |

## Risks

- **Yahoo is unofficial** and load-bearing for the EU leg (and all of Atlas). Crumb flow breaks occasionally (fixable); hard IP block is the tail risk — hence the mitigation spec and the EODHD reserve.
- **EU small-cap data is structurally thinner everywhere** (semi-annual reporting, sparse analyst fields). Score with nulls; don't drop rows — even $100/mo providers silently exclude thin names from filtered screens.
- **Survivor count drives cost linearly.** Budget assumes ~300 names get full fundamentals; 1,000+ survivors still fit free, just slower.
- **gettex** isn't covered by any evaluated provider; key German names to XETRA listings.
