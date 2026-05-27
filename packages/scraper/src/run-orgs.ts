// Org-driven runner. Usage:
//   pnpm --filter @rue/scraper run scrape:orgs
//   pnpm --filter @rue/scraper run scrape:orgs -- --save --max 10
//   pnpm --filter @rue/scraper run scrape:orgs -- --priority critical,high --ignore-robots

import { closeDb, getDb, orgs, type Org } from "@rue/db";
import { and, inArray } from "drizzle-orm";
import { PoliteFetcher } from "./fetcher.js";
import { persistListings } from "./persist.js";
import { EthioNGOJobsSource } from "./sources/ethiongojobs.js";
import { UndpSource } from "./sources/undp.js";
import { UnCareersSource } from "./sources/un-careers.js";
import type { ScrapedListing } from "./index.js";

type AdapterName = "ethiongojobs" | "un-careers" | "undp";

type QueueItem = {
  org: Org;
  urls: URL[];
  adapters: AdapterName[];
};

const save = process.argv.includes("--save");
const dryRun = process.argv.includes("--dry-run");
const ignoreRobots =
  process.argv.includes("--ignore-robots") || process.env.SCRAPER_IGNORE_ROBOTS === "1";
const max = Number(valueAfter("--max") ?? numericArg() ?? 10);
const priorityArg = valueAfter("--priority") ?? "critical,high";
const priorities = priorityArg
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

if (Number.isNaN(max) || max < 1) {
  console.error("[scraper:orgs] --max must be a positive number");
  process.exit(1);
}

console.error(
  `[scraper:orgs] loading ${priorities.join(", ")} orgs that post opportunities publicly`,
);

const queue = await loadQueue(priorities);
const supported = queue.filter((item) => item.adapters.length > 0);
const unsupported = queue.filter((item) => item.adapters.length === 0);
const adapters = unique(supported.flatMap((item) => item.adapters));

console.error(
  `[scraper:orgs] queued ${queue.length} orgs: ${supported.length} covered, ${unsupported.length} need adapters`,
);
console.error(`[scraper:orgs] adapters to run: ${adapters.join(", ") || "none"}`);

if (unsupported.length > 0) {
  console.error("\n[scraper:orgs] highest-priority orgs without scraper coverage:");
  for (const item of unsupported.slice(0, 20)) {
    const bestUrl = item.org.internshipUrl ?? item.org.careersUrl ?? item.org.website ?? "no url";
    console.error(`- ${item.org.scrapePriority ?? "?"} ${item.org.name} (${item.org.slug}) — ${bestUrl}`);
  }
}

if (dryRun || adapters.length === 0) {
  process.exit(0);
}

if (ignoreRobots) {
  console.error("\n[scraper:orgs] robots.txt enforcement disabled for this run");
}

for (const adapter of adapters) {
  const source = buildSource(adapter, ignoreRobots);
  console.error(`\n[scraper:orgs] fetching up to ${max} listings from ${source.name}…`);
  const t0 = Date.now();
  let listings;
  try {
    listings = await source.scrape({ max });
  } catch (err) {
    console.error(
      `[scraper:orgs] ${source.name} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    continue;
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`[scraper:orgs] got ${listings.length} listings from ${source.name} in ${dt}s`);

  if (save) {
    console.error(`[scraper:orgs] classifying and upserting ${source.name} listings…`);
    const result = await persistListings(source.name, listings);
    console.error(
      `[scraper:orgs] saved ${result.keptCount}/${result.scrapedCount}; new=${result.newCount} updated=${result.updatedCount} errors=${result.errorCount}`,
    );
  }
}

async function loadQueue(prioritiesToRun: string[]): Promise<QueueItem[]> {
  const db = getDb();
  try {
    const rows = await db
      .select()
      .from(orgs)
      .where(
        and(
          inArray(orgs.postsPublicly, ["yes", "sometimes"]),
          inArray(orgs.scrapePriority, prioritiesToRun),
        ),
      );

    return rows
      .map((org) => {
        const urls = orgUrls(org);
        return {
          org,
          urls,
          adapters: unique(matchAdapters(org, urls)),
        };
      })
      .filter((item) => item.urls.length > 0 || item.adapters.length > 0)
      .sort((a, b) => priorityRank(a.org.scrapePriority) - priorityRank(b.org.scrapePriority));
  } finally {
    await closeDb();
  }
}

function buildSource(name: AdapterName, shouldIgnoreRobots: boolean): {
  name: string;
  scrape(options?: { max?: number }): Promise<ScrapedListing[]>;
} {
  const fetcher = new PoliteFetcher({ respectRobots: !shouldIgnoreRobots });
  if (name === "un-careers") return new UnCareersSource();
  if (name === "undp") return new UndpSource(fetcher);
  return new EthioNGOJobsSource(fetcher);
}

function matchAdapters(org: Org, urls: URL[]): AdapterName[] {
  const slugs = new Set([org.slug, org.slug.replace(/-ethiopia$/, "")]);
  const hostnames = urls.map((url) => url.hostname.replace(/^www\./, ""));
  const adapters: AdapterName[] = [];

  if (slugs.has("ethiongojobs") || hostnames.some((h) => h.includes("ethiongojobs.com"))) {
    adapters.push("ethiongojobs");
  }

  if (
    slugs.has("un-careers") ||
    hostnames.some((h) => h.includes("careers.un.org")) ||
    hostnames.some((h) => h.includes("jobs.un.org"))
  ) {
    adapters.push("un-careers");
  }

  if (
    slugs.has("undp") ||
    slugs.has("undp-ethiopia") ||
    hostnames.some((h) => h.includes("jobs.undp.org"))
  ) {
    adapters.push("undp");
  }

  return adapters;
}

function orgUrls(org: Org): URL[] {
  const raw = [org.internshipUrl, org.careersUrl, org.website].filter((url): url is string => !!url);
  const parsed: URL[] = [];
  for (const value of raw) {
    try {
      parsed.push(new URL(value));
    } catch {
      // Invalid seed URLs should not stop the queue; they can be fixed from the dry-run output.
    }
  }
  return parsed;
}

function priorityRank(priority: string | null): number {
  return ["critical", "high", "medium", "low"].indexOf(priority ?? "low");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function numericArg(): string | null {
  return process.argv.slice(2).find((arg) => /^\d+$/.test(arg)) ?? null;
}
