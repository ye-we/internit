// ethiongojobs.com scraper. WordPress + Jannah theme.
// List page: /?s=<query> with /page/N/ pagination.
// Card: li.post-item with classes `post-<ID> category-* tag-*`.
// Detail: h1.post-title, .entry-content, JSON-LD Article@datePublished.

import * as cheerio from "cheerio";
import { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse, htmlToText, isBrowserInterstitial } from "../html.js";
import { isInternship, isRoundup } from "../filter.js";
import type { ScrapedListing, Source } from "../index.js";
import {
  detectPaid,
  extractStipend,
  extractTopMeta,
  findDeadlineInText,
  orgFromTitle,
  parseDeadline,
} from "../text-extract.js";

const SOURCE = "ethiongojobs";
const BASE = "https://www.ethiongojobs.com";
const SEARCH_QUERY = "internship";

type ListCard = {
  sourceUrl: string;
  sourceId: string | null;
  title: string;
  excerpt: string;
  classList: string[];
};

export class EthioNGOJobsSource implements Source {
  name = SOURCE;

  constructor(
    private readonly fetcher: PoliteFetcher = new PoliteFetcher(),
  ) {}

  async scrape(opts: { max?: number; maxPages?: number } = {}): Promise<ScrapedListing[]> {
    // ethiongojobs is the primary Ethiopian source and carries 40+ internship
    // posts at a time, so it pulls deep regardless of the generic per-org cap.
    const max = opts.max ?? 80;
    const maxPages = opts.maxPages ?? 8;

    const out: ScrapedListing[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= maxPages && out.length < max; page++) {
      const url =
        page === 1
          ? `${BASE}/?s=${encodeURIComponent(SEARCH_QUERY)}`
          : `${BASE}/page/${page}/?s=${encodeURIComponent(SEARCH_QUERY)}`;
      let html: string;
      try {
        html = await this.fetcher.get(url);
      } catch (err) {
        console.error(`[${SOURCE}] failed list page ${url}:`, err);
        break;
      }
      if (isBrowserInterstitial(html)) {
        throw new Error(
          `${SOURCE} returned a browser interstitial instead of listings; skipping this source`,
        );
      }
      const cards = parseListPage(html);
      if (cards.length === 0) break;

      for (const card of cards) {
        if (out.length >= max) break;
        if (seen.has(card.sourceUrl)) continue;
        seen.add(card.sourceUrl);
        // Internships only, and skip aggregator/digest posts. The card title is
        // the post title; filter before paying for the detail fetch.
        if (card.title && (!isInternship(card.title) || isRoundup(card.title))) continue;
        try {
          const detail = await this.fetcher.get(card.sourceUrl);
          const listing = parseDetailPage(card, detail);
          if (!isInternship(listing.title)) continue;
          out.push(listing);
        } catch (err) {
          console.error(`[${SOURCE}] failed ${card.sourceUrl}:`, err);
        }
      }
    }

    return out;
  }
}

export function parseListPage(html: string): ListCard[] {
  const $ = cheerio.load(html);
  const cards: ListCard[] = [];

  $("li.post-item, article.post-item").each((_, el) => {
    const $el = $(el);
    const a = $el.find("h2.post-title a, .post-title a").first();
    const href = a.attr("href")?.trim();
    if (!href) return;
    const title = collapse(a.text());
    const classList = ($el.attr("class") ?? "").split(/\s+/).filter(Boolean);
    const sourceId =
      classList.find((c) => /^post-\d+$/.test(c))?.replace(/^post-/, "") ??
      null;
    cards.push({
      sourceUrl: absUrl(href),
      sourceId,
      title,
      excerpt: collapse($el.find(".post-excerpt").text()),
      classList,
    });
  });

  return cards;
}

export function parseDetailPage(card: ListCard, html: string): ScrapedListing {
  const $ = cheerio.load(html);

  // Title: detail page is authoritative; fall back to card.
  const title = collapse($("h1.post-title.entry-title").first().text()) || card.title;

  // Body — strip noise.
  const $body = $(".entry-content.entry").first().clone();
  $body
    .find(
      [
        "script",
        "style",
        ".stream-item",
        ".related-posts",
        ".post-bottom-meta",
        ".post-tags-share-box",
        ".jannah-recent-posts",
        ".tie-related-posts",
        ".tie-popup",
        ".mag-box",
        ".sharing-buttons",
        "ins",
        "iframe[src*='ads']",
        // Jannah injects an inline "Related: <article-title> N hours ago"
        // widget mid-body. Markers vary; these classes cover the seen cases.
        "[class*='related-post']",
        "[class*='inline-related']",
        "[id*='related']",
      ].join(", "),
    )
    .remove();

  const descriptionHtml = cleanDescriptionHtml($body.html() ?? "", {
    resolveUrl: absUrl,
  });
  // Block-separated, not collapse($body.text()): ECA/UN reposts list fields in
  // adjacent <p>s ("Duty Station: Addis Ababa" / "Department/Office: …"), which
  // fuse without boundaries and bleed the location into the next field.
  const descriptionText = htmlToText($body.html() ?? "");

  // Structured top-of-body fields: "Location: …", "Organization: …", "Deadline: …"
  const meta = extractTopMeta(descriptionText);

  const postedAt = extractDatePublished(html);
  const deadline =
    parseDeadline(meta.deadline) ??
    parseDeadline(meta.closingDate) ??
    findDeadlineInText(descriptionText);

  const orgName =
    meta.organization ?? meta.department ?? orgFromTitle(title) ?? "Unknown";

  const location = meta.location ?? meta.dutyStation ?? meta.workLocation ?? null;
  const lowerText = descriptionText.toLowerCase();
  const isRemote =
    /\bremote\b|home-?based/.test(lowerText) ||
    card.classList.some((c) => c === "category-remote-jobs") ||
    /\bremote\b/i.test(location ?? "");

  const isPaid = detectPaid(title.toLowerCase(), lowerText);
  const stipendText = extractStipend(descriptionText);

  return {
    source: SOURCE,
    sourceUrl: card.sourceUrl,
    sourceId: card.sourceId,
    orgName,
    orgSlug: null, // org matching happens downstream
    title,
    location,
    isRemote,
    isPaid,
    stipendText,
    deadline,
    postedAt,
    descriptionHtml,
    descriptionText,
    raw: {
      excerpt: card.excerpt,
      classList: card.classList,
      meta,
    },
  };
}

// ---------- helpers ----------

function absUrl(href: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return `${BASE}${href.startsWith("/") ? "" : "/"}${href}`;
}

function extractDatePublished(html: string): Date | null {
  const m = /"datePublished"\s*:\s*"([^"]+)"/.exec(html);
  if (!m) return null;
  const d = new Date(m[1]!);
  return isNaN(d.getTime()) ? null : d;
}
