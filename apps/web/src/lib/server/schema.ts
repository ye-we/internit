// Re-export the canonical schema so app code can keep importing tables from
// `$lib/server/schema` while the single source of truth lives in @internit/db
// (shared with the scraper, worker, and bot — no drift).
export * from "@internit/db/schema";
