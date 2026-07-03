CREATE TABLE "page_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"path" text,
	"ref" text,
	"listing_id" uuid,
	"visitor_hash" text,
	"device" text
);
--> statement-breakpoint
CREATE INDEX "page_events_ts_idx" ON "page_events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "page_events_type_ts_idx" ON "page_events" USING btree ("type","ts");--> statement-breakpoint
CREATE INDEX "page_events_listing_idx" ON "page_events" USING btree ("listing_id");