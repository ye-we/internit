# Brief: scale the Tilq scraper from 4 bespoke sources to 30–50+

You are being asked to design and write the `@rue/scraper` package for **Tilq / Rue**, an internship aggregator for Ethiopian undergraduates studying social sciences (political science, IR, governance, peace & conflict, human rights, sociology, development studies, public policy). The product surfaces in two places: a Telegram channel + bot, and a reader-mode web app.

You will not have access to the repository. Everything you need to design correctly is inlined below — types, interfaces, target sites, conventions. Treat this brief as the source of truth and produce the deliverable from it.

---

## 1. Why this exists

Ethiopia has one popular but ad-saturated jobs aggregator (`ethiongojobs.com`). Nobody filters Ethiopian *internship* listings by *field* for *social-studies undergrads*. The product is exactly that filter, plus a clean reader-mode rendering of the original posting, plus deadline reminders via Telegram.

The audience is senior-year undergrads in Ethiopian universities. They can't apply to senior roles, can't apply to most US-based roles, and often can't pay for things. So an "Ethiopian-accessible internship in a social-studies-adjacent org" is the entire bar.

The scraper sits upstream of a classifier (keyword + LLM fallback) that decides if a listing fits the social-studies cluster, and an LLM structurer that extracts a clean summary, requirements, application instructions, and an "Ethiopia accessibility" judgment. **Your job is only to produce well-formed raw listings.** You do not touch classification or structuring.

---

## 2. What exists today (and what stays)

The scraper currently has **four bespoke source modules**, each ~150–300 lines of Cheerio + fetch:

- `ethiongojobs` — WordPress + Jannah theme, `/?s=internship` paginated HTML.
- `un-careers` — `careers.un.org` public JSON API (Inspira backend).
- `undp` — `jobs.undp.org` HTML list + Oracle HCM Cloud JSON detail endpoint.
- `ehrdc` — Ethiopian Human Rights Defenders Center, bespoke HTML.

Downstream of every source is a `persistListings(source, scraped[])` function that classifies, runs the LLM structurer, and upserts into PostgreSQL via Drizzle. **You do not change `persistListings` or anything downstream of it.** Your contract is to produce arrays of `ScrapedListing`.

### Types you must conform to exactly

```ts
// The flat record every adapter must yield.
export type ScrapedListing = {
  source: string;             // a stable string slug, e.g. "undp", "greenhouse:atlantic-council"
  sourceUrl: string;          // canonical detail URL — used as the unique key for upserts
  sourceId: string | null;    // platform-native ID if available
  orgName: string;            // human-readable org name as shown on the source
  orgSlug: string | null;     // when known, the slug from orgs-seed.csv (see section 4)
  title: string;
  location: string | null;
  isRemote: boolean;
  isPaid: boolean | null;     // TRI-STATE. null = "the source does not say". NEVER invent.
  stipendText: string | null; // verbatim snippet from the source if found
  deadline: Date | null;      // timezone-aware Date; null if no deadline given
  postedAt: Date | null;
  descriptionHtml: string;    // MUST pass through cleanDescriptionHtml() — see section 3
  descriptionText: string;    // text-only version for the classifier
  raw: unknown;               // anything you want to store for debugging
};

export interface Source {
  name: string;
  scrape(opts?: { max?: number }): Promise<ScrapedListing[]>;
}
```

### Utilities provided (treat as a stable API)

```ts
// fetcher.ts — USE THIS FOR EVERY OUTBOUND HTTP CALL.
export class PoliteFetcher {
  constructor(opts?: {
    userAgent?: string;
    delayMs?: number;       // default 4000ms between requests (3–5s window)
    timeoutMs?: number;     // default 45_000
    retries?: number;       // default 2
    respectRobots?: boolean;// default true
  });
  get(url: string, accept?: string): Promise<string>;
}

// html.ts
export function collapse(s: string | null | undefined): string;
export function cleanDescriptionHtml(
  html: string,
  opts?: { resolveUrl?: (href: string) => string },
): string;
// Strips scripts/styles/forms/iframes. Unwraps div/span/section/article.
// Keeps only: a, b, blockquote, br, em, h2-h6, li, ol, p, strong, ul.
// Rewrites <a> with target=_blank rel=noopener. Resolves relative URLs if opts.resolveUrl is given.
```

### The user agent

```
TilqBot/0.1 (+https://example.com/about; internship aggregator for Ethiopian social-studies students)
```

### Scraping politeness (non-negotiable, from project CLAUDE.md)

- **One request every 3–5 seconds per host.** PoliteFetcher enforces this. Don't bypass it.
- **Daily run, not per-page-load.** The web app reads from the database; the scraper runs on a cron.
- **Respect robots.txt by default.** Override only with explicit justification (e.g. UNDP's robots blocks crawlers but UN job postings are explicit public data).
- **Always preserve the source URL** so the reader-mode page can attribute it.

---

## 3. The actual problem

Four bespoke sources don't scale. You have **~104 orgs marked `posts_publicly=yes`** in the seed dataset (section 4), of which **14 are `critical` priority** and **31 are `high`**. Writing 100+ bespoke 200-line modules is the wrong shape.

**The leverage point:** almost every target org sits on one of ~6 hiring backends. Build *adapters per backend*, not scrapers per org. A single Greenhouse adapter unlocks dozens of think tanks. A single Workday adapter unlocks many INGOs.

### ATS / platform fingerprints

| Backend          | Detection signal                                                         | API shape                                                                        |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Inspira (UN)** | host = `careers.un.org`                                                  | `GET /api/public/opening/jo/activeJo?language=en` — JSON list with full descriptions |
| **Oracle HCM**   | URL contains `oraclecloud.com` or `recruitingCEJobRequisitionDetails`    | List page is server-rendered HTML; detail via `/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?finder=ById;Id={id}` |
| **Greenhouse**   | host matches `boards.greenhouse.io/*` or careers page embeds a `boards.greenhouse.io/embed/job_board?for={slug}` iframe | `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` — JSON with HTML descriptions |
| **Lever**        | host matches `jobs.lever.co/*` or page embeds `jobs.lever.co/{slug}`     | `GET https://api.lever.co/v0/postings/{slug}?mode=json`                          |
| **Workday**      | host matches `*.myworkdayjobs.com` or careers page links to `/wday/cxs/{tenant}/{site}/jobs` | `POST /wday/cxs/{tenant}/{site}/jobs` with `{ "limit": 50, "offset": 0, "searchText": "intern" }`; detail via `GET /wday/cxs/{tenant}/{site}/job/{id}` |
| **SmartRecruiters** | host contains `smartrecruiters.com`                                   | `GET https://api.smartrecruiters.com/v1/companies/{co}/postings?q=intern`        |
| **WordPress + Jannah theme** | `/?s=` query search + `li.post-item` cards                  | scrape HTML (see `ethiongojobs` example in §6)                                    |
| **Generic HTML** | everything else                                                          | follow internship-keyword links from the careers page; heuristic detail parse    |

A single dispatcher should look at an org's `careers_url` / `internship_url`, detect the backend, and route to the right adapter.

---

## 4. Org dataset

`orgs-seed.csv` is a 231-row manually curated list with these columns:

```
slug, name, category, region, addis_office, website, careers_url,
internship_url, application_email, twitter, linkedin, telegram,
posts_publicly, has_remote, has_paid, scrape_priority, verification_needed, notes
```

You won't have the CSV at chat-time, but here are the **45 critical + high priority orgs you must aim to cover**. Where the column shows a URL, that's the best one to start from.

### Priority targets

| Priority  | Slug                       | Org                                                      | Best URL                                                                                   |
| --------- | -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| critical  | au                         | African Union Commission                                 | https://jobs.au.int/job/Internship-Program/1506-en_US/                                     |
| critical  | au-paps                    | AU Political Affairs Peace and Security                  | https://jobs.au.int                                                                        |
| critical  | crisis-group               | International Crisis Group                               | https://www.crisisgroup.org/careers/internships                                            |
| critical  | iss-africa                 | Institute for Security Studies                           | https://issafrica.org/about-us/vacancies                                                   |
| critical  | amnesty                    | Amnesty International                                    | https://www.amnesty.org/en/careers                                                         |
| critical  | hrw                        | Human Rights Watch                                       | https://www.hrw.org/internships                                                            |
| critical  | card                       | Center for Advancement of Rights and Democracy           | https://www.cardeth.org/internship                                                         |
| critical  | ehrdc                      | Ethiopian Human Rights Defenders Center                  | https://ethdefenders.org/category/jobopenings-vacancy                                      |
| critical  | ehrc                       | Ethiopian Human Rights Commission                        | https://ehrc.org/category/vacancies                                                        |
| critical  | nebe                       | National Election Board of Ethiopia                      | https://nebe.org.et/en/vacancies                                                           |
| critical  | eu-delegation-au           | EU Delegation to the African Union                       | https://www.eeas.europa.eu/eeas/work-us_en                                                 |
| critical  | mfa-ethiopia               | Ministry of Foreign Affairs Ethiopia                     | https://mfa.gov.et/vacancies                                                               |
| critical  | ethiongojobs               | EthioNGOJobs                                             | https://www.ethiongojobs.com/?s=internship                                                 |
| critical  | un-careers                 | UN Careers portal                                        | https://careers.un.org                                                                     |
| high      | undp                       | United Nations Development Programme                     | https://www.undp.org/careers/internships                                                   |
| high      | undp-ethiopia              | UNDP Ethiopia                                            | https://jobs.undp.org                                                                      |
| high      | uneca                      | UN Economic Commission for Africa                        | https://www.uneca.org/careers                                                              |
| high      | un-women                   | UN Women                                                 | https://www.unwomen.org/en/about-us/employment/internship-programme                        |
| high      | unhcr                      | UN High Commissioner for Refugees                        | https://www.unhcr.org/get-involved/work-us/careers-unhcr/types-contracts-and-appointments/internships |
| high      | iom                        | International Organization for Migration                 | https://www.iom.int/internships                                                            |
| high      | iom-ethiopia               | IOM Ethiopia                                             | https://ethiopia.iom.int/how-apply-internship                                              |
| high      | ohchr                      | UN Human Rights Office                                   | https://www.ohchr.org/en/careers/internships                                               |
| high      | un-dppa                    | UN Department of Political and Peacebuilding Affairs     | https://careers.un.org                                                                     |
| high      | un-dpo                     | UN Department of Peace Operations                        | https://careers.un.org                                                                     |
| high      | au-hhasd                   | AU Health Humanitarian Affairs and Social Development    | https://jobs.au.int                                                                        |
| high      | au-psc                     | AU Peace and Security Council                            | https://jobs.au.int                                                                        |
| high      | african-court              | African Court on Human and Peoples' Rights               | https://www.african-court.org/wpafc/vacancies                                              |
| high      | achpr                      | African Commission on Human and Peoples' Rights          | https://achpr.au.int/en/vacancies                                                          |
| high      | igad                       | Intergovernmental Authority on Development               | https://igad.int/careers                                                                   |
| high      | atlantic-council           | Atlantic Council                                         | https://www.atlanticcouncil.org/about/young-global-professionals                           |
| high      | atlantic-council-africa    | Atlantic Council Africa Center                           | https://www.atlanticcouncil.org/about/careers                                              |
| high      | saiia                      | South African Institute of International Affairs         | https://saiia.org.za/youth-policy-portal                                                   |
| high      | accord                     | African Centre for Constructive Resolution of Disputes   | https://www.accord.org.za/career-opportunities                                             |
| high      | civicus                    | CIVICUS                                                  | https://www.civicus.org/index.php/internships                                              |
| high      | freedom-house              | Freedom House                                            | https://freedomhouse.org/careers/internships                                               |
| high      | defend-defenders           | DefendDefenders (East and Horn of Africa HRD Project)    | https://defenddefenders.org/jobs                                                           |
| high      | osf                        | Open Society Foundations                                 | https://www.opensocietyfoundations.org/jobs/internships                                    |
| high      | osf-africa                 | Open Society Africa                                      | (no public URL — skip until found)                                                         |
| high      | siha                       | Strategic Initiative for Women in the Horn of Africa     | https://sihanet.org/careers                                                                |
| high      | international-idea         | International IDEA                                       | https://www.idea.int/internships                                                           |
| high      | danish-embassy-ethiopia    | Danish Embassy Addis Ababa                               | https://etiopien.um.dk/en/about-us/internship                                              |
| high      | eu-delegation-ethiopia     | EU Delegation to Ethiopia                                | https://www.eeas.europa.eu/eeas/work-us_en                                                 |
| high      | mastercard-foundation      | MasterCard Foundation                                    | https://mastercardfdn.org/careers                                                          |
| high      | reliefweb                  | ReliefWeb job board                                      | https://reliefweb.int/jobs                                                                 |
| high      | devex                      | Devex job board                                          | https://www.devex.com/jobs                                                                 |

Note ReliefWeb and Devex are **aggregators** themselves — one adapter against either covers many INGO postings at once. ReliefWeb has a public JSON API at `https://api.reliefweb.int/v1/jobs`.

---

## 5. Filtering (before the classifier sees anything)

Every adapter MUST drop a listing before yielding it if any of these fail:

1. **It is an internship/fellowship/trainee role.** Match `/intern|fellow|trainee|graduate program/i` in the title. If the source is an internships-only feed (e.g. `careers.un.org` with `categoryCode === "INT"`), this is trivially true.
2. **It is plausibly accessible to a student in Ethiopia.** At least one of:
   - Location matches `/ethiopia|addis|africa|nairobi|kampala|kigali/i`, OR
   - Description matches `/remote|home-?based|virtual|work from anywhere/i`, OR
   - The org's region is "global" AND the role accepts applicants from any country (look for "open to applicants worldwide" or absence of nationality restrictions).

The downstream classifier does field-fit (is this political science vs accounting). Your filter is just "is this an internship at all" and "can an Ethiopian student plausibly apply".

---

## 6. Worked example: the existing `un-careers` adapter

Use this as the template for what "good" looks like. It's ~110 lines, uses the public API, filters before yielding, and produces correctly-shaped `ScrapedListing`s.

```ts
import * as cheerio from "cheerio";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing, Source } from "../index.js";

const SOURCE = "un-careers";
const ACTIVE_JOBS_URL = "https://careers.un.org/api/public/opening/jo/activeJo?language=en";
const JOB_URL_BASE = "https://careers.un.org/jobSearchDescription/";

type UnCareerRow = {
  jobId: number;
  categoryCode: string;
  jobTitle: string;
  postingTitle: string;
  jobDescription: string;
  dutyStation?: Array<{ description?: string }>;
  startDate?: string;
  endDate?: string;
  dept?: string;
};

export class UnCareersSource implements Source {
  name = SOURCE;
  async scrape(opts: { max?: number } = {}): Promise<ScrapedListing[]> {
    const max = opts.max ?? 20;
    const res = await fetch(ACTIVE_JOBS_URL, {
      headers: { "User-Agent": SCRAPER_USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`GET ${ACTIVE_JOBS_URL} -> HTTP ${res.status}`);
    const json = (await res.json()) as { data?: UnCareerRow[] };
    return (json.data ?? []).filter(isRelevantInternship).slice(0, max).map(parseRow);
  }
}

function isRelevantInternship(row: UnCareerRow): boolean {
  if (row.categoryCode !== "INT") return false;
  const text = `${row.postingTitle}\n${row.jobDescription}`.toLowerCase();
  const locations = (row.dutyStation ?? []).map((s) => s.description ?? "").join(" ").toLowerCase();
  return /\baddis\b|\bethiopia\b/.test(locations) || /\bremote\b|home-?based/.test(text);
}

function parseRow(row: UnCareerRow): ScrapedListing {
  const descriptionHtml = cleanDescriptionHtml(row.jobDescription, {
    resolveUrl: (href) => new URL(href, "https://careers.un.org").href,
  });
  const descriptionText = collapse(cheerio.load(descriptionHtml).text());
  const title = collapse(row.postingTitle || row.jobTitle);
  const location = (row.dutyStation ?? []).map((s) => collapse(s.description)).filter(Boolean).join(", ");
  const lowerText = `${title}\n${descriptionText}`.toLowerCase();
  return {
    source: SOURCE,
    sourceUrl: `${JOB_URL_BASE}${row.jobId}`,
    sourceId: String(row.jobId),
    orgName: "United Nations Careers",
    orgSlug: "un-careers",
    title,
    location: location || null,
    isRemote: /\bremote\b|home-?based/.test(lowerText),
    isPaid: detectPaid(lowerText),
    stipendText: extractStipend(descriptionText),
    deadline: parseDate(row.endDate),
    postedAt: parseDate(row.startDate),
    descriptionHtml,
    descriptionText,
    raw: { categoryCode: row.categoryCode, department: row.dept },
  };
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function detectPaid(lowerText: string): boolean | null {
  if (/\bunpaid\b|not financially remunerated/.test(lowerText)) return false;
  if (/\bpaid\b|\bstipend\b|\bmonthly allowance\b/.test(lowerText)) return true;
  return null;
}

function extractStipend(text: string): string | null {
  const m = /(stipend|allowance|remunerated|unpaid)[^.\n]{0,160}/i.exec(text);
  return m ? collapse(m[0]) : null;
}
```

---

## 7. What you must build

Produce a TypeScript implementation organized as follows. Use ESM (`.js` extensions in imports), Node 20+ runtime, `cheerio` for HTML, native `fetch` for HTTP.

```
packages/scraper/src/
  index.ts                     # public exports — extend, don't break
  fetcher.ts                   # extend PoliteFetcher to be per-origin keyed (see §8)
  html.ts                      # add BrowserChallengeError + isBrowserInterstitial helper
  dispatch.ts                  # NEW: pick the right adapter for an org URL
  adapters/
    inspira.ts                 # NEW: refactored from un-careers — parametrized
    oracle-hcm.ts              # NEW: generalized from undp
    greenhouse.ts              # NEW
    lever.ts                   # NEW
    workday.ts                 # NEW
    smartrecruiters.ts         # NEW
    reliefweb.ts               # NEW (aggregator — covers many INGOs)
    generic-html.ts            # NEW: fallback heuristic crawler
  sources/                     # the original 4 stay, but reimplemented as thin wrappers
```

### 7.1 Adapter contract

```ts
export interface Adapter {
  name: string;                       // e.g. "greenhouse"
  detect(url: string): boolean;       // cheap URL-pattern check
  scrape(
    config: { url: string; orgSlug?: string | null; orgName?: string },
    fetcher: PoliteFetcher,
    opts?: { max?: number },
  ): Promise<ScrapedListing[]>;
}
```

Each adapter is one file. It exports a singleton instance (or class) and is registered in `dispatch.ts` in priority order (most-specific detector first, `generic-html` last).

### 7.2 Dispatcher

```ts
export async function dispatchOrg(
  org: { slug: string; name: string; careersUrl?: string | null; internshipUrl?: string | null },
  fetcher: PoliteFetcher,
  opts?: { max?: number },
): Promise<ScrapedListing[]>;
```

Picks the first adapter whose `detect()` returns true on `internshipUrl ?? careersUrl`. Errors are caught and logged per-org without poisoning the run.

### 7.3 Extension to PoliteFetcher

The current implementation enforces a global 4-second gap. With 30 distinct hosts that means a 30-host run takes >= 30 × 4s = 2 minutes minimum even with no work. Refactor to **per-origin keyed throttling** so different hosts can run in parallel while still respecting 4s per host. Keep the existing `get()` API compatible.

### 7.4 Browser-challenge handling

Some sites return Cloudflare-style JS challenges instead of HTML. Add to `html.ts`:

```ts
export class BrowserChallengeError extends Error { /* ... */ }
export function isBrowserInterstitial(html: string): boolean;
```

Adapters detect this and throw `BrowserChallengeError`. The dispatcher catches it, logs it, and moves on — never retries within the same run.

### 7.5 Test fixtures

For every adapter, capture one HTML/JSON response and save it under `packages/scraper/test/fixtures/{adapter}/`. Write a Vitest test that parses the fixture and asserts the resulting `ScrapedListing[]` matches an expected snapshot. **No network in tests.** Mock the fetcher.

---

## 8. Hard constraints (read twice)

1. **Never bypass `PoliteFetcher`.** Even for JSON APIs. The throttle protects the user agent's reputation and your IP.
2. **`isPaid` is tri-state** (`true | false | null`). When the source doesn't say, return `null`. **Never invent.** Same for `deadline`, `postedAt`, `stipendText`.
3. **Every `descriptionHtml` MUST go through `cleanDescriptionHtml`.** Reader-mode rendering depends on the sanitized whitelist.
4. **`sourceUrl` MUST be stable.** Persistence dedupes on this column. Don't include session IDs or query params that change between runs.
5. **Set `orgSlug` when you know it.** The dispatcher invokes adapters with a known org → adapters must propagate that slug. Fuzzy matching downstream exists but is a fallback.
6. **Robots.txt respected by default.** Override only with an explicit `respectRobots: false` AND a code comment justifying it. UN data is one such case.
7. **No Playwright.** No headless browser. If a site truly requires JS, throw `BrowserChallengeError` and move on. The target sites are mostly server-rendered or have public APIs.
8. **No new heavy deps.** Allowed additions: `parse5`, `date-fns`, `p-limit`. Stay within ~50 KB of new node_modules surface.
9. **`raw` is for debugging only.** Don't put PII or HMAC-able fingerprints in it.
10. **Don't break the existing four `sources/` exports.** They're imported by the CLI runners (`run.ts`, `run-orgs.ts`).

---

## 9. Definition of done

- A run targeting all 45 critical+high orgs completes in **under 20 minutes wall-clock** and persists listings from **at least 15 distinct sources**.
- Per-source failures are logged but do not abort the run.
- `tsc --noEmit` passes; Vitest suite is green; every adapter has at least one fixture test.
- Every yielded listing has non-empty `title`, `sourceUrl`, `orgName`, `descriptionHtml`, `descriptionText`.
- New `scrape_runs` rows show per-source `new_count`, `updated_count`, `error_count`.

---

## 10. How to start

Don't write all eight adapters in one shot. Propose, in your first reply:

1. The file plan (paths + one-line purpose per file).
2. The `Adapter` interface and `dispatchOrg` signature (refined if you disagree with §7.1–7.2).
3. The order you'll build adapters in, with the **rationale tied to coverage** — i.e. "Inspira first because it unlocks 8 of the 14 critical orgs."

Wait for confirmation on the plan, then build. For each adapter you produce, deliver the adapter file + its fixture + its test together. Don't move to the next adapter until the previous one type-checks and tests pass.

When you write code: terse comments, no boilerplate JSDoc, no decorative section dividers. The existing `un-careers.ts` (§6) is the house style.

Begin.
