// ---------------------------------------------------------------------------
// tools/listings.ts — the listing-facing MCP tools.
//
// Every tool here is READ-ONLY and backed by the real `listings` table via
// @internit/db. No new data layer: we reuse getDb() and the same drizzle
// operators the bot/worker use, so behavior stays consistent with the app.
//
// ⭐ The description strings and .describe() text below are the ONLY thing the
//    model reads. Domain rules from CLAUDE.md are encoded here on purpose —
//    isPaid semantics, fit_score bands, valid status values — so the model
//    interprets the data correctly instead of guessing.
// ---------------------------------------------------------------------------

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FIELD_TAGS } from "@internit/shared";
import { and, desc, eq, getDb, gte, ilike, listings, sql } from "@internit/db";
import { ok, fail, toSummary } from "../format.js";

const FIELD_ENUM = z.enum(FIELD_TAGS as unknown as [string, ...string[]]);

export function registerListingTools(server: McpServer) {
  // --- search_listings -----------------------------------------------------
  server.registerTool(
    "search_listings",
    {
      title: "Search internship listings",
      description:
        "Search and filter internship listings for Ethiopian social-studies " +
        "students. Returns compact summaries (no full description — call " +
        "get_listing for that). All filters are optional and combine with AND. " +
        "Results are ordered by fit_score (highest first). fit_score: 90-100 " +
        "bullseye, 70-89 strong, 50-69 adjacent, <50 usually not shown.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Free text matched against title and description."),
        field: FIELD_ENUM.optional().describe(
          "Restrict to listings tagged with this field.",
        ),
        paid: z
          .boolean()
          .optional()
          .describe(
            "true = only paid, false = only unpaid. Omit to include all. " +
              "Note: listings with unknown pay status are excluded when this is set.",
          ),
        remote: z.boolean().optional().describe("Filter by remote/on-site."),
        status: z
          .enum(["active", "expired", "hidden"])
          .optional()
          .describe("Listing status. Defaults to 'active' when omitted."),
        deadline_within_days: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Only listings whose deadline falls within this many days."),
        min_fit_score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe("Minimum fit_score (0-100)."),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      },
    },
    async (args) => {
      const conds = [];

      // Default to active listings unless the caller asks for another status.
      conds.push(eq(listings.status, args.status ?? "active"));

      if (args.query) {
        const p = `%${args.query}%`;
        // No `or` is re-exported from @internit/db, so express it as SQL.
        conds.push(
          sql`(${ilike(listings.title, p)} OR ${ilike(listings.descriptionText, p)})`,
        );
      }
      if (args.field) conds.push(sql`${args.field} = ANY(${listings.fieldTags})`);
      if (args.paid !== undefined) conds.push(eq(listings.isPaid, args.paid));
      if (args.remote !== undefined) conds.push(eq(listings.isRemote, args.remote));
      if (args.min_fit_score !== undefined)
        conds.push(gte(listings.fitScore, args.min_fit_score));
      if (args.deadline_within_days !== undefined) {
        const cutoff = new Date(
          Date.now() + args.deadline_within_days * 86_400_000,
        );
        conds.push(gte(listings.deadline, new Date()));
        conds.push(sql`${listings.deadline} <= ${cutoff}`);
      }

      const rows = await getDb()
        .select()
        .from(listings)
        .where(and(...conds))
        .orderBy(desc(listings.fitScore))
        .limit(args.limit)
        .offset(args.offset);

      return ok({ count: rows.length, listings: rows.map(toSummary) });
    },
  );

  // --- get_listing ---------------------------------------------------------
  server.registerTool(
    "get_listing",
    {
      title: "Get one listing (full reader-mode payload)",
      description:
        "Fetch a single listing by id, including the full cleaned description " +
        "(descriptionHtml for display, descriptionText for reading) and the " +
        "linked organization. Use search_listings first to find an id.",
      inputSchema: {
        id: z.string().uuid().describe("The listing id (uuid)."),
      },
    },
    async ({ id }) => {
      const row = await getDb().query.listings.findFirst({
        where: eq(listings.id, id),
        with: { org: true },
      });
      if (!row) return fail(`No listing found with id '${id}'.`);
      return ok(row);
    },
  );

  // --- upcoming_deadlines --------------------------------------------------
  server.registerTool(
    "upcoming_deadlines",
    {
      title: "Upcoming application deadlines",
      description:
        "List active listings whose application deadline is approaching, " +
        "soonest first. Useful for reminder-style questions like 'what closes " +
        "this week?'. Returns compact summaries.",
      inputSchema: {
        within_days: z
          .number()
          .int()
          .positive()
          .max(90)
          .default(7)
          .describe("Look this many days ahead. Default 7."),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ within_days, limit }) => {
      const now = new Date();
      const cutoff = new Date(Date.now() + within_days * 86_400_000);
      const rows = await getDb()
        .select()
        .from(listings)
        .where(
          and(
            eq(listings.status, "active"),
            gte(listings.deadline, now),
            sql`${listings.deadline} <= ${cutoff}`,
          ),
        )
        .orderBy(listings.deadline)
        .limit(limit);
      return ok({ count: rows.length, listings: rows.map(toSummary) });
    },
  );
}
