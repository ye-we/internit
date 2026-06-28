// Reconcile stored deadlines against the body text and remove dead postings.
//
// The ingest gate in persist.ts blocks NEW past-deadline postings, but it only
// fires on a *parsed* deadline. Postings whose deadline was unparseable at
// ingest (e.g. the ordinal "before November 2nd, 2022") slipped in with
// deadline=null and show as active forever. This re-runs findDeadlineInText on
// each row's stored descriptionText and:
//   - DELETES rows whose (stored or recovered) deadline is already past, and
//   - BACKFILLS a recovered FUTURE deadline onto rows that stored null.
//
// Dry-run by default. Pass --apply to write.
//
// Usage:
//   pnpm --filter @internit/scraper prune:expired
//   pnpm --filter @internit/scraper prune:expired -- --apply
//   pnpm --filter @internit/scraper prune:expired -- --apply --grace-days 1

import { eq } from "drizzle-orm";
import { closeDb, getDb, listings } from "@internit/db";
import { isRoundup } from "./filter.js";
import { findDeadlineInText } from "./text-extract.js";

const DAY = 86_400_000;
const apply = process.argv.includes("--apply");
const graceDays = Number(valueAfter("--grace-days") ?? "1");
const graceMs = graceDays * DAY;
// A still-active listing not re-seen in this many days has dropped from its
// source feed and should be expired.
const staleDays = Number(valueAfter("--stale-days") ?? "21");
const staleMs = staleDays * DAY;

const db = getDb();
const rows = await db.select().from(listings);
const now = Date.now();

let scanned = 0;
let deleted = 0;
let staled = 0;
let backfilled = 0;

for (const row of rows) {
  scanned += 1;

  // Aggregator/digest posts that slipped in before isRoundup() existed.
  if (isRoundup(row.title)) {
    console.error(`  ${apply ? "DELETE  " : "would del"}  roundup    ${row.source}  ${row.title.slice(0, 50)}`);
    if (apply) await db.delete(listings).where(eq(listings.id, row.id));
    deleted += 1;
    continue;
  }

  const effective = row.deadline ?? findDeadlineInText(row.descriptionText);

  // Past deadline → closed posting, remove it.
  if (effective && effective.getTime() < now - graceMs) {
    console.error(
      `  ${apply ? "DELETE  " : "would del"}  ${effective.toISOString().slice(0, 10)}  ${row.source}  ${row.title.slice(0, 50)}`,
    );
    if (apply) await db.delete(listings).where(eq(listings.id, row.id));
    deleted += 1;
    continue;
  }

  // Freshness: an active listing not re-confirmed in staleDays has fallen off
  // its source feed (e.g. an undated AU/Idealist posting that closed). Mark it
  // expired — reversible, and it self-heals if the source brings it back.
  if (row.status === "active" && row.scrapedAt.getTime() < now - staleMs) {
    const age = Math.round((now - row.scrapedAt.getTime()) / DAY);
    console.error(
      `  ${apply ? "EXPIRE  " : "would exp"}  stale ${age}d  ${row.source}  ${row.title.slice(0, 50)}`,
    );
    if (apply) await db.update(listings).set({ status: "expired" }).where(eq(listings.id, row.id));
    staled += 1;
    continue;
  }

  // Future deadline we recovered but never stored — backfill it so the row
  // stops showing as "no deadline".
  if (effective && !row.deadline) {
    console.error(
      `  ${apply ? "BACKFILL" : "would set"}  ${effective.toISOString().slice(0, 10)}  ${row.source}  ${row.title.slice(0, 50)}`,
    );
    if (apply) {
      await db
        .update(listings)
        .set({ deadline: effective, status: "active" })
        .where(eq(listings.id, row.id));
    }
    backfilled += 1;
  }
}

console.error(
  `\nscanned ${scanned} | ${apply ? "deleted" : "would delete"} ${deleted} | ${apply ? "expired" : "would expire"} ${staled} | ${apply ? "backfilled" : "would backfill"} ${backfilled}${apply ? "" : " (dry-run — pass --apply to write)"}`,
);

await closeDb();

function valueAfter(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}
