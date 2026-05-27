# CLAUDE.md

Context for Claude Code working on this project. Read fully before writing code.

## What this is

An internship aggregator for Ethiopian social-studies students — political science, IR, governance, peace and conflict, human rights, sociology, development studies. ethiongojobs is ad-infested and hard to read; no one filters Ethiopian internship listings by field for undergrads.

**Audience**: senior-year undergrads in Ethiopian universities studying social sciences.

**Distribution**: Telegram channel (broadcast) + Telegram bot (deadline reminders, personal saves). The website is the canonical reader-mode view; Telegram is where users actually live.

**Not in scope**: general Ethiopian job board, accounts/profiles beyond Telegram chat_id, application tracking, CV review, jobs outside the social-studies cluster, senior roles requiring years of experience.

## Stack

Turborepo monorepo, TypeScript everywhere.

```
apps/
  web/          React + Vite + Tailwind (frontend)
  api/          Hono (backend, scraping, bot)
packages/
  db/           Drizzle schema + migrations, PostgreSQL
  shared/       Zod schemas, types, constants f
  scraper/      cheerio-based, one module per source
  classifier/   keyword + LLM fallback field classification
```

Cheerio for scraping — ethiongojobs is server-rendered WordPress, no JS rendering needed. Don't reach for Playwright.

## UI style — non-negotiable

Editorial, not SaaS. Same language as ScholarXIV.

- **Palette**: `--ink` (near-black primary text), `--em` (mid-gray secondary), `--paper` (off-white background). Strict. No accent colors unless absolutely needed.
- **Typography**: Inter 900 for display, DM Serif Display for editorial moments, Inter 400/500 for body.
- **No bullshit**: no gradients, no glassmorphism, no shimmer, no soft drop shadows. Hairline borders, generous whitespace, dense readable text.
- **Density**: list view favors information density. Each card shows org, role, deadline (days-remaining badge if <14), field tags, location, paid/unpaid badge, snippet.
- **Reader mode is the product**. The single biggest UX win over ethiongojobs is the cleaned-up full posting on one page, no ads, no clicks-through. Build this well.
- **Mobile-first**. Aggressive caching, small bundle, lazy-load images.

## Data model (Drizzle, packages/db/schema.ts)

```ts
listings: {
  id: uuid
  source: text                  // 'ethiongojobs' | 'undp' | etc
  source_url: text (unique)     // required for attribution
  source_id: text
  org_name: text
  org_slug: text                // FK to orgs.slug
  title: text
  location: text
  is_remote: boolean
  is_paid: boolean | null       // null when unclear; never invent
  stipend_text: text | null     // verbatim
  deadline: timestamp | null
  posted_at: timestamp
  scraped_at: timestamp
  description_html: text        // cleaned for reader-mode
  description_text: text        // for search/classification
  field_tags: text[]
  fit_score: integer            // 0–100
  status: text                  // 'active' | 'expired' | 'hidden'
  raw: jsonb                    // for debugging
}

orgs: {
  slug, name, category, region, addis_office,
  website, careers_url, internship_url, application_email,
  twitter, linkedin, telegram,
  posts_publicly, has_remote, has_paid,
  scrape_priority,              // 'critical' | 'high' | 'medium' | 'low'
  notes
}

subscribers: {
  chat_id: bigint
  username: text | null
  joined_at: timestamp
  filters: jsonb                // { fields, paid_only, remote_ok }
  saved_listing_ids: uuid[]
  notify_24h: boolean
  notify_72h: boolean
}

scrape_runs: {
  id, source, started_at, finished_at,
  new_count, updated_count, error_count, log: jsonb
}
```

## Sources

**v1 primary**: ethiongojobs only. ~80% relevant coverage with one well-behaved source.

**v2 expansion**: see `orgs-seed.csv` — orgs marked `posts_publicly=yes` and `scrape_priority=critical|high` are the next scraping targets. UNDP, AU jobs portal, UN Careers, OHCHR, ReliefWeb, Devex.

**Cold-outreach directory**: orgs marked `posts_publicly=no|sometimes` go into the directory page. Students browse, see "how to apply" guidance, contact directly. This directory is itself a feature — no one has assembled this list for Ethiopian social-studies undergrads before.

## Seed data

`orgs-seed.csv` — 231 manually curated orgs across UN, AU, regional bodies, think tanks, human rights orgs (international + Ethiopian), election/democracy orgs, INGOs, bilateral cooperation, embassies, foundations, multilateral bodies, gender/climate/media/digital-rights specialists, government ministries, and aggregators.

Rows marked `verification_needed=yes` need URL validation before trust. Use `verify-orgs.ts` to batch-check websites and careers URLs; it writes `orgs-verified.csv` with status columns. Run before launch and monthly thereafter.

## Scraping politeness

- One request every 3–5 seconds, max
- Daily at 02:00 EAT, not per page load
- User-Agent identifies the bot and links to a contact/about page
- Always preserve and display source URL with attribution

## Field classification

The core IP. A listing is shown only if it passes the social-studies filter.

**Tier 1 keyword check** (runs on every scraped listing):

Include if title/description contains:
```
political, IR, international relations, governance, policy, peace, conflict,
election, civic, democracy, human rights, diplomacy, advocacy, civil society,
social science, sociology, anthropology, development studies, public administration,
public policy, gender, women's rights, refugees, migration, peacebuilding
```

Exclude if title primarily matches (and no include terms above):
```
health, medical, nutrition, WASH, livestock, agriculture, veterinary,
accountant, finance officer, engineering, mechanic, supply chain,
logistics officer, driver, IT support, network admin, sales
```

**Tier 2 LLM fallback** for ambiguous listings (both include + exclude keywords, or no clear match). Claude Haiku with a tight prompt returning JSON: `{ fits, fields[], fit_score, reason }`. Cache by source_url. Budget under $0.01 per listing.

**fit_score guide**:
- 90–100: bullseye (Election Support intern, governance research)
- 70–89: strong fit (general dev policy, advocacy comms)
- 50–69: adjacent (digital rights, comms at HR org)
- <50: don't show

## Telegram bot

**Channel** (broadcast):
- Every new listing with fit_score ≥ 70 auto-posts
- Format: org name (bold), role, deadline, fit badge, 2-sentence snippet, "Read" link to reader-mode, source attribution
- English only, restrained emoji

**Bot** (per-user DMs):
- `/start` — onboard, ask field interests via inline keyboard
- `/save <id>` — save for deadline reminders
- `/saved` — list with days-until-deadline
- `/filter` — adjust field/paid/remote prefs
- `/digest` — weekly Friday digest opt-in
- `/orgs` — browse cold-outreach directory
- `/help`
- Deadline reminders: cron every 6h, checks saved items for deadlines 24h/72h away, sends DM

Stack: telegraf.js. Single worker process, separate from web API. Deploy via PM2.

## API routes (Hono)

```
GET  /api/listings              ?field=&paid=&remote=&deadline_within=&limit=&offset=
GET  /api/listings/:id          full reader-mode payload
GET  /api/orgs                  cold-outreach directory
GET  /api/orgs/:slug
POST /api/scrape/trigger        admin-only
GET  /api/health
```

All responses Zod-validated. No auth for reads. Admin behind bearer token in env.

## Web app pages

- `/` — listing feed with filter sidebar. SSR initial, hydrated for filters.
- `/listing/:id` — reader mode. The hero page. Big title, org, deadline countdown, full cleaned description, "How to apply" callout, source link, "Save to Telegram" deeplink.
- `/orgs` — directory of cold-outreach orgs (from seed CSV)
- `/orgs/:slug` — org detail
- `/about` — what this is, source attribution, contact

No `/login`. No accounts. Telegram is the identity layer.

State: TanStack Query. URL search params for filters — shareable links matter.

## Legal and ethical

- **Attribution**: every card and reader-mode page links back to the source with name visible. ethiongojobs gets named credit.
- **Public content only**: no paywalled scraping.
- **Caching**: store HTML once, render from cache.
- **CSO safety**: EHRCO/EHRDC listings may carry political risk after the 2024 ACSO suspension. Show them, but include contextual notes on the org page so students apply with eyes open.

## Definition of done for v1

- ethiongojobs scraped daily, classifier filtering correctly on a sample set
- web app deployed at a real subdomain, reader-mode noticeably better than ethiongojobs
- Telegram channel auto-posting new listings
- Telegram bot with `/save` and deadline reminders
- Real student users from a single university tested it
- Source attribution visible on every listing
- Published "How this works + source credits" page

Beyond this is v2.