// Re-extract structured fields + clean reader-mode HTML for generic:* HTML
// listings captured by the old whole-page extractor — rows where the nav/footer
// shell was dumped into description_*, the location fused with trailing page
// text, the deadline went unparsed, and is_paid stayed null.
//
// It re-runs the CURRENT generic-html extractor per row. The original page HTML
// was never persisted, so the first pass RE-FETCHES each posting (politely,
// rate-limited via PoliteFetcher) and heals raw.scraped.containerHtml so any
// future re-extraction (e.g. a later cleaning improvement) needs no network.
//
// Dry-run by default — prints what would change. Pass --apply to write.
//
// Usage:
//   pnpm --filter @rue/scraper backfill:generic                       # dry-run, 20 rows
//   pnpm --filter @rue/scraper backfill:generic -- --apply
//   pnpm --filter @rue/scraper backfill:generic -- --apply --limit all
//   pnpm --filter @rue/scraper backfill:generic -- --apply --source generic:uneca.org
//   pnpm --filter @rue/scraper backfill:generic -- --apply --refetch  # ignore cached containerHtml

import { eq, like } from "drizzle-orm";
import { closeDb, getDb, listings as listingsTable, type Listing } from "@rue/db";
import { PoliteFetcher } from "./fetcher.js";
import { BrowserChallengeError, isBrowserInterstitial } from "./html.js";
import { buildListing, selectContainerHtml } from "./adapters/generic-html.js";
import type { ScrapedListing } from "./index.js";

const apply = process.argv.includes("--apply");
const refetch = process.argv.includes("--refetch");
const sourceFilter = valueAfter("--source");
const limit = parseLimit(valueAfter("--limit") ?? "20");

type Changes = Partial<typeof listingsTable.$inferInsert>;

const db = getDb();
const fetcher = new PoliteFetcher();

const rows = await db
  .select()
  .from(listingsTable)
  .where(sourceFilter ? eq(listingsTable.source, sourceFilter) : like(listingsTable.source, "generic:%"))
  .limit(limit ?? 100_000);

console.error("[backfill-generic]");
console.error(`  mode:     ${apply ? "APPLY" : "dry-run"}`);
console.error(`  source:   ${sourceFilter ?? "generic:%"}`);
console.error(`  refetch:  ${refetch}`);
console.error(`  rows:     ${rows.length}`);

let refetched = 0;
let fromCache = 0;
let changed = 0;
let updated = 0;
let unchanged = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  try {
    const next = await reextract(row);
    if (!next) {
      skipped += 1;
      continue;
    }
    const changes = diff(row, next);
    if (Object.keys(changes).length === 0) {
      unchanged += 1;
      continue;
    }
    changed += 1;
    logChange(row, changes);
    if (apply) {
      await db
        .update(listingsTable)
        .set({ ...changes, raw: mergeRaw(row.raw, next.raw), scrapedAt: new Date() })
        .where(eq(listingsTable.id, row.id));
      updated += 1;
    }
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${row.sourceUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.error("[backfill-generic] done");
console.error(`  refetched:  ${refetched}`);
console.error(`  fromCache:  ${fromCache}`);
console.error(`  changed:    ${changed}`);
console.error(`  updated:    ${updated}${apply ? "" : " (dry-run: nothing written)"}`);
console.error(`  unchanged:  ${unchanged}`);
console.error(`  skipped:    ${skipped}`);
console.error(`  failed:     ${failed}`);

await closeDb();

async function reextract(row: Listing): Promise<ScrapedListing | null> {
  const cached = readContainerHtml(row.raw);
  if (cached && !refetch) {
    fromCache += 1;
    return buildListing({
      containerHtml: cached,
      title: row.title,
      sourceUrl: row.sourceUrl,
      orgName: row.orgName,
      orgSlug: row.orgSlug,
    });
  }

  const html = await fetcher.get(row.sourceUrl);
  if (isBrowserInterstitial(html)) throw new BrowserChallengeError(row.sourceUrl);
  const selected = selectContainerHtml(html);
  if (!selected) return null;
  refetched += 1;
  return buildListing({
    containerHtml: selected.containerHtml,
    title: selected.title || row.title,
    sourceUrl: row.sourceUrl,
    orgName: row.orgName,
    orgSlug: row.orgSlug,
  });
}

function diff(row: Listing, next: ScrapedListing): Changes {
  const out: Changes = {};
  if (next.descriptionHtml && next.descriptionHtml !== row.descriptionHtml) {
    out.descriptionHtml = next.descriptionHtml;
  }
  if (next.descriptionText && next.descriptionText !== row.descriptionText) {
    out.descriptionText = next.descriptionText;
  }
  if (next.location !== row.location) out.location = next.location;
  if (next.isPaid !== row.isPaid) out.isPaid = next.isPaid;
  if (next.stipendText !== row.stipendText) out.stipendText = next.stipendText;
  if (next.isRemote !== row.isRemote) out.isRemote = next.isRemote;

  // Only ever fill or correct a deadline — never clear a known one to null.
  if (next.deadline && (!row.deadline || +next.deadline !== +row.deadline)) {
    out.deadline = next.deadline;
    out.status = next.deadline < new Date() ? "expired" : "active";
  }
  return out;
}

function logChange(row: Listing, changes: Changes): void {
  const fields = Object.keys(changes)
    .filter((k) => k !== "descriptionHtml" && k !== "descriptionText" && k !== "status")
    .map((k) => `${k}=${JSON.stringify((changes as Record<string, unknown>)[k])}`);
  const desc = changes.descriptionText
    ? `desc ${row.descriptionText.length}→${changes.descriptionText.length} chars`
    : "";
  console.error(`  • ${row.source} ${row.sourceUrl}`);
  console.error(`      ${[desc, ...fields].filter(Boolean).join("  ")}`);
}

// Keep prior raw (classification, access, structurer output) and refresh the
// scraped sub-object with the new meta + scoped container HTML.
function mergeRaw(existing: unknown, nextRaw: unknown): Record<string, unknown> {
  const base = isRecord(existing) ? existing : {};
  const prevScraped = isRecord(base.scraped) ? base.scraped : {};
  const nextScraped = isRecord(nextRaw) ? nextRaw : {};
  return { ...base, scraped: { ...prevScraped, ...nextScraped } };
}

function readContainerHtml(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const scraped = raw.scraped;
  if (!isRecord(scraped)) return null;
  const html = scraped.containerHtml;
  return typeof html === "string" && html.length > 0 ? html : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseLimit(raw: string): number | null {
  if (raw === "all") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid --limit value: ${raw}`);
  }
  return value;
}

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}
