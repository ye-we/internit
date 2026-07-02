// Reusable "make sure this listing is structured" step, factored out of the
// backfill-structure.ts CLI so other callers (e.g. the bot's repost script) can
// structure + repair listings without duplicating the persistence logic.
//
// For each row it returns the AI StructuredListing (from cache when the body is
// unchanged, else a fresh Gemini call) and the listing with its scalar columns
// repaired in memory. When `apply` is set it also writes raw.structured and the
// repaired columns back to Postgres. The repair mapping mirrors repairValues()
// in backfill-structure.ts — keep the two in sync.

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, listings as listingsTable, type Listing } from "@internit/db";
import type { StructuredListing } from "@internit/shared";
import type { ScrapedListing } from "./index.js";
import { structureListingsBatch } from "./structure.js";

export type StructuredResult = {
  listing: Listing; // repaired deadline / is_paid / status / location applied in memory
  structured: StructuredListing | null; // null when the structurer is off, failed, or produced nothing
  fromCache: boolean;
};

export async function ensureStructured(
  rows: Listing[],
  opts: { force?: boolean; batchSize?: number; apply?: boolean } = {},
): Promise<StructuredResult[]> {
  const { force = false, batchSize = 5, apply = true } = opts;
  const db = getDb();
  const results = new Map<string, StructuredResult>();
  const pending: Array<{ row: Listing; sample: ScrapedListing; contentHash: string }> = [];

  for (const row of rows) {
    const contentHash = hashContent(row.descriptionText);
    const cached = force ? null : readCurrentStructured(row.raw, contentHash);
    if (cached) {
      results.set(row.id, { listing: applyRepairs(row, cached), structured: cached, fromCache: true });
    } else {
      pending.push({ row, sample: fromDbListing(row), contentHash });
    }
  }

  for (const batch of chunks(pending, batchSize)) {
    let structuredByUrl: Map<string, StructuredListing>;
    try {
      structuredByUrl = await structureListingsBatch(batch.map((b) => b.sample));
    } catch {
      // Whole batch failed (network / quota) — leave those unstructured and move
      // on so one bad batch can't abort the run. Re-running picks them up later.
      for (const b of batch) {
        results.set(b.row.id, { listing: b.row, structured: null, fromCache: false });
      }
      continue;
    }

    for (const b of batch) {
      const data = structuredByUrl.get(b.sample.sourceUrl) ?? null;
      if (!data) {
        results.set(b.row.id, { listing: b.row, structured: null, fromCache: false });
        continue;
      }
      const structured = {
        provider: process.env.STRUCTURER_PROVIDER ?? "gemini",
        model: process.env.STRUCTURER_MODEL ?? "gemini-2.5-flash-lite",
        contentHash: b.contentHash,
        extractedAt: new Date().toISOString(),
        data,
      };
      const raw = mergeRaw(b.row.raw, structured);
      if (apply) {
        await db
          .update(listingsTable)
          .set({ raw, ...repairColumns(b.row, data) })
          .where(eq(listingsTable.id, b.row.id));
      }
      // Return the listing with the structured payload merged into raw (and its
      // columns repaired), so callers reading raw.structured.* — e.g. the caption
      // builder's summary/apply-url — see it without re-fetching from Postgres.
      results.set(b.row.id, {
        listing: { ...applyRepairs(b.row, data), raw } as Listing,
        structured: data,
        fromCache: false,
      });
    }
  }

  return rows
    .map((r) => results.get(r.id))
    .filter((r): r is StructuredResult => r !== undefined);
}

function repairColumns(
  row: Listing,
  data: StructuredListing,
): Partial<typeof listingsTable.$inferInsert> {
  const out: Partial<typeof listingsTable.$inferInsert> = {};
  if (data.location) out.location = data.location;
  out.isPaid = data.is_paid;
  out.stipendText = data.stipend_text;
  // Direct application link the LLM pulled from the prose (e.g. the org's ATS
  // behind an Idealist listing). Only fills a gap — the scraper's deterministic
  // extractApplyUrl (ethiongojobs anchors) wins when it found one.
  if (data.application_url && !row.applyUrl) out.applyUrl = data.application_url;
  const deadline = parseDate(data.deadline);
  if (deadline) out.deadline = deadline;
  out.status = statusFor(deadline ?? row.deadline, data);
  const organization = data.organization?.trim();
  if (organization && (row.orgName === "Unknown" || row.orgName.trim().length < 3)) {
    out.orgName = organization;
  }
  return out;
}

function applyRepairs(row: Listing, data: StructuredListing): Listing {
  return { ...row, ...repairColumns(row, data) } as Listing;
}

function statusFor(deadline: Date | null, data: StructuredListing): "active" | "expired" | "hidden" {
  if (deadline && deadline < new Date()) return "expired";
  if (data.ethiopia_access === "not-realistic") return "hidden";
  return "active";
}

function mergeRaw(raw: unknown, structured: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { structured };
  return { ...raw, structured };
}

function readCurrentStructured(raw: unknown, contentHash: string): StructuredListing | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const structured = (raw as { structured?: unknown }).structured;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
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

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
