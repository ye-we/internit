CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"source_id" text,
	"org_name" text NOT NULL,
	"org_slug" text,
	"title" text NOT NULL,
	"location" text,
	"is_remote" boolean DEFAULT false NOT NULL,
	"is_paid" boolean,
	"stipend_text" text,
	"deadline" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description_html" text NOT NULL,
	"description_text" text NOT NULL,
	"field_tags" text[] DEFAULT '{}' NOT NULL,
	"fit_score" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"region" text,
	"addis_office" boolean,
	"website" text,
	"careers_url" text,
	"internship_url" text,
	"application_email" text,
	"twitter" text,
	"linkedin" text,
	"telegram" text,
	"posts_publicly" text DEFAULT 'unknown' NOT NULL,
	"has_remote" text,
	"has_paid" text,
	"scrape_priority" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"new_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"log" jsonb
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"username" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filters" jsonb DEFAULT '{"fields":[],"paid_only":false,"remote_ok":true}'::jsonb NOT NULL,
	"saved_listing_ids" uuid[] DEFAULT '{}' NOT NULL,
	"notify_24h" boolean DEFAULT true NOT NULL,
	"notify_72h" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_org_slug_orgs_slug_fk" FOREIGN KEY ("org_slug") REFERENCES "public"."orgs"("slug") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_provider_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_user_listing_idx" ON "bookmarks" USING btree ("user_id","listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_source_url_unique" ON "listings" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "listings_source_idx" ON "listings" USING btree ("source");--> statement-breakpoint
CREATE INDEX "listings_deadline_idx" ON "listings" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "listings_status_idx" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "listings_fit_score_idx" ON "listings" USING btree ("fit_score");--> statement-breakpoint
CREATE INDEX "listings_org_slug_idx" ON "listings" USING btree ("org_slug");--> statement-breakpoint
CREATE INDEX "orgs_category_idx" ON "orgs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "orgs_posts_publicly_idx" ON "orgs" USING btree ("posts_publicly");--> statement-breakpoint
CREATE INDEX "orgs_scrape_priority_idx" ON "orgs" USING btree ("scrape_priority");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_user_listing_idx" ON "reminders" USING btree ("user_id","listing_id");--> statement-breakpoint
CREATE INDEX "scrape_runs_source_started_idx" ON "scrape_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");