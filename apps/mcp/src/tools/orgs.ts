// ---------------------------------------------------------------------------
// tools/orgs.ts — the organization directory tools (read-only).
//
// Backed by the `orgs` table — the cold-outreach directory described in
// CLAUDE.md. Students browse orgs that don't post publicly and contact them
// directly, so exposing this to an agent lets it answer "who should I email
// about a governance internship?" style questions.
// ---------------------------------------------------------------------------

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, eq, getDb, listings, orgs } from "@internit/db";
import { ok, fail, toSummary } from "../format.js";

export function registerOrgTools(server: McpServer) {
  // --- list_orgs -----------------------------------------------------------
  server.registerTool(
    "list_orgs",
    {
      title: "List organizations (directory)",
      description:
        "Browse the organization directory. Filter by category, region, " +
        "whether the org posts openings publicly, and scrape priority. " +
        "posts_publicly is one of 'yes' | 'no' | 'sometimes' | 'unknown'; " +
        "orgs marked 'no'/'sometimes' are the cold-outreach targets students " +
        "contact directly.",
      inputSchema: {
        category: z.string().optional().describe("Exact category match."),
        region: z.string().optional().describe("Exact region match."),
        posts_publicly: z
          .enum(["yes", "no", "sometimes", "unknown"])
          .optional()
          .describe("Filter by whether the org advertises openings publicly."),
        scrape_priority: z
          .enum(["critical", "high", "medium", "low"])
          .optional()
          .describe("Filter by scraping priority."),
        limit: z.number().int().min(1).max(100).default(50),
      },
    },
    async (args) => {
      const conds = [];
      if (args.category) conds.push(eq(orgs.category, args.category));
      if (args.region) conds.push(eq(orgs.region, args.region));
      if (args.posts_publicly)
        conds.push(eq(orgs.postsPublicly, args.posts_publicly));
      if (args.scrape_priority)
        conds.push(eq(orgs.scrapePriority, args.scrape_priority));

      const rows = await getDb()
        .select()
        .from(orgs)
        .where(conds.length ? and(...conds) : undefined)
        .limit(args.limit);
      return ok({ count: rows.length, orgs: rows });
    },
  );

  // --- get_org -------------------------------------------------------------
  server.registerTool(
    "get_org",
    {
      title: "Get one organization + its listings",
      description:
        "Fetch a single organization by slug, including how to apply " +
        "(website, careersUrl, internshipUrl, applicationEmail) and its " +
        "current listings (as compact summaries).",
      inputSchema: {
        slug: z.string().describe("The org slug (primary key)."),
      },
    },
    async ({ slug }) => {
      const org = await getDb().query.orgs.findFirst({
        where: eq(orgs.slug, slug),
      });
      if (!org) return fail(`No organization found with slug '${slug}'.`);

      const orgListings = await getDb()
        .select()
        .from(listings)
        .where(and(eq(listings.orgSlug, slug), eq(listings.status, "active")));

      return ok({ org, listings: orgListings.map(toSummary) });
    },
  );
}
