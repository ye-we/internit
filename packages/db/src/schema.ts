import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Orgs: 231-row seed loaded from orgs-seed.csv. Slug is the primary key
// because it's what listings reference and what the CSV is keyed on.
export const orgs = pgTable(
  "orgs",
  {
    slug: text("slug").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    region: text("region"),
    addisOffice: boolean("addis_office"),

    website: text("website"),
    careersUrl: text("careers_url"),
    internshipUrl: text("internship_url"),
    applicationEmail: text("application_email"),

    twitter: text("twitter"),
    linkedin: text("linkedin"),
    telegram: text("telegram"),

    // 'yes' | 'no' | 'sometimes' | 'unknown' — controls whether the org
    // appears in the scraping pipeline (yes/sometimes) or only the
    // cold-outreach directory (no/unknown).
    postsPublicly: text("posts_publicly").notNull().default("unknown"),
    // CSV uses 'yes' | 'no' | 'sometimes' for these — kept as text so we
    // don't lose the 'sometimes' signal.
    hasRemote: text("has_remote"),
    hasPaid: text("has_paid"),

    // 'critical' | 'high' | 'medium' | 'low'
    scrapePriority: text("scrape_priority"),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    categoryIdx: index("orgs_category_idx").on(t.category),
    postsPubliclyIdx: index("orgs_posts_publicly_idx").on(t.postsPublicly),
    scrapePriorityIdx: index("orgs_scrape_priority_idx").on(t.scrapePriority),
  }),
);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceId: text("source_id"),

    orgName: text("org_name").notNull(),
    // Soft FK to orgs.slug — nullable because a scraped listing may
    // mention an org we haven't seeded yet.
    orgSlug: text("org_slug").references(() => orgs.slug, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    location: text("location"),
    isRemote: boolean("is_remote").notNull().default(false),
    // null = unclear from the source; never invent.
    isPaid: boolean("is_paid"),
    stipendText: text("stipend_text"),

    deadline: timestamp("deadline", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    scrapedAt: timestamp("scraped_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    descriptionHtml: text("description_html").notNull(),
    descriptionText: text("description_text").notNull(),

    fieldTags: text("field_tags").array().notNull().default(sql`'{}'::text[]`),
    fitScore: integer("fit_score").notNull().default(0),

    // 'active' | 'expired' | 'hidden'
    status: text("status").notNull().default("active"),

    raw: jsonb("raw"),
  },
  (t) => ({
    sourceUrlUnique: uniqueIndex("listings_source_url_unique").on(t.sourceUrl),
    sourceIdx: index("listings_source_idx").on(t.source),
    deadlineIdx: index("listings_deadline_idx").on(t.deadline),
    statusIdx: index("listings_status_idx").on(t.status),
    fitScoreIdx: index("listings_fit_score_idx").on(t.fitScore),
    orgSlugIdx: index("listings_org_slug_idx").on(t.orgSlug),
  }),
);

// Telegram subscribers. chat_id is the natural PK from Telegram.
export const subscribers = pgTable("subscribers", {
  chatId: bigint("chat_id", { mode: "bigint" }).primaryKey(),
  username: text("username"),
  joinedAt: timestamp("joined_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // { fields: string[], paid_only: boolean, remote_ok: boolean }
  filters: jsonb("filters")
    .notNull()
    .default(sql`'{"fields":[],"paid_only":false,"remote_ok":true}'::jsonb`),
  savedListingIds: uuid("saved_listing_ids")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  notify24h: boolean("notify_24h").notNull().default(true),
  notify72h: boolean("notify_72h").notNull().default(true),
});

export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    newCount: integer("new_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    log: jsonb("log"),
  },
  (t) => ({
    sourceStartedIdx: index("scrape_runs_source_started_idx").on(
      t.source,
      t.startedAt,
    ),
  }),
);

export type Org = typeof orgs.$inferSelect;
export type NewOrg = typeof orgs.$inferInsert;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type Subscriber = typeof subscribers.$inferSelect;
export type NewSubscriber = typeof subscribers.$inferInsert;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type NewScrapeRun = typeof scrapeRuns.$inferInsert;
