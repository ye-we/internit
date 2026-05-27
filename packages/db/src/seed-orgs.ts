// Seed the orgs table from orgs-seed.csv at the repo root.
// Idempotent: upserts on slug.
//
// Run: pnpm db:seed

import "./env.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "./client.js";
import { orgs, type NewOrg } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, "../../../orgs-seed.csv");

type CsvRow = {
  slug: string;
  name: string;
  category: string;
  region: string;
  addis_office: string;
  website: string;
  careers_url: string;
  internship_url: string;
  application_email: string;
  twitter: string;
  linkedin: string;
  telegram: string;
  posts_publicly: string;
  has_remote: string;
  has_paid: string;
  scrape_priority: string;
  verification_needed: string;
  notes: string;
};

const nullIfEmpty = (s: string | undefined): string | null => {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
};

const yesNoToBool = (s: string | undefined): boolean | null => {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
};

const normalizePostsPublicly = (s: string | undefined): string => {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "yes" || v === "no" || v === "sometimes" || v === "unknown") {
    return v;
  }
  return "unknown";
};

const normalizeTriState = (s: string | undefined): string | null => {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "yes" || v === "no" || v === "sometimes") return v;
  return null;
};

const normalizePriority = (s: string | undefined): string | null => {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") {
    return v;
  }
  return null;
};

async function main() {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  console.log(`Read ${rows.length} rows from ${CSV_PATH}`);

  const values: NewOrg[] = rows
    .filter((r) => r.slug && r.name)
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      category: r.category || "other",
      region: nullIfEmpty(r.region),
      addisOffice: yesNoToBool(r.addis_office),
      website: nullIfEmpty(r.website),
      careersUrl: nullIfEmpty(r.careers_url),
      internshipUrl: nullIfEmpty(r.internship_url),
      applicationEmail: nullIfEmpty(r.application_email),
      twitter: nullIfEmpty(r.twitter),
      linkedin: nullIfEmpty(r.linkedin),
      telegram: nullIfEmpty(r.telegram),
      postsPublicly: normalizePostsPublicly(r.posts_publicly),
      hasRemote: normalizeTriState(r.has_remote),
      hasPaid: normalizeTriState(r.has_paid),
      scrapePriority: normalizePriority(r.scrape_priority),
      notes: nullIfEmpty(r.notes),
    }));

  const db = getDb();

  // Chunked upsert to stay clear of parameter limits.
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    await db
      .insert(orgs)
      .values(chunk)
      .onConflictDoUpdate({
        target: orgs.slug,
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          region: sql`excluded.region`,
          addisOffice: sql`excluded.addis_office`,
          website: sql`excluded.website`,
          careersUrl: sql`excluded.careers_url`,
          internshipUrl: sql`excluded.internship_url`,
          applicationEmail: sql`excluded.application_email`,
          twitter: sql`excluded.twitter`,
          linkedin: sql`excluded.linkedin`,
          telegram: sql`excluded.telegram`,
          postsPublicly: sql`excluded.posts_publicly`,
          hasRemote: sql`excluded.has_remote`,
          hasPaid: sql`excluded.has_paid`,
          scrapePriority: sql`excluded.scrape_priority`,
          notes: sql`excluded.notes`,
          updatedAt: sql`now()`,
        },
      });
    inserted += chunk.length;
  }

  console.log(`Upserted ${inserted} orgs.`);
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
