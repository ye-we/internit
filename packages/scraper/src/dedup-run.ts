// Collapse cross-source duplicates among active listings. The same posting
// reposted on ethiongojobs + un-careers + undp + reliefweb otherwise shows up
// N times. Keeps the richest copy active and marks the rest status='hidden'
// (the feed already filters to status='active', so they drop out) with
// raw.duplicateOf pointing at the canonical source_url for attribution/debug.
//
// Idempotent: hidden rows leave the active set, so re-runs are no-ops.
// Dry-run by default. Pass --apply to write.
//
// Usage:
//   pnpm --filter @rue/scraper dedup
//   pnpm --filter @rue/scraper dedup -- --apply

import { eq } from "drizzle-orm";
import { closeDb, getDb, listings } from "@rue/db";
import { clusterDuplicates, type DedupItem } from "./dedup.js";

const apply = process.argv.includes("--apply");

const db = getDb();
const rows = await db
  .select()
  .from(listings)
  .where(eq(listings.status, "active"));

const items: DedupItem[] = rows.map((r) => ({
  id: r.id,
  title: r.title,
  location: r.location,
  descriptionText: r.descriptionText,
  sourceUrl: r.sourceUrl,
}));

const clusters = clusterDuplicates(items);
const rawById = new Map(rows.map((r) => [r.id, r.raw]));

let hidden = 0;
for (const cluster of clusters) {
  const [canonical, ...dups] = cluster;
  console.error(`\n  group "${canonical!.title.slice(0, 50)}" (${cluster.length} copies)`);
  console.error(`    keep  ${canonical!.sourceUrl}`);
  for (const dup of dups) {
    console.error(`    ${apply ? "hide " : "would hide "} ${dup.sourceUrl}`);
    if (apply) {
      await db
        .update(listings)
        .set({ status: "hidden", raw: mergeRaw(rawById.get(dup.id), canonical!.sourceUrl) })
        .where(eq(listings.id, dup.id));
    }
    hidden += 1;
  }
}

console.error(
  `\nscanned ${items.length} active | ${clusters.length} dup-groups | ${apply ? "hid" : "would hide"} ${hidden}${apply ? "" : " (dry-run — pass --apply to write)"}`,
);

await closeDb();

function mergeRaw(raw: unknown, duplicateOf: string): Record<string, unknown> {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { ...base, duplicateOf };
}
