# internit

Internship aggregator for Ethiopian social-studies students — political science, IR, governance, peace & conflict, human rights, sociology, development studies.

Existing job boards are ad-heavy and unfiltered. internit scrapes public listings, keeps only the ones relevant to social-studies undergrads (keyword filter + LLM fallback), and delivers them where students actually are: a Telegram channel for broadcast, a bot for deadline reminders, and a clean reader-mode website.

## How it works

```
scrape (daily cron) → classify by field → store (Postgres)
                                            ├─ web: listing board + reader mode
                                            ├─ channel: auto-post fit ≥ 70 as editorial cards
                                            └─ bot: /save + 24h/72h deadline reminder DMs
```

- **Web** (`apps/web`) — SvelteKit + Drizzle. Listing feed, reader mode, cold-outreach org directory, optional sign-in (Better Auth) for bookmarks.
- **Bot** (`apps/bot`) — telegraf. Channel auto-posting with rendered card images, per-user saves and deadline reminders.
- **Worker** (`apps/worker`) — cron pipeline: scrape → dedup → classify → structure → prune.
- **Packages** — `scraper` (cheerio, polite fetcher), `classifier` (keyword tier + LLM fallback), `card` (satori/resvg channel-card renderer), `db` (Drizzle schema + migrations), `shared` (Zod schemas).

`orgs-seed.csv` is a hand-curated directory of 200+ organizations relevant to the field — including ones that never post publicly, so students can reach out directly. That list is itself a contribution; use it well.

## Setup

Requirements: Node ≥ 20.6, pnpm, PostgreSQL.

```sh
pnpm install
cp .env.example .env          # fill in DATABASE_URL, TELEGRAM_*, BETTER_AUTH_SECRET
pnpm --filter @internit/db run migrate
pnpm run dev                  # web + bot + worker
```

All apps read env from the **monorepo root `.env` only** — per-app `.env` files are ignored.

## Deploy

```sh
pnpm --filter @internit/web build
pm2 start ecosystem.config.cjs
```

Three PM2 processes: `internit-web` (adapter-node), `internit-bot`, `internit-worker`. Set `ORIGIN`, `BETTER_AUTH_URL`, and `SITE_URL` to the real public URL.

## Scraping ethics

- One request every 3–5 seconds per host, daily schedule — never per page load.
- robots.txt respected; the User-Agent identifies the bot and links a contact page.
- Every listing links back to its source with visible attribution.
- Public content only; HTML is stored once and rendered from cache.

If you operate a source site and want different behavior, open an issue or use the contact page linked in the User-Agent.

## License

[MIT](LICENSE)
