import { z } from "zod";
import { LISTING_STATUS, SCRAPE_PRIORITIES } from "./constants.js";

// Wire schemas for API responses. Mirror the Drizzle tables in @internit/db
// but live here so the web client can import them without pulling in
// pg/Drizzle.

export const ListingSchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  source_url: z.string().url(),
  source_id: z.string().nullable(),
  org_name: z.string(),
  org_slug: z.string().nullable(),
  title: z.string(),
  location: z.string().nullable(),
  is_remote: z.boolean(),
  is_paid: z.boolean().nullable(),
  stipend_text: z.string().nullable(),
  deadline: z.string().datetime().nullable(),
  posted_at: z.string().datetime().nullable(),
  scraped_at: z.string().datetime(),
  description_html: z.string(),
  description_text: z.string(),
  field_tags: z.array(z.string()),
  fit_score: z.number().int().min(0).max(100),
  status: z.enum(LISTING_STATUS),
  structured: z.lazy(() => StructuredListingSchema).nullable(),
});
export type Listing = z.infer<typeof ListingSchema>;

export const OrgSchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  region: z.string().nullable(),
  addis_office: z.boolean().nullable(),
  website: z.string().nullable(),
  careers_url: z.string().nullable(),
  internship_url: z.string().nullable(),
  application_email: z.string().nullable(),
  twitter: z.string().nullable(),
  linkedin: z.string().nullable(),
  telegram: z.string().nullable(),
  posts_publicly: z.enum(["yes", "no", "sometimes", "unknown"]),
  has_remote: z.enum(["yes", "no", "sometimes"]).nullable(),
  has_paid: z.enum(["yes", "no", "sometimes"]).nullable(),
  scrape_priority: z.enum(SCRAPE_PRIORITIES).nullable(),
  notes: z.string().nullable(),
});
export type Org = z.infer<typeof OrgSchema>;

export const SubscriberFiltersSchema = z.object({
  fields: z.array(z.string()).default([]),
  paid_only: z.boolean().default(false),
  remote_ok: z.boolean().default(true),
});
export type SubscriberFilters = z.infer<typeof SubscriberFiltersSchema>;

// Query params for GET /api/listings
export const ListingsQuerySchema = z.object({
  field: z.string().optional(),
  paid: z.enum(["true", "false"]).optional(),
  remote: z.enum(["true", "false"]).optional(),
  status: z.enum(["active", "expired", "hidden", "all"]).default("active"),
  deadline_within: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListingsQuery = z.infer<typeof ListingsQuerySchema>;

// Classifier output — Tier 2 LLM returns this shape.
export const ClassificationSchema = z.object({
  fits: z.boolean(),
  fields: z.array(z.string()),
  fit_score: z.number().int().min(0).max(100),
  reason: z.string(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const StructuredListingSchema = z.object({
  organization: z.string().nullable(),
  location: z.string().nullable(),
  deadline: z.string().nullable(),
  application_url: z.string().url().nullable(),
  application_email: z.string().nullable(),
  application_method: z.enum(["portal", "email", "in-person", "unclear"]),
  ethiopia_access: z.enum([
    "ethiopia-based",
    "remote",
    "sponsored-abroad",
    "open-but-self-funded-abroad",
    "not-realistic",
    "unclear",
  ]),
  ethiopia_access_reason: z.string(),
  is_paid: z.boolean().nullable(),
  stipend_text: z.string().nullable(),
  summary: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      paragraphs: z.array(z.string()),
      bullets: z.array(z.string()),
    }),
  ),
  requirements: z.array(z.string()),
  responsibilities: z.array(z.string()),
  how_to_apply: z.string().nullable(),
  warnings: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type StructuredListing = z.infer<typeof StructuredListingSchema>;
