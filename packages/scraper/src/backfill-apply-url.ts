// Backfill apply_url — the direct application link — for existing listings.
//   - ethiongojobs: parsed from the already-stored description_html (no network).
//   - idealist: fetched from the listing page, where the specific ATS URL lives
//     (the Algolia description only carries the org's general careers page).
//
// Usage (from repo root):
//   pnpm --filter @internit/scraper backfill:apply-url            # dry run
//   pnpm --filter @internit/scraper backfill:apply-url -- --apply # write

import { closeDb, eq, getDb, inArray, listings } from "@internit/db";
import { PoliteFetcher } from "./fetcher.js";
import { fetchApplyUrl } from "./adapters/idealist.js";
import { extractApplyUrl } from "./sources/ethiongojobs.js";

const apply = process.argv.includes("--apply");

const db = getDb();
const fetcher = new PoliteFetcher();
const rows = await db
  .select()
  .from(listings)
  .where(inArray(listings.source, ["ethiongojobs", "idealist"]));

let withLink = 0;
let updated = 0;
let none = 0;

for (const row of rows) {
  let url: string | null = null;
  if (row.source === "ethiongojobs") {
    url = extractApplyUrl(row.descriptionHtml, row.sourceUrl);
  } else if (row.source === "idealist") {
    // Fetch the listing page — that's where the specific ATS / form link is.
    url = await fetchApplyUrl(fetcher, row.sourceUrl);
  }

  if (!url) {
    none += 1;
    continue;
  }
  withLink += 1;
  if (url === row.applyUrl) continue;

  console.error(`${apply ? "SET  " : "would"}  ${row.source.padEnd(12)}  ${row.title.slice(0, 40)}`);
  console.error(`         → ${url}`);
  if (apply) {
    await db.update(listings).set({ applyUrl: url }).where(eq(listings.id, row.id));
    updated += 1;
  }
}

console.error(
  `\n[apply-url] ${rows.length} scanned · ${withLink} with link · ${none} none · ${updated} updated${apply ? "" : " (dry run)"}`,
);
await closeDb();
