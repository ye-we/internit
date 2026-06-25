import {
  ListingSchema,
  OrgSchema,
  StructuredListingSchema,
  type StructuredListing,
} from "@rue/shared";
import type { Listing, Org } from "@rue/db";

export function toListingResponse(row: Listing) {
  return ListingSchema.parse({
    id: row.id,
    source: row.source,
    source_url: row.sourceUrl,
    source_id: row.sourceId,
    org_name: row.orgName,
    org_slug: row.orgSlug,
    title: row.title,
    location: row.location,
    is_remote: row.isRemote,
    is_paid: row.isPaid,
    stipend_text: row.stipendText,
    deadline: row.deadline?.toISOString() ?? null,
    posted_at: row.postedAt?.toISOString() ?? null,
    scraped_at: row.scrapedAt.toISOString(),
    description_html: row.descriptionHtml,
    description_text: row.descriptionText,
    field_tags: row.fieldTags,
    fit_score: row.fitScore,
    status: row.status,
    structured: getStructuredListing(row.raw),
  });
}

export function toOrgResponse(row: Org) {
  return OrgSchema.parse({
    slug: row.slug,
    name: row.name,
    category: row.category,
    region: row.region,
    addis_office: row.addisOffice,
    website: row.website,
    careers_url: row.careersUrl,
    internship_url: row.internshipUrl,
    application_email: row.applicationEmail,
    twitter: row.twitter,
    linkedin: row.linkedin,
    telegram: row.telegram,
    posts_publicly: row.postsPublicly,
    has_remote: row.hasRemote,
    has_paid: row.hasPaid,
    scrape_priority: row.scrapePriority,
    notes: row.notes,
  });
}

function getStructuredListing(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const structured = (raw as { structured?: unknown }).structured;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
  const data = (structured as { data?: unknown }).data;
  const parsed = StructuredListingSchema.safeParse(withSectionFallback(data));
  return parsed.success ? parsed.data : null;
}

function withSectionFallback(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const value = data as Partial<StructuredListing>;
  const applicationUrl = validUrlOrNull(value.application_url);
  if (Array.isArray(value.sections)) {
    return {
      ...value,
      application_url: applicationUrl,
      ethiopia_access: value.ethiopia_access ?? "unclear",
      ethiopia_access_reason:
        value.ethiopia_access_reason ?? "Not assessed by the structurer yet.",
    };
  }
  return {
    ...value,
    application_url: applicationUrl,
    ethiopia_access: value.ethiopia_access ?? "unclear",
    ethiopia_access_reason:
      value.ethiopia_access_reason ?? "Not assessed by the structurer yet.",
    sections: [],
  };
}

function validUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}
