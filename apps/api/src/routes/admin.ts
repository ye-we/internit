import { Hono } from "hono";
import type { Context } from "hono";
import { desc, eq, getDb, inArray, listings, orgs, scrapeRuns, sql } from "@rue/db";
import { findAdapter } from "@rue/scraper";
import { auth } from "../lib/auth.js";

const admin = new Hono();

async function requireAdmin(c: Context): Promise<Response | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (session.user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  return null;
}

admin.get("/api/admin/scrape-runs", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 30), 1), 100);
  const rows = await getDb()
    .select()
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(limit);

  return c.json(
    rows.map((r) => ({
      id: r.id,
      source: r.source,
      started_at: r.startedAt.toISOString(),
      finished_at: r.finishedAt?.toISOString() ?? null,
      new_count: r.newCount,
      updated_count: r.updatedCount,
      error_count: r.errorCount,
      log: r.log,
    })),
  );
});

type OrgRunStat = {
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

admin.get("/api/admin/coverage", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const db = getDb();

  const [eligibleOrgs, latestRunRows, listingCounts] = await Promise.all([
    db
      .select({
        slug: orgs.slug,
        name: orgs.name,
        category: orgs.category,
        scrapePriority: orgs.scrapePriority,
        postsPublicly: orgs.postsPublicly,
        careersUrl: orgs.careersUrl,
        internshipUrl: orgs.internshipUrl,
      })
      .from(orgs)
      .where(inArray(orgs.postsPublicly, ["yes", "sometimes"])),
    db
      .select()
      .from(scrapeRuns)
      .where(eq(scrapeRuns.source, "orgs"))
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(1),
    db
      .select({
        orgSlug: listings.orgSlug,
        active: sql<number>`count(*) filter (where ${listings.status} = 'active')`,
        total: sql<number>`count(*)`,
      })
      .from(listings)
      .groupBy(listings.orgSlug),
  ]);

  const latestRun = latestRunRows[0] ?? null;
  const runStats = new Map<string, OrgRunStat>();
  const log = latestRun?.log as { orgs?: OrgRunStat[] } | null;
  for (const stat of log?.orgs ?? []) runStats.set(stat.slug, stat);

  const counts = new Map(
    listingCounts
      .filter((r) => r.orgSlug !== null)
      .map((r) => [r.orgSlug as string, { active: Number(r.active), total: Number(r.total) }]),
  );

  const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const coverage = eligibleOrgs
    .map((org) => {
      const url = org.internshipUrl ?? org.careersUrl;
      const stat = runStats.get(org.slug) ?? null;
      const count = counts.get(org.slug) ?? { active: 0, total: 0 };
      return {
        slug: org.slug,
        name: org.name,
        category: org.category,
        scrape_priority: org.scrapePriority,
        posts_publicly: org.postsPublicly,
        url,
        predicted_adapter: url ? (findAdapter(url)?.name ?? null) : null,
        last_run: stat
          ? {
              adapter: stat.adapter,
              fetched: stat.fetched,
              kept: stat.kept,
              new: stat.new,
              updated: stat.updated,
              errors: stat.errors,
              duration_ms: stat.durationMs,
              error: stat.error ?? null,
            }
          : null,
        active_listings: count.active,
        total_listings: count.total,
      };
    })
    .sort(
      (a, b) =>
        (priorityRank[a.scrape_priority ?? ""] ?? 9) - (priorityRank[b.scrape_priority ?? ""] ?? 9) ||
        a.name.localeCompare(b.name),
    );

  return c.json({
    latest_run: latestRun
      ? {
          id: latestRun.id,
          started_at: latestRun.startedAt.toISOString(),
          finished_at: latestRun.finishedAt?.toISOString() ?? null,
          new_count: latestRun.newCount,
          updated_count: latestRun.updatedCount,
          error_count: latestRun.errorCount,
        }
      : null,
    orgs: coverage,
  });
});

export { admin };
