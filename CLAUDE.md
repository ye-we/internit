# CLAUDE.md

Context for Claude Code working on this project. Read fully before writing code.

## What this is

An internship aggregator for Ethiopian social-studies students — political science, IR, governance, peace and conflict, human rights, sociology, development studies. ethiongojobs is ad-infested and hard to read; no one filters Ethiopian internship listings by field for undergrads.

**Audience**: senior-year undergrads in Ethiopian universities studying social sciences.

**Distribution**: Telegram channel (broadcast, editorial card images) + Telegram bot (deadline reminders, personal saves). The website is the canonical reader-mode view; Telegram is where users actually live.

**Not in scope**: general Ethiopian job board, application tracking, CV review, jobs outside the social-studies cluster, senior roles requiring years of experience. Web accounts exist (Better Auth) but only for bookmarks — Telegram remains the primary identity layer.

## Stack

Turborepo monorepo, TypeScript everywhere. Open source (MIT), deployed via PM2 (`ecosystem.config.cjs` — three processes: web, bot, worker).

```
apps/
  web/          SvelteKit (adapter-node) + Tailwind + Drizzle, direct DB access
  bot/          telegraf — commands, channel auto-post, deadline reminders
  worker/       croner — nightly scrape pipeline, spawns CLI steps as child processes
packages/
  db/           Drizzle schema + migrations, PostgreSQL
  shared/       Zod schemas, types, keyword lists
  scraper/      cheerio-based; sources/ (bespoke) + adapters/ (ATS auto-detect)
  classifier/   keyword tier + LLM fallback field classification
  card/         satori + resvg — renders channel-post card PNGs
```

There is no separate API server (the Hono app is gone) — the web app talks to Postgres directly through server routes. Cheerio for scraping; don't reach for Playwright. A `BrowserChallengeError` marks JS-walled hosts; skip them.

**Env**: all processes read the **monorepo root `.env` only** (vite envDir / `--env-file` / dotenv). Per-app `.env` files are dead. `.env.example` is the canonical var list — keep it in sync when adding vars.

## UI style — non-negotiable

Editorial, not SaaS. Same language as ScholarXIV.

- **Palette**: `--ink` (near-black primary text), `--em` (mid-gray secondary), `--paper` (off-white background). Strict. No accent colors unless absolutely needed.
- **Typography**: Inter 900 for display, DM Serif Display for editorial moments, Inter 400/500 for body.
- **No bullshit**: no gradients, no glassmorphism, no shimmer, no soft drop shadows. Hairline borders, generous whitespace, dense readable text.
- **Density**: the board favors information density. Each card shows org, role, deadline (days-remaining badge if <14), field tags, location, paid/unpaid badge, snippet.
- **Reader mode is the product** — but it lives *inside the board*: there is no `/listing/:id` page. Selecting a listing (or a `/?listing=<id>` deep link from the channel) opens the full cleaned posting in the board. Structured listings render the tidy `raw.structured.data` sections; unstructured ones fall back to sanitized `description_html`.
- **Mobile-first**. Aggressive caching, small bundle.

## Data model (Drizzle, packages/db/src/schema.ts)

Core tables:

- `listings` — the aggregate. Notables beyond the obvious: `applyUrl` (direct ATS link parsed out of the posting body; `sourceUrl` stays the attribution link), `fitScore` 0–100, `status` `'active' | 'expired' | 'hidden'`, `postedToChannel` (channel dedup), `raw` jsonb (holds `raw.structured.data` — the structurer's cleaned reader-mode output). Unique on `source_url`.
- `orgs` — the curated directory (seeded from `orgs-seed.csv`): category, region, contact/careers URLs, `posts_publicly`, `scrape_priority`, notes.
- `subscribers` — Telegram bot users: `chat_id` (PK), `filters` jsonb, `saved_listing_ids` (capped at 50 in code), `notify_24h/72h`.
- `scrape_runs` — per-source run log.
- `page_events` — first-party cookieless analytics (daily-rotating sha256 visitor hash, GeoIP country, never raw IP). Written server-side (pageviews), via the `/api/track` beacon (listing views, apply clicks), and by the bot for Telegram-side events (`apps/bot/src/track.ts`).
- better-auth tables (`user`, `session`, `account`, `verification`) + `bookmarks`, `reminders` — web-side saves. Property names must match better-auth's field names or the adapter breaks.

## Scraping

Two mechanisms in `packages/scraper`:

- **`sources/`** — bespoke scrapers for known boards: `ethiongojobs`, `ehrdc`, `undp`, `un-careers`.
- **`adapters/` + `dispatch.ts`** — generic ATS detection by careers URL: greenhouse, lever, workday, smartrecruiters, successfactors, oracle-hcm, wordpress, reliefweb, idealist, inspira, generic-html. `run-orgs.ts` walks the orgs table and dispatches each careers URL to the matching adapter.

Pipeline (worker, 12:00 EAT daily — off Gemini's US-peak 503 window; override `WORKER_CRON`): scrape → dedup → prune-expired → structure. A separate cleanup cron (every 3h) deactivates past-deadline listings fast. Each step is a child process with a timeout; optional Healthchecks.io dead-man's-switch.

**Structurer** (`structure.ts`, gated by `STRUCTURER_ENABLED`): Gemini flash-lite turns raw postings into `raw.structured.data` (summary, sections, requirements, repaired deadline/pay, `application_url`, `ethiopia_access`). All LLM output is Zod-validated (`StructuredListingSchema`); `llm-extract.ts` additionally requires quoted evidence to appear verbatim in the source text before trusting deadline/pay.

### Politeness — non-negotiable

- One request every 3–5 seconds per host (PoliteFetcher serializes per origin), daily batch, never per page load.
- robots.txt respected (`SCRAPER_IGNORE_ROBOTS=1` is a local-dev escape hatch only; `skipRobots` is only for documented public JSON APIs).
- User-Agent identifies the bot and links a real contact page (built from `SITE_URL/about`, falls back to the GitHub repo).
- Always preserve and display the source URL with attribution.

## Field classification

The core IP. A listing is shown only if it passes the social-studies filter. Keyword lists live in `packages/shared` (`INCLUDE_KEYWORDS` / `EXCLUDE_KEYWORDS` / `FIELD_TAGS`).

- **Tier 1 keyword check** (sync, free, every listing): include-terms hit and no exclude-terms → include, scored up to 95. Exclude-terms only → out.
- **Tier 2 LLM fallback** for ambiguous listings (both or neither): Gemini flash-lite when `GEMINI_API_KEY` is set, else Claude Haiku. Tight prompt returning `{ fits, fields[], fit_score, reason }`; output clamped/normalized before use. If the LLM is unavailable, ambiguous-with-include-matches falls back to fit 60.

**fit_score guide**: 90–100 bullseye (election support, governance research) · 70–89 strong (dev policy, advocacy comms) · 50–69 adjacent (digital rights, comms at an HR org) · <50 don't show.

## Telegram bot

**Channel** (broadcast, every 15 min): new `active` listings with `fit_score ≥ 70` and `postedToChannel = false` auto-post as a rendered card image (packages/card) + lean HTML caption: org, title, one-line summary, deadline, Read (`SITE_URL/?listing=<id>&ref=tg`) · Apply · Source links, plus a "remind me" deep-link button. English only, restrained emoji. Failed posts with a Telegram 400 are quarantined (marked posted) so a poison listing can't stall the queue.

**Bot commands**: `/start` (also handles `save_<id>` deep links), `/save <id>`, `/saved`, `/filter` (read-only for now), `/orgs` (cold-outreach directory), `/digest` (stub), `/help`, `/test_card` (admin-only, gated by `ADMIN_CHAT_ID`). Deadline reminders: cron every 6h, DMs at 24h/72h before deadline in 3h windows.

Long polling, no webhook. Single process, separate from web. `repost.ts` is an operator CLI.

## Web app (SvelteKit)

- `/` — the board: top-50 active listings + filter UI + in-board reader mode. `/?listing=<id>` deep links fetch and focus a listing (hidden ones excluded).
- `/orgs` — cold-outreach directory from the orgs table.
- `/saved`, `/sign-in`, `/sign-up` — Better Auth (email/password + optional Google) for bookmarks only.
- `/analytics` — admin-only dashboard (`user.role = 'admin'`, 404 otherwise) over `page_events`.
- `/api/track` — rate-limited beacon (60/min/IP) for listing-view and apply-click events.

State: URL search params for filters — shareable links matter. No `/login` walls on content, ever.

## Security conventions (hold these in review)

- Scraped content is **attacker-controlled**. HTML renders only through the double pipeline: scraper-side `cleanDescriptionHtml` allowlist, then server-side DOMPurify before the single `{@html}` in the board.
- Any URL that reaches an `href` or a Telegram link must be gated `^https?://` — the shared `StructuredListingSchema` nulls non-http(s) `application_url`, and render sites gate again.
- Telegram output: everything user- or scraper-derived goes through `escapeHtml` (which also escapes `"` — strings land inside `href="..."`).
- All LLM output is Zod-validated before DB writes. All queries use Drizzle builders or parameterized `sql``` templates.
- `BETTER_AUTH_SECRET` is required at startup (the app throws without it); PM2 sets `NODE_ENV=production`.
- Security headers are set in `hooks.server.ts` (no `script-src` in the CSP — SvelteKit inline hydration; tighten at the proxy).
- Never read `x-forwarded-for` directly — use `getClientAddress()` (adapter-node `ADDRESS_HEADER` is the deploy-side opt-in).

## Seed data

`orgs-seed.csv` — 231 manually curated orgs across UN, AU, regional bodies, think tanks, human rights orgs, election/democracy orgs, INGOs, bilateral cooperation, embassies, foundations, and government ministries. Orgs with `posts_publicly=no|sometimes` power the directory page — that list is itself a feature. Rows marked `verification_needed=yes` need URL validation: `pnpm verify-orgs` batch-checks websites and writes `orgs-verified.csv` (gitignored). Run before launch and monthly.

## Legal and ethical

- **Attribution**: every card and reader view links back to the source with the name visible. ethiongojobs gets named credit.
- **Public content only**: no paywalled scraping. Store HTML once, render from cache.
- **CSO safety**: EHRCO/EHRDC listings may carry political risk after the 2024 ACSO suspension. Show them, but with contextual notes so students apply with eyes open. `status='hidden'` listings must never resolve — not by UUID deep link, not via `/save`.
- **Analytics privacy**: cookieless, daily-rotating hash, country-level geo only, raw IP never stored.

## Commands cheat sheet

```
pnpm run dev                                  # web + bot + worker via turbo
pnpm run typecheck / build / lint             # turbo, all workspaces
pnpm db:generate / db:migrate / db:seed
pnpm --filter @internit/worker run-now        # run the pipeline once
pnpm --filter @internit/scraper scrape:orgs   # (see scraper package.json for more)
pnpm verify-orgs
```
