import { db } from "$lib/server/db";
import { bookmarks } from "$lib/server/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "$lib/auth";
import { fail, type RequestEvent } from "@sveltejs/kit";
import { daysLabel } from "$lib/utils";
import DOMPurify from "isomorphic-dompurify";

export const listingColumns = {
  id: true,
  source: true,
  orgName: true,
  title: true,
  location: true,
  isPaid: true,
  stipendText: true,
  deadline: true,
  fitScore: true,
  status: true,
  fieldTags: true,
  descriptionText: true,
  descriptionHtml: true,
  sourceUrl: true,
  applyUrl: true,
  scrapedAt: true,
  raw: true,
} as const;

export type ListingFields = {
  id: string;
  source: string;
  orgName: string;
  title: string;
  location: string | null;
  isPaid: boolean | null;
  stipendText: string | null;
  deadline: Date | null;
  fitScore: number;
  status: string;
  fieldTags: string[];
  descriptionText: string;
  descriptionHtml: string;
  sourceUrl: string;
  applyUrl: string | null;
  scrapedAt: Date;
  raw: unknown;
};

export type ReaderSection = { title: string; paragraphs: string[]; bullets: string[] };

// The structurer's cleaned reader-mode content lives in raw.structured.data.
// Pull the sections (and how-to-apply) so the detail view can render the tidy
// version instead of the raw scraped wall of text. Returns null when unstructured.
function readStructured(
  raw: unknown,
): { sections: ReaderSection[]; howToApply: string | null; applyEmail: string | null } | null {
  const data = (raw as { structured?: { data?: unknown } } | null)?.structured?.data;
  if (!data || typeof data !== "object") return null;
  const d = data as { sections?: unknown; how_to_apply?: unknown; application_email?: unknown };
  const sections: ReaderSection[] = Array.isArray(d.sections)
    ? d.sections
        .map((s) => {
          const sec = (s ?? {}) as { title?: unknown; paragraphs?: unknown; bullets?: unknown };
          return {
            title: typeof sec.title === "string" ? sec.title : "",
            paragraphs: Array.isArray(sec.paragraphs) ? sec.paragraphs.filter((p): p is string => typeof p === "string") : [],
            bullets: Array.isArray(sec.bullets) ? sec.bullets.filter((b): b is string => typeof b === "string") : [],
          };
        })
        .filter((s) => s.title || s.paragraphs.length || s.bullets.length)
    : [];
  if (sections.length === 0) return null;
  return {
    sections,
    howToApply: typeof d.how_to_apply === "string" ? d.how_to_apply : null,
    applyEmail: typeof d.application_email === "string" ? d.application_email : null,
  };
}

const shortDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Any anchor that survives sanitization should open in a new tab without
// leaking the referrer or window handle.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

const HTML_TAG = /<(p|div|br|ul|ol|li|h[1-6]|b|strong|i|em|u|a|span|blockquote|table)\b/i;
const ESCAPED_TAG = /&lt;(p|div|br|ul|ol|li|h[1-6]|b|strong|i|em|u|a|span|blockquote|table)\b/i;

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // decode last so we don't double-unescape

// Source HTML comes from untrusted scrapers, so we sanitize on the server and
// hand the client clean markup. We also drop layout noise (inline styles, raw
// attrs) so postings inherit our prose styles instead of the source site's
// chrome.
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li",
      "h2", "h3", "h4", "a", "blockquote", "span", "div",
    ],
    ALLOWED_ATTR: ["href"],
    ALLOW_DATA_ATTR: false,
    // force external links to open safely
    ADD_ATTR: ["target", "rel"],
  }).trim();
}

// Scrapers are inconsistent: some sources put real HTML in description_html,
// some entity-escape it (double-encoded), and some only have markup in the
// text column. Pick the best raw markup, then sanitize. Returns "" when there's
// nothing usable so the view falls back to plain sourceText.
function toSourceHtml(html: string, text: string): string {
  let raw = (html || "").trim();
  if (!HTML_TAG.test(raw)) {
    if (ESCAPED_TAG.test(raw)) raw = decodeEntities(raw); // double-encoded html
    else if (HTML_TAG.test(text)) raw = text; // markup landed in the text column
    else if (ESCAPED_TAG.test(text)) raw = decodeEntities(text);
    else return ""; // genuinely plain text — let the view render sourceText
  }
  return sanitizeHtml(raw);
}

export function mapListing(l: ListingFields) {
  const reader = readStructured(l.raw);
  return {
    id: l.id,
    source: l.source.toUpperCase(),
    org: l.orgName,
    title: l.title,
    date: l.deadline ? shortDate(l.deadline) : "—",
    location: l.location ?? "—",
    pay: l.isPaid === false ? "Unpaid" : (l.stipendText ?? "Pay unclear"),
    fit: l.fitScore,
    status: daysLabel(l.deadline),
    tags: l.fieldTags,
    sourceText: l.descriptionText,
    sourceHtml: toSourceHtml(l.descriptionHtml, l.descriptionText),
    sourceUrl: l.sourceUrl,
    applyUrl: l.applyUrl,
    applyEmail: reader?.applyEmail ?? null,
    scrapedAt: shortDate(l.scrapedAt),
    sections: reader?.sections ?? null,
    howToApply: reader?.howToApply ?? null,
  };
}

export type ListingView = ReturnType<typeof mapListing>;

export async function getBookmarkedIds(userId: string | undefined) {
  if (!userId) return [];
  const rows = await db
    .select({ listingId: bookmarks.listingId })
    .from(bookmarks)
    .where(eq(bookmarks.userId, userId));
  return rows.map((b) => b.listingId);
}

export async function toggleBookmark(event: RequestEvent) {
  const session = await auth.api.getSession({ headers: event.request.headers });
  if (!session?.user) return fail(401, { reason: "auth" });

  const listingId = String(
    (await event.request.formData()).get("listingId") ?? "",
  );
  if (!listingId) return fail(400);

  const deleted = await db
    .delete(bookmarks)
    .where(
      and(
        eq(bookmarks.userId, session.user.id),
        eq(bookmarks.listingId, listingId),
      ),
    )
    .returning({ id: bookmarks.id });

  if (deleted.length === 0) {
    await db.insert(bookmarks).values({ userId: session.user.id, listingId });
  }

  return { listingId, bookmarked: deleted.length === 0 };
}
