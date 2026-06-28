// Backfill AI structured data for listings already stored in Postgres.
//
// Usage:
//   pnpm --filter @internit/scraper backfill:structure
//   pnpm --filter @internit/scraper backfill:structure -- --limit 50
//   pnpm --filter @internit/scraper backfill:structure -- --limit all
//   pnpm --filter @internit/scraper backfill:structure -- --force
//   pnpm --filter @internit/scraper backfill:structure -- --repair-columns
//   pnpm --filter @internit/scraper backfill:structure -- --dry-run

import { desc, eq } from "drizzle-orm";
import {
  closeDb,
  getDb,
  listings as listingsTable,
  type Listing,
} from "@internit/db";
import type { StructuredListing } from "@internit/shared";
import { createHash } from "node:crypto";
import type { ScrapedListing } from "./index.js";
import { structureListingsBatch } from "./structure.js";

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const repairColumns = process.argv.includes("--repair-columns");
const limit = parseLimit(valueAfter("--limit") ?? "20");
const batchSize = parseLimit(valueAfter("--batch-size") ?? process.env.STRUCTURER_BATCH_SIZE ?? "5") ?? 5;

console.error("[backfill] structurer env");
console.error(`  enabled:        ${process.env.STRUCTURER_ENABLED ?? "unset"}`);
console.error(`  provider:       ${process.env.STRUCTURER_PROVIDER ?? "gemini"}`);
console.error(`  model:          ${process.env.STRUCTURER_MODEL ?? "gemini-2.5-flash-lite"}`);
console.error(`  key:            ${process.env.GEMINI_API_KEY ? "set" : "missing"}`);
console.error(`  limit:          ${limit ?? "all"}`);
console.error(`  force:          ${force}`);
console.error(`  repairColumns:  ${repairColumns}`);
console.error(`  dryRun:         ${dryRun}`);
console.error(`  batchSize:      ${batchSize}`);

const db = getDb();
const rows = await db
  .select()
  .from(listingsTable)
  .orderBy(desc(listingsTable.scrapedAt))
  .limit(limit ?? 10_000);

let skippedCached = 0;
let skippedDisabled = 0;
let structuredCount = 0;
let updatedCount = 0;
let repairedCached = 0;
let errorCount = 0;
const pending: Array<{ row: Listing; sample: ScrapedListing; contentHash: string }> = [];

for (const row of rows) {
  const contentHash = hashContent(row.descriptionText);
  const cached = readCurrentStructured(row.raw, contentHash);
  if (!force && cached) {
    if (repairColumns) {
      const repairs = repairValues(row, cached);
      if (Object.keys(repairs).length > 0 && !dryRun) {
        await db
          .update(listingsTable)
          .set(repairs)
          .where(eq(listingsTable.id, row.id));
        updatedCount += 1;
        repairedCached += 1;
      }
    }
    skippedCached += 1;
    continue;
  }

  pending.push({ row, sample: fromDbListing(row), contentHash });
}

for (const batch of chunks(pending, batchSize)) {
  console.error(
    `[backfill] structuring batch of ${batch.length}: ${batch
      .map(({ row }) => row.title.slice(0, 32))
      .join(" | ")}`,
  );

  try {
    const structuredByUrl = await structureListingsBatch(batch.map((item) => item.sample));
    for (const item of batch) {
      const data = structuredByUrl.get(item.sample.sourceUrl);
      if (!data) {
        skippedDisabled += 1;
        continue;
      }

      structuredCount += 1;
      const structured = {
        provider: process.env.STRUCTURER_PROVIDER ?? "gemini",
        model: process.env.STRUCTURER_MODEL ?? "gemini-2.5-flash-lite",
        contentHash: item.contentHash,
        extractedAt: new Date().toISOString(),
        data,
      };
      const raw = mergeRaw(item.row.raw, structured);
      const repairs = repairColumns ? repairValues(item.row, data) : {};

      if (!dryRun) {
        await db
          .update(listingsTable)
          .set({
            raw,
            ...repairs,
          })
          .where(eq(listingsTable.id, item.row.id));
        updatedCount += 1;
      }
    }
  } catch (err) {
    errorCount += batch.length;
    console.error(
      `[backfill] failed batch:`,
      err instanceof Error ? err.message : err,
    );
  }
}

console.error("[backfill] done");
console.error(`  scanned:         ${rows.length}`);
console.error(`  cachedSkipped:   ${skippedCached}`);
console.error(`  noOutputSkipped: ${skippedDisabled}`);
console.error(`  structured:      ${structuredCount}`);
console.error(`  repairedCached:  ${repairedCached}`);
console.error(`  updated:         ${updatedCount}`);
console.error(`  errors:          ${errorCount}`);

await closeDb();

function repairValues(row: Listing, data: StructuredListing) {
  const out: Partial<typeof listingsTable.$inferInsert> = {};

  if (data.location) out.location = data.location;
  out.isPaid = data.is_paid;
  out.stipendText = data.stipend_text;

  const deadline = parseDate(data.deadline);
  if (deadline) {
    out.deadline = deadline;
  }
  out.status = statusFor(deadline ?? row.deadline, data);

  const organization = data.organization?.trim();
  if (
    organization &&
    (row.orgName === "Unknown" || row.orgName.trim().length < 3)
  ) {
    out.orgName = organization;
  }

  return out;
}

function statusFor(
  deadline: Date | null,
  data: StructuredListing,
): "active" | "expired" | "hidden" {
  if (deadline && deadline < new Date()) return "expired";
  if (data.ethiopia_access === "not-realistic") return "hidden";
  return "active";
}

function mergeRaw(raw: unknown, structured: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { structured };
  }
  return {
    ...raw,
    structured,
  };
}

function hasCurrentStructured(raw: unknown, contentHash: string): boolean {
  return readCurrentStructured(raw, contentHash) !== null;
}

function readCurrentStructured(
  raw: unknown,
  contentHash: string,
): StructuredListing | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const structured = (raw as { structured?: unknown }).structured;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) {
    return null;
  }
  const payload = structured as { contentHash?: unknown; data?: unknown };
  if (payload.contentHash !== contentHash) return null;
  return payload.data as StructuredListing;
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

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
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

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
