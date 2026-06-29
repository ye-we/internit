// ---------------------------------------------------------------------------
// tools/stats.ts — a single read-only "what's in the pipeline" tool.
//
// Uses raw SQL via the `sql` tag for the aggregates (unnesting the fieldTags
// array, grouping) since these don't map cleanly to the select-builder. All
// still go through the same pooled connection from getDb().
// ---------------------------------------------------------------------------

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb, sql } from "@internit/db";
import { ok } from "../format.js";

export function registerStatsTools(server: McpServer) {
  server.registerTool(
    "stats",
    {
      title: "Pipeline stats",
      description:
        "High-level counts across the dataset: total listings by status, a " +
        "breakdown of active listings by field tag, org counts by " +
        "posts_publicly, and the most recent scrape run. Use this to answer " +
        "'how much data is there?' before drilling in with search_listings.",
      inputSchema: {},
    },
    async () => {
      const db = getDb();

      const byStatus = await db.execute(
        sql`SELECT status, count(*)::int AS count FROM listings GROUP BY status ORDER BY count DESC`,
      );
      const byField = await db.execute(
        sql`SELECT unnest(field_tags) AS field, count(*)::int AS count
            FROM listings WHERE status = 'active'
            GROUP BY field ORDER BY count DESC`,
      );
      const orgsByPosts = await db.execute(
        sql`SELECT posts_publicly, count(*)::int AS count
            FROM orgs GROUP BY posts_publicly ORDER BY count DESC`,
      );
      const latestRun = await db.execute(
        sql`SELECT source, started_at, finished_at, new_count, updated_count, error_count
            FROM scrape_runs ORDER BY started_at DESC LIMIT 1`,
      );

      return ok({
        listingsByStatus: byStatus,
        activeListingsByField: byField,
        orgsByPostsPublicly: orgsByPosts,
        latestScrapeRun: latestRun[0] ?? null,
      });
    },
  );
}
