import { createHash } from "node:crypto";
import { classify } from "@internit/classifier";
import { closeDb, getDb, listings, orgs, scrapeRuns, type NewListing } from "@internit/db";
import { FIT_THRESHOLDS, type Classification } from "@internit/shared";

// A stored classification tagged with a hash of the text it was made from, so a
// re-scrape can reuse it (and skip the LLM call) when the posting is unchanged.
type CachedClassification = Classification & { contentHash: string };
import { inArray, sql } from "drizzle-orm";
import type { DispatchResult } from "./dispatch.js";
import { ethiopiaAccess } from "./filter.js";
import { extractGaps } from "./llm-extract.js";
import { findDeadlineInText } from "./text-extract.js";
import type { ScrapedListing } from "./index.js";

// Cached guarded-LLM extraction of the fields deterministic parsing missed.
type GapCache = { contentHash: string; deadline: string | null; isPaid: boolean | null };

export type PersistResult = {
  scrapedCount: number;
  keptCount: number;
  newCount: number;
  updatedCount: number;
  errorCount: number;
};

export type OrgRunStats = {
  slug: string;
  adapter: string | null;
  fetched: number;
  kept: number;
  new: number;
  updated: number;
  errors: number;
  durationMs: number;
  error?: string;
};

export type OrgRunResult = PersistResult & { orgs: OrgRunStats[] };

type Db = ReturnType<typeof getDb>;
type OrgRow = { slug: string; name: string };

export async function persistListings(
  source: string,
  scraped: ScrapedListing[],
): Promise<PersistResult> {
  const db = getDb();
  const startedAt = new Date();

  try {
    const orgRows = await db.select({ slug: orgs.slug, name: orgs.name }).from(orgs);
    const result = await upsertBatch(db, orgRows, scraped);

    await db.insert(scrapeRuns).values({
      source,
      startedAt,
      finishedAt: new Date(),
      newCount: result.newCount,
      updatedCount: result.updatedCount,
      errorCount: result.errorCount,
      log: result,
    });

    return result;
  } finally {
    await closeDb();
  }
}

// Persists a whole org-dispatch run as ONE scrape_runs row; per-org stats
// (including dispatch failures like "browser challenge") go into log.orgs so
// the admin dashboard can show coverage without a schema change.
export async function persistOrgRun(results: DispatchResult[]): Promise<OrgRunResult> {
  const db = getDb();
  const startedAt = new Date();
  const orgStats: OrgRunStats[] = [];
  const total: PersistResult = {
    scrapedCount: 0,
    keptCount: 0,
    newCount: 0,
    updatedCount: 0,
    errorCount: 0,
  };

  try {
    const orgRows = await db.select({ slug: orgs.slug, name: orgs.name }).from(orgs);

    for (const r of results) {
      const stats: OrgRunStats = {
        slug: r.org.slug,
        adapter: r.adapter,
        fetched: r.listings.length,
        kept: 0,
        new: 0,
        updated: 0,
        errors: 0,
        durationMs: r.durationMs,
      };
      if (r.error) {
        stats.error = r.error;
        total.errorCount += 1;
      }
      if (r.listings.length > 0) {
        const batch = await upsertBatch(db, orgRows, r.listings);
        stats.kept = batch.keptCount;
        stats.new = batch.newCount;
        stats.updated = batch.updatedCount;
        stats.errors = batch.errorCount;
        total.scrapedCount += batch.scrapedCount;
        total.keptCount += batch.keptCount;
        total.newCount += batch.newCount;
        total.updatedCount += batch.updatedCount;
        total.errorCount += batch.errorCount;
      }
      orgStats.push(stats);
    }

    await db.insert(scrapeRuns).values({
      source: "orgs",
      startedAt,
      finishedAt: new Date(),
      newCount: total.newCount,
      updatedCount: total.updatedCount,
      errorCount: total.errorCount,
      log: { ...total, orgs: orgStats },
    });

    return { ...total, orgs: orgStats };
  } finally {
    await closeDb();
  }
}

async function upsertBatch(
  db: Db,
  orgRows: OrgRow[],
  scraped: ScrapedListing[],
): Promise<PersistResult> {
  const result: PersistResult = {
    scrapedCount: scraped.length,
    keptCount: 0,
    newCount: 0,
    updatedCount: 0,
    errorCount: 0,
  };

  const sourceUrls = scraped.map((l) => l.sourceUrl);
  const existing =
    sourceUrls.length === 0
      ? []
      : await db
          .select({ sourceUrl: listings.sourceUrl, raw: listings.raw })
          .from(listings)
          .where(inArray(listings.sourceUrl, sourceUrls));
  const existingUrls = new Set(existing.map((r) => r.sourceUrl));
  // Reuse a stored classification when the posting text is unchanged, so daily
  // re-scrapes don't re-spend the LLM budget on listings already judged.
  const cachedClassification = new Map<string, CachedClassification>();
  const cachedGaps = new Map<string, GapCache>();
  for (const r of existing) {
    const raw = r.raw as { classification?: CachedClassification; gaps?: GapCache } | null;
    const c = raw?.classification;
    if (c && typeof c === "object" && typeof c.contentHash === "string") {
      cachedClassification.set(r.sourceUrl, c);
    }
    const g = raw?.gaps;
    if (g && typeof g === "object" && typeof g.contentHash === "string") {
      cachedGaps.set(r.sourceUrl, g);
    }
  }

  for (const item of scraped) {
    try {
      // Recover a deadline from the body when the adapter missed it, then drop
      // closed postings (a passed deadline is useless to a student) and undated
      // postings that are clearly stale. Deadlines in the body — e.g. UN
      // "Deadline Date: Tuesday, January 4, 2022" — otherwise slip through as
      // null and show up as "active" forever.
      const deadline = item.deadline ?? findDeadlineInText(item.descriptionText);
      const nowMs = Date.now();
      if (deadline && deadline.getTime() < nowMs - DAY_MS) continue;
      if (!deadline && item.postedAt && nowMs - item.postedAt.getTime() > STALE_MS) continue;

      const access = ethiopiaAccess({
        location: item.location,
        title: item.title,
        descriptionText: item.descriptionText,
      });
      // Never surface an in-person role outside Ethiopia. Trust the domestic
      // Ethiopian sources (local boards) over the heuristic.
      if (!access.accessible && !DOMESTIC_SOURCES.has(baseSource(item.source))) {
        continue;
      }

      const contentHash = createHash("sha256").update(item.descriptionText).digest("hex");
      const cached = cachedClassification.get(item.sourceUrl);
      const classification: CachedClassification =
        cached && cached.contentHash === contentHash
          ? cached
          : {
              ...(await classify({ title: item.title, description: item.descriptionText })),
              contentHash,
            };

      if (!classification.fits || classification.fit_score < FIT_THRESHOLDS.showOnSite) {
        continue;
      }

      // Fill the gaps deterministic parsing left — deadline / paid — with a
      // guarded, evidence-verified LLM pass (cached by content hash). Only runs
      // for kept listings still missing one of those fields.
      let finalDeadline = deadline;
      let finalIsPaid = item.isPaid;
      let gapCache: GapCache | undefined;
      if (finalDeadline === null || finalIsPaid === null) {
        const prior = cachedGaps.get(item.sourceUrl);
        const gaps =
          prior && prior.contentHash === contentHash
            ? { deadline: prior.deadline ? new Date(prior.deadline) : null, isPaid: prior.isPaid }
            : await extractGaps({ title: item.title, descriptionText: item.descriptionText });
        gapCache = { contentHash, deadline: gaps.deadline?.toISOString() ?? null, isPaid: gaps.isPaid };
        if (finalDeadline === null) finalDeadline = gaps.deadline;
        if (finalIsPaid === null) finalIsPaid = gaps.isPaid;
        // A deadline the LLM recovered may already be closed — don't ingest dead postings.
        if (finalDeadline && finalDeadline.getTime() < Date.now() - DAY_MS) continue;
      }

      const value: NewListing = {
        source: item.source,
        sourceUrl: item.sourceUrl,
        sourceId: item.sourceId,
        orgName: item.orgName,
        orgSlug: item.orgSlug ?? matchOrgSlug(item.orgName, orgRows),
        title: item.title,
        location: item.location,
        isRemote: item.isRemote,
        isPaid: finalIsPaid,
        stipendText: item.stipendText,
        deadline: finalDeadline,
        postedAt: item.postedAt,
        scrapedAt: new Date(),
        descriptionHtml: item.descriptionHtml,
        descriptionText: item.descriptionText,
        fieldTags: classification.fields,
        fitScore: classification.fit_score,
        status: statusFor(finalDeadline),
        raw: { scraped: item.raw, classification, access, ...(gapCache ? { gaps: gapCache } : {}) },
      };

      await db
        .insert(listings)
        .values(value)
        .onConflictDoUpdate({
          target: listings.sourceUrl,
          set: {
            sourceId: sql`excluded.source_id`,
            orgName: sql`excluded.org_name`,
            orgSlug: sql`excluded.org_slug`,
            title: sql`excluded.title`,
            location: sql`excluded.location`,
            isRemote: sql`excluded.is_remote`,
            isPaid: sql`excluded.is_paid`,
            stipendText: sql`excluded.stipend_text`,
            deadline: sql`excluded.deadline`,
            postedAt: sql`excluded.posted_at`,
            scrapedAt: sql`excluded.scraped_at`,
            descriptionHtml: sql`excluded.description_html`,
            descriptionText: sql`excluded.description_text`,
            fieldTags: sql`excluded.field_tags`,
            fitScore: sql`excluded.fit_score`,
            status: sql`excluded.status`,
            raw: sql`excluded.raw`,
          },
        });

      result.keptCount += 1;
      if (existingUrls.has(item.sourceUrl)) {
        result.updatedCount += 1;
      } else {
        result.newCount += 1;
      }
    } catch (err) {
      result.errorCount += 1;
      console.error(`[scraper] failed to persist ${item.sourceUrl}:`, err);
    }
  }

  return result;
}

// Sources that post only locally-accessible Ethiopian roles; their listings
// bypass the Ethiopia-access heuristic (which can't always see "Ethiopia" in
// the body of an already-domestic posting).
const DOMESTIC_SOURCES = new Set(["ethiongojobs", "ehrdc", "undp"]);

const DAY_MS = 86_400_000;
const STALE_MS = 120 * DAY_MS; // undated postings older than ~4 months are dead

function baseSource(source: string): string {
  const i = source.indexOf(":");
  return i === -1 ? source : source.slice(0, i);
}

function statusFor(deadline: Date | null): "active" | "expired" | "hidden" {
  if (deadline && deadline < new Date()) return "expired";
  return "active";
}

function matchOrgSlug(
  orgName: string,
  orgRows: Array<{ slug: string; name: string }>,
): string | null {
  const normalized = normalizeOrgName(orgName);
  if (!normalized || normalized === "unknown") return null;

  const exact = orgRows.find((o) => normalizeOrgName(o.name) === normalized);
  if (exact) return exact.slug;

  const contained = orgRows.find((o) => {
    const candidate = normalizeOrgName(o.name);
    return candidate.length > 8 && normalized.includes(candidate);
  });
  return contained?.slug ?? null;
}

function normalizeOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(the|inc|ltd|plc|ngo|organization|organisation)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
