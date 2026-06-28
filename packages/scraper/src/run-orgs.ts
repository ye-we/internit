// Org-driven runner: dispatches every eligible org through the adapter
// registry (ATS APIs, WordPress, generic-HTML fallback). Usage:
//   pnpm --filter @internit/scraper run scrape:orgs -- --dry-run
//   pnpm --filter @internit/scraper run scrape:orgs -- --save --max 10
//   pnpm --filter @internit/scraper run scrape:orgs -- --priority critical,high
//   pnpm --filter @internit/scraper run scrape:orgs -- --org undp --save
//
// Orgs run with bounded concurrency; PoliteFetcher still guarantees the
// 3-5s gap per host, so parallelism only helps across distinct hosts.

import { closeDb, getDb, orgs, type Org } from "@internit/db";
import { and, inArray } from "drizzle-orm";
import { dispatchOrg, findAdapter, type DispatchResult } from "./dispatch.js";
import { PoliteFetcher } from "./fetcher.js";
import type { ScrapedListing, Source } from "./index.js";
import { persistOrgRun } from "./persist.js";
import { EthioNGOJobsSource } from "./sources/ethiongojobs.js";
import { UndpSource } from "./sources/undp.js";

const CONCURRENCY = 4;

// Bespoke sources that beat the generic adapters for their host (theme-aware
// noise stripping, country-filtered list pages). Keyed by org slug.
const SOURCE_OVERRIDES: Record<string, (fetcher: PoliteFetcher) => Source> = {
  ethiongojobs: (f) => new EthioNGOJobsSource(f),
  undp: (f) => new UndpSource(f),
  "undp-ethiopia": (f) => new UndpSource(f),
};

const save = process.argv.includes("--save");
const dryRun = process.argv.includes("--dry-run");
const ignoreRobots =
  process.argv.includes("--ignore-robots") || process.env.SCRAPER_IGNORE_ROBOTS === "1";
const max = Number(valueAfter("--max") ?? numericArg() ?? 10);
const onlyOrg = valueAfter("--org");
const priorityArg = valueAfter("--priority") ?? "critical,high";
const priorities = priorityArg
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

if (Number.isNaN(max) || max < 1) {
  console.error("[scraper:orgs] --max must be a positive number");
  process.exit(1);
}

const queue = await loadQueue(priorities, onlyOrg);
console.error(
  `[scraper:orgs] ${queue.length} orgs queued (priority: ${priorities.join(", ")}${onlyOrg ? `, org: ${onlyOrg}` : ""})`,
);

if (dryRun) {
  for (const org of queue) {
    const url = orgUrl(org);
    const via = SOURCE_OVERRIDES[org.slug]
      ? `source:${org.slug}`
      : url
        ? (findAdapter(url)?.name ?? "no adapter")
        : "no url";
    console.error(`- ${org.scrapePriority ?? "?"}\t${via}\t${org.slug}\t${url ?? ""}`);
  }
  process.exit(0);
}

if (ignoreRobots) {
  console.error("[scraper:orgs] robots.txt enforcement disabled for this run");
}

const fetcher = new PoliteFetcher({ respectRobots: !ignoreRobots });
const t0 = Date.now();
const results = await runPool(queue, CONCURRENCY, (org) => runOrg(org, fetcher));
const dt = ((Date.now() - t0) / 1000).toFixed(1);

const fetched = results.reduce((n, r) => n + r.listings.length, 0);
const failed = results.filter((r) => r.error);
console.error(`\n[scraper:orgs] ${fetched} listings from ${results.length} orgs in ${dt}s`);
for (const r of results) {
  const status = r.error ? `ERROR ${r.error}` : `${r.listings.length} listings`;
  console.error(
    `- ${r.org.slug}\t${r.adapter ?? "-"}\t${status}\t${(r.durationMs / 1000).toFixed(1)}s`,
  );
}
if (failed.length > 0) {
  console.error(`[scraper:orgs] ${failed.length} orgs failed`);
}

if (save) {
  console.error("\n[scraper:orgs] classifying and upserting kept listings…");
  const result = await persistOrgRun(results);
  console.error(
    `[scraper:orgs] saved ${result.keptCount}/${result.scrapedCount}; new=${result.newCount} updated=${result.updatedCount} errors=${result.errorCount}`,
  );
}

async function runOrg(org: Org, sharedFetcher: PoliteFetcher): Promise<DispatchResult> {
  const override = SOURCE_OVERRIDES[org.slug];
  if (override) {
    const source = override(sharedFetcher);
    const started = Date.now();
    try {
      // ethiongojobs is the primary Ethiopian source — let it pull its full
      // depth rather than the generic per-org cap.
      const sourceMax = org.slug === "ethiongojobs" ? Math.max(max, 80) : max;
      const listings: ScrapedListing[] = await source.scrape({ max: sourceMax });
      return {
        org: toDispatchOrg(org),
        adapter: `source:${source.name}`,
        listings,
        error: null,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        org: toDispatchOrg(org),
        adapter: `source:${source.name}`,
        listings: [],
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }
  return dispatchOrg(toDispatchOrg(org), sharedFetcher, { max });
}

function toDispatchOrg(org: Org) {
  return {
    slug: org.slug,
    name: org.name,
    careersUrl: org.careersUrl,
    internshipUrl: org.internshipUrl,
  };
}

function orgUrl(org: Org): string | null {
  return org.internshipUrl ?? org.careersUrl ?? null;
}

async function loadQueue(prioritiesToRun: string[], slug: string | null): Promise<Org[]> {
  const db = getDb();
  try {
    const rows = await db
      .select()
      .from(orgs)
      .where(
        slug
          ? inArray(orgs.slug, [slug])
          : and(
              inArray(orgs.postsPublicly, ["yes", "sometimes"]),
              inArray(orgs.scrapePriority, prioritiesToRun),
            ),
      );
    return rows
      .filter((org) => orgUrl(org) !== null || SOURCE_OVERRIDES[org.slug])
      .sort((a, b) => priorityRank(a.scrapePriority) - priorityRank(b.scrapePriority));
  } finally {
    await closeDb();
  }
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function priorityRank(priority: string | null): number {
  return ["critical", "high", "medium", "low"].indexOf(priority ?? "low");
}

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function numericArg(): string | null {
  return process.argv.slice(2).find((arg) => /^\d+$/.test(arg)) ?? null;
}
