// Inspect the AI structurer against one real listing without persisting changes.
//
// Usage:
//   pnpm --filter @rue/scraper inspect:structure
//   pnpm --filter @rue/scraper inspect:structure -- --source undp
//   pnpm --filter @rue/scraper inspect:structure -- --scrape

import { desc, isNotNull } from "drizzle-orm";
import {
  closeDb,
  getDb,
  listings as listingsTable,
  type Listing,
} from "@rue/db";
import { PoliteFetcher } from "./fetcher.js";
import type { ScrapedListing, Source } from "./index.js";
import { structureListing } from "./structure.js";
import { EthioNGOJobsSource } from "./sources/ethiongojobs.js";
import { UndpSource } from "./sources/undp.js";
import { UnCareersSource } from "./sources/un-careers.js";

const forceScrape = process.argv.includes("--scrape");
const ignoreRobots =
  process.argv.includes("--ignore-robots") || process.env.SCRAPER_IGNORE_ROBOTS === "1";
const sourceName = valueAfter("--source") ?? "ethiongojobs";

console.error("[inspect] structurer env");
console.error(`  enabled:  ${process.env.STRUCTURER_ENABLED ?? "unset"}`);
console.error(`  provider: ${process.env.STRUCTURER_PROVIDER ?? "gemini"}`);
console.error(`  model:    ${process.env.STRUCTURER_MODEL ?? "gemini-2.5-flash-lite"}`);
console.error(`  key:      ${process.env.GEMINI_API_KEY ? "set" : "missing"}`);

const listing = forceScrape ? null : await latestDbListing().catch((err) => {
  console.error(
    `[inspect] could not read latest DB listing: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
  return null;
});

const sample = listing ? fromDbListing(listing) : await scrapeOne(sourceName);

console.error("[inspect] sample");
console.error(`  title: ${sample.title}`);
console.error(`  org:   ${sample.orgName}`);
console.error(`  url:   ${sample.sourceUrl}`);
console.error(`  chars: ${sample.descriptionText.length}`);

const structured = await structureListing(sample);
if (!structured) {
  console.error("[inspect] no structured output returned");
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(structured, null, 2));
}

await closeDb();

async function latestDbListing(): Promise<Listing | null> {
  const rows = await getDb()
    .select()
    .from(listingsTable)
    .where(isNotNull(listingsTable.descriptionText))
    .orderBy(desc(listingsTable.scrapedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function scrapeOne(name: string): Promise<ScrapedListing> {
  const source = makeSource(name);
  console.error(`[inspect] scraping one listing from ${source.name}`);
  if (ignoreRobots) console.error("[inspect] robots.txt enforcement disabled");

  const rows = await source.scrape({ max: 1 });
  const row = rows[0];
  if (!row) {
    throw new Error(`No listings returned from ${source.name}`);
  }
  return row;
}

function makeSource(name: string): Source {
  const fetcher = new PoliteFetcher({ respectRobots: !ignoreRobots });
  if (name === "un-careers") return new UnCareersSource();
  if (name === "undp") return new UndpSource(fetcher);
  if (name === "ethiongojobs") return new EthioNGOJobsSource(fetcher);
  throw new Error(`Unknown source: ${name}`);
}

function fromDbListing(row: Listing): ScrapedListing {
  return {
    source: row.source,
    sourceUrl: row.sourceUrl,
    sourceId: row.sourceId,
    orgName: row.orgName,
    orgSlug: row.orgSlug,
    title: row.title,
    location: row.location,
    isRemote: row.isRemote,
    isPaid: row.isPaid,
    stipendText: row.stipendText,
    deadline: row.deadline,
    postedAt: row.postedAt,
    descriptionHtml: row.descriptionHtml,
    descriptionText: row.descriptionText,
    raw: row.raw,
  };
}

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}
