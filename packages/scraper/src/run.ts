// Manual runner. Usage:
//   pnpm --filter @rue/scraper run scrape          # 10 listings
//   pnpm --filter @rue/scraper run scrape -- 20    # 20 listings
//   pnpm --filter @rue/scraper run scrape -- 20 --save
//   pnpm --filter @rue/scraper run scrape -- --source undp --ignore-robots --save
//   pnpm --filter @rue/scraper run scrape -- --source un-careers --save

import { PoliteFetcher } from "./fetcher.js";
import { persistListings } from "./persist.js";
import { EthioNGOJobsSource } from "./sources/ethiongojobs.js";
import { UndpSource } from "./sources/undp.js";
import { UnCareersSource } from "./sources/un-careers.js";

const maxArg = process.argv.slice(2).find((arg) => /^\d+$/.test(arg));
const max = Number(maxArg ?? 10);
const save = process.argv.includes("--save");
const ignoreRobots =
  process.argv.includes("--ignore-robots") || process.env.SCRAPER_IGNORE_ROBOTS === "1";
const sourceName = valueAfter("--source") ?? "ethiongojobs";
const fetcher = new PoliteFetcher({ respectRobots: !ignoreRobots });
const source =
  sourceName === "un-careers"
    ? new UnCareersSource()
    : sourceName === "undp"
      ? new UndpSource(fetcher)
    : sourceName === "ethiongojobs"
      ? new EthioNGOJobsSource(fetcher)
      : null;

if (!source) {
  console.error(`[scraper] unknown source: ${sourceName}`);
  process.exit(1);
}

console.error(`[scraper] fetching up to ${max} listings from ${source.name}…`);
if (ignoreRobots) {
  console.error("[scraper] robots.txt enforcement disabled for this run");
}
const t0 = Date.now();
const listings = await source.scrape({ max });
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.error(`[scraper] got ${listings.length} listings in ${dt}s\n`);

if (save) {
  console.error("[scraper] classifying and upserting kept listings…");
  const result = await persistListings(source.name, listings);
  console.error(
    `[scraper] saved ${result.keptCount}/${result.scrapedCount}; new=${result.newCount} updated=${result.updatedCount} errors=${result.errorCount}`,
  );
}

for (const [i, l] of listings.entries()) {
  console.log(`── ${i + 1} ─────────────────────────────────────────────`);
  console.log(`title:      ${l.title}`);
  console.log(`org:        ${l.orgName}`);
  console.log(`url:        ${l.sourceUrl}`);
  console.log(`source_id:  ${l.sourceId ?? "—"}`);
  console.log(`location:   ${l.location ?? "—"}    remote=${l.isRemote}`);
  console.log(
    `paid:       ${l.isPaid === null ? "?" : l.isPaid}   stipend=${l.stipendText ?? "—"}`,
  );
  console.log(`posted_at:  ${l.postedAt?.toISOString() ?? "—"}`);
  console.log(`deadline:   ${l.deadline?.toISOString() ?? "—"}`);
  console.log(`desc_chars: ${l.descriptionText.length}`);
  console.log(`desc_head:  ${l.descriptionText.slice(0, 160)}…`);
  console.log();
}

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}
