import {
  pgTable,
  text,
  boolean,
  integer,
  bigint,
  timestamp,
  uuid,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

const tstz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

// uuid() PKs were `@default(uuid())` in Prisma — generated app-side, not by the
// DB — so we keep that behavior with crypto.randomUUID() rather than adding a
// DB-level default that would diverge from the existing schema.
const uuidPk = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

// ---------------------------------------------------------------------------
// Application tables
// ---------------------------------------------------------------------------

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
    postsPublicly: text("posts_publicly").notNull().default("unknown"),
    hasRemote: text("has_remote"),
    hasPaid: text("has_paid"),
    scrapePriority: text("scrape_priority"),
    notes: text("notes"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("orgs_category_idx").on(t.category),
    index("orgs_posts_publicly_idx").on(t.postsPublicly),
    index("orgs_scrape_priority_idx").on(t.scrapePriority),
  ],
);

export const listings = pgTable(
  "listings",
  {
    id: uuidPk(),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceId: text("source_id"),
    // Direct application/source link parsed out of the posting body (e.g. the
    // org's own ATS behind ethiongojobs' "CLICK HERE TO APPLY"), so readers skip
    // the aggregator. sourceUrl stays the attribution link.
    applyUrl: text("apply_url"),
    orgName: text("org_name").notNull(),
    orgSlug: text("org_slug").references(() => orgs.slug, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    location: text("location"),
    isRemote: boolean("is_remote").notNull().default(false),
    isPaid: boolean("is_paid"),
    stipendText: text("stipend_text"),
    deadline: tstz("deadline"),
    postedAt: tstz("posted_at"),
    scrapedAt: tstz("scraped_at").notNull().defaultNow(),
    descriptionHtml: text("description_html").notNull(),
    descriptionText: text("description_text").notNull(),
    fieldTags: text("field_tags").array().notNull().default([]),
    fitScore: integer("fit_score").notNull().default(0),
    status: text("status").notNull().default("active"),
    // Set true once the Telegram channel has broadcast this listing, so the
    // bot's auto-post job never sends the same listing twice.
    postedToChannel: boolean("posted_to_channel").notNull().default(false),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("listings_source_url_unique").on(t.sourceUrl),
    index("listings_source_idx").on(t.source),
    index("listings_deadline_idx").on(t.deadline),
    index("listings_status_idx").on(t.status),
    index("listings_fit_score_idx").on(t.fitScore),
    index("listings_org_slug_idx").on(t.orgSlug),
    // Drives the channel auto-post query: not-yet-posted, active, high-fit.
    index("listings_channel_queue_idx").on(t.postedToChannel, t.status, t.fitScore),
  ],
);

export const subscribers = pgTable("subscribers", {
  chatId: bigint("chat_id", { mode: "bigint" }).primaryKey(),
  username: text("username"),
  joinedAt: tstz("joined_at").notNull().defaultNow(),
  filters: jsonb("filters")
    .notNull()
    .default({ fields: [], paid_only: false, remote_ok: true }),
  savedListingIds: uuid("saved_listing_ids").array().notNull().default([]),
  notify24h: boolean("notify_24h").notNull().default(true),
  notify72h: boolean("notify_72h").notNull().default(true),
});

// First-party analytics events, written server-side by the web app (pageviews)
// and by a tiny beacon (listing views / apply clicks). Cookieless: visitor_hash
// is a daily-rotating sha256 of ip+ua, never the raw values. listing_id is a
// soft reference — events outlive pruned listings, so no FK.
export const pageEvents = pgTable(
  "page_events",
  {
    id: uuidPk(),
    ts: tstz("ts").notNull().defaultNow(),
    type: text("type").notNull(), // 'pageview' | 'listing_view' | 'apply_click'
    path: text("path"),
    ref: text("ref"),
    listingId: uuid("listing_id"),
    visitorHash: text("visitor_hash"),
    device: text("device"), // 'mobile' | 'desktop' | 'telegram'
    country: text("country"), // ISO2, resolved offline from ip at insert; never the ip itself
  },
  (t) => [
    index("page_events_ts_idx").on(t.ts),
    index("page_events_type_ts_idx").on(t.type, t.ts),
    index("page_events_listing_idx").on(t.listingId),
  ],
);

export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: uuidPk(),
    source: text("source").notNull(),
    startedAt: tstz("started_at").notNull().defaultNow(),
    finishedAt: tstz("finished_at"),
    newCount: integer("new_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    log: jsonb("log"),
  },
  (t) => [index("scrape_runs_source_started_idx").on(t.source, t.startedAt)],
);

// ---------------------------------------------------------------------------
// better-auth tables — property names MUST match better-auth's field names
// (id, emailVerified, userId, accountId, providerId, …) or the adapter breaks.
// DB column names are preserved via the snake_case first arg.
// ---------------------------------------------------------------------------

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: text("role").notNull().default("user"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_email_unique").on(t.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("session_token_unique").on(t.token),
    index("session_user_id_idx").on(t.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("account_user_id_idx").on(t.userId),
    index("account_provider_idx").on(t.providerId, t.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bookmarks_user_listing_idx").on(t.userId, t.listingId)],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    remindAt: tstz("remind_at").notNull(),
    note: text("note"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reminders_user_listing_idx").on(t.userId, t.listingId)],
);

// ---------------------------------------------------------------------------
// Relations — power the `with` clause in relational queries
// ---------------------------------------------------------------------------

export const orgsRelations = relations(orgs, ({ many }) => ({
  listings: many(listings),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  org: one(orgs, { fields: [listings.orgSlug], references: [orgs.slug] }),
  bookmarks: many(bookmarks),
  reminders: many(reminders),
}));

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  bookmarks: many(bookmarks),
  reminders: many(reminders),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  user: one(user, { fields: [bookmarks.userId], references: [user.id] }),
  listing: one(listings, {
    fields: [bookmarks.listingId],
    references: [listings.id],
  }),
}));

export const remindersRelations = relations(reminders, ({ one }) => ({
  user: one(user, { fields: [reminders.userId], references: [user.id] }),
  listing: one(listings, {
    fields: [reminders.listingId],
    references: [listings.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types — consumed by the scraper, worker, and bot.
// ---------------------------------------------------------------------------

export type Org = typeof orgs.$inferSelect;
export type NewOrg = typeof orgs.$inferInsert;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type Subscriber = typeof subscribers.$inferSelect;
export type NewSubscriber = typeof subscribers.$inferInsert;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type NewScrapeRun = typeof scrapeRuns.$inferInsert;
export type PageEvent = typeof pageEvents.$inferSelect;
export type NewPageEvent = typeof pageEvents.$inferInsert;
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;
export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
