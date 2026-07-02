// Nightly reconciliation of listing lifecycle against stored/recovered deadlines.
//
// The ingest gate in persist.ts blocks NEW past-deadline postings, but only on a
// *parsed* deadline; ones that were unparseable at ingest slipped in as
// deadline=null and show active forever. This re-runs findDeadlineInText on each
// row's stored descriptionText and:
//   - DEACTIVATES (status=expired) rows whose deadline has passed — a soft-close
//     that keeps history and any user's saved reminder (the board hides them);
//   - PURGES (hard-deletes) rows already expired well past their deadline, to
//     keep the table lean long after anyone would look;
//   - EXPIRES stale rows not re-seen on their source feed in --stale-days;
//   - BACKFILLS a recovered FUTURE deadline onto rows that stored null.
//
// Fast per-deadline deactivation runs far more often via `deactivate:expired`;
// this heavier nightly pass reconciles the rest. Dry-run by default; --apply to
// write.
//
// Usage:
//   pnpm --filter @internit/scraper prune:expired
//   pnpm --filter @internit/scraper prune:expired -- --apply
//   pnpm --filter @internit/scraper prune:expired -- --apply --grace-days 1 --purge-days 90

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
// Already-expired rows this far past their deadline (or last seen) are purged.
const purgeDays = Number(valueAfter("--purge-days") ?? "90");
const purgeMs = purgeDays * DAY;

const db = getDb();
const rows = await db.select().from(listings);
const now = Date.now();

let scanned = 0;
let deleted = 0;
let purged = 0;
let expired = 0;
let staled = 0;
let backfilled = 0;

for (const row of rows) {
  scanned += 1;

  // Aggregator/digest posts that slipped in before isRoundup() existed — never
  // real listings, so hard-delete them.
  if (isRoundup(row.title)) {
    console.error(`  ${apply ? "DELETE  " : "would del"}  roundup    ${row.source}  ${row.title.slice(0, 50)}`);
    if (apply) await db.delete(listings).where(eq(listings.id, row.id));
    deleted += 1;
    continue;
  }

  const effective = row.deadline ?? findDeadlineInText(row.descriptionText);
  const ageRef = effective?.getTime() ?? row.scrapedAt.getTime();

  // Purge: an already-expired row long past its deadline (or long unseen) is safe
  // to hard-delete — keeps the table lean. Only ever touches soft-closed rows.
  if (row.status === "expired" && ageRef < now - purgeMs) {
    console.error(
      `  ${apply ? "PURGE   " : "would prg"}  ${Math.round((now - ageRef) / DAY)}d old  ${row.source}  ${row.title.slice(0, 50)}`,
    );
    if (apply) await db.delete(listings).where(eq(listings.id, row.id));
    purged += 1;
    continue;
  }

  // Past deadline but still active → deactivate (soft-close). Keeps the row, its
  // history and any saved reminder; the board just stops showing it. Reversible
  // if the source re-lists it.
  if (row.status === "active" && effective && effective.getTime() < now - graceMs) {
    console.error(
      `  ${apply ? "EXPIRE  " : "would exp"}  ${effective.toISOString().slice(0, 10)}  ${row.source}  ${row.title.slice(0, 50)}`,
    );
    if (apply) await db.update(listings).set({ status: "expired" }).where(eq(listings.id, row.id));
    expired += 1;
    continue;
  }

  // Freshness: an active listing not re-confirmed in staleDays has fallen off its
  // source feed (e.g. an undated AU/Idealist posting that closed). Mark it
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

  // Future deadline we recovered but never stored — backfill it so the row stops
  // showing as "no deadline".
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
  `\nscanned ${scanned} | roundups ${deleted} | expired ${expired} | stale ${staled} | purged ${purged} | backfilled ${backfilled}${apply ? "" : " (dry-run — pass --apply to write)"}`,
);

await closeDb();

function valueAfter(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}
