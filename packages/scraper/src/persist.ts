import { classify } from "@rue/classifier";
import { closeDb, getDb, listings, orgs, scrapeRuns, type NewListing } from "@rue/db";
import { FIT_THRESHOLDS } from "@rue/shared";
import { inArray, sql } from "drizzle-orm";
import type { ScrapedListing } from "./index.js";

export type PersistResult = {
  scrapedCount: number;
  keptCount: number;
  newCount: number;
  updatedCount: number;
  errorCount: number;
};

export async function persistListings(
  source: string,
  scraped: ScrapedListing[],
): Promise<PersistResult> {
  const db = getDb();
  const startedAt = new Date();
  const result: PersistResult = {
    scrapedCount: scraped.length,
    keptCount: 0,
    newCount: 0,
    updatedCount: 0,
    errorCount: 0,
  };

  try {
    const orgRows = await db.select({ slug: orgs.slug, name: orgs.name }).from(orgs);
    const sourceUrls = scraped.map((l) => l.sourceUrl);
    const existing =
      sourceUrls.length === 0
        ? []
        : await db
            .select({ sourceUrl: listings.sourceUrl })
            .from(listings)
            .where(inArray(listings.sourceUrl, sourceUrls));
    const existingUrls = new Set(existing.map((r) => r.sourceUrl));

    for (const item of scraped) {
      try {
        const classification = await classify({
          title: item.title,
          description: item.descriptionText,
        });

        if (!classification.fits || classification.fit_score < FIT_THRESHOLDS.showOnSite) {
          continue;
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
          isPaid: item.isPaid,
          stipendText: item.stipendText,
          deadline: item.deadline,
          postedAt: item.postedAt,
          scrapedAt: new Date(),
          descriptionHtml: item.descriptionHtml,
          descriptionText: item.descriptionText,
          fieldTags: classification.fields,
          fitScore: classification.fit_score,
          status: item.deadline && item.deadline < new Date() ? "expired" : "active",
          raw: {
            scraped: item.raw,
            classification,
          },
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
