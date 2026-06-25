// Ethiopian Human Rights Defenders Center (EHRDC)
// WordPress category archive at ethdefenders.org/category/jobopenings-vacancy

import * as cheerio from "cheerio";
import { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import { isInternship } from "../filter.js";
import type { ScrapedListing, Source } from "../index.js";

const SOURCE = "ehrdc";
const BASE = "https://ethdefenders.org";
const LIST_URL = `${BASE}/category/jobopenings-vacancy`;

type PostLink = { url: string; title: string };

export class EhrcdSource implements Source {
  name = SOURCE;

  constructor(private readonly fetcher = new PoliteFetcher()) {}

  async scrape(opts: { max?: number } = {}): Promise<ScrapedListing[]> {
    const max = opts.max ?? 20;

    let html: string;
    try {
      html = await this.fetcher.get(LIST_URL);
    } catch (err) {
      console.error(`[${SOURCE}] failed to fetch list page:`, err);
      return [];
    }

    const links = parseListPage(html).slice(0, max);
    const out: ScrapedListing[] = [];
    const seen = new Set<string>();

    for (const link of links) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      // Internships only — EHRDC's vacancy archive also carries staff roles.
      if (link.title && !isInternship(link.title)) continue;
      try {
        const detail = await this.fetcher.get(link.url);
        const listing = parseDetailPage(link, detail);
        if (!isInternship(listing.title)) continue;
        out.push(listing);
      } catch (err) {
        console.error(`[${SOURCE}] failed ${link.url}:`, err);
      }
    }

    return out;
  }
}

function parseListPage(html: string): PostLink[] {
  const $ = cheerio.load(html);
  const links: PostLink[] = [];
  const seen = new Set<string>();

  $("article .entry-title a, article h2 a, article h1 a, .post h2 a, h2.post-title a").each(
    (_, el) => {
      const href = $(el).attr("href")?.trim();
      const title = collapse($(el).text());
      if (!href || !title || seen.has(href)) return;
      seen.add(href);
      links.push({ url: href.startsWith("http") ? href : `${BASE}${href}`, title });
    },
  );

  return links;
}

function parseDetailPage(link: PostLink, html: string): ScrapedListing {
  const $ = cheerio.load(html);

  const title =
    collapse($("h1.entry-title, h1.post-title, h1").first().text()) || link.title;

  const $body = $(
    ".elementor-widget-theme-post-content .elementor-widget-container, .entry-content, .post-content",
  ).first().clone();
  $body
    .find(
      "script, style, .related-posts, .post-navigation, .comments-area, .sharedaddy, .wp-block-social-links",
    )
    .remove();

  const descriptionHtml = cleanDescriptionHtml($body.html() ?? "", {
    resolveUrl: (href) => (href.startsWith("http") ? href : `${BASE}${href}`),
  });
  const descriptionText = collapse($body.text());
  const lowerText = descriptionText.toLowerCase();

  const postedAt = extractDatePublished(html);
  const deadline = findDeadlineInText(descriptionText);
  const location = extractLocation(descriptionText);

  return {
    source: SOURCE,
    sourceUrl: link.url,
    sourceId: extractPostId(link.url),
    orgName: "Ethiopian Human Rights Defenders Center",
    orgSlug: "ehrdc",
    title,
    location: location ?? "Addis Ababa, Ethiopia",
    isRemote: /\bremote\b|home-?based/.test(lowerText),
    isPaid: detectPaid(lowerText),
    stipendText: extractStipend(descriptionText),
    deadline,
    postedAt,
    descriptionHtml,
    descriptionText,
    raw: {},
  };
}

function extractPostId(url: string): string | null {
  const m = /[?&]p=(\d+)/.exec(url) ?? /\/(\d+)\/?$/.exec(url);
  return m ? m[1] ?? null : null;
}

function extractDatePublished(html: string): Date | null {
  const m = /"datePublished"\s*:\s*"([^"]+)"/.exec(html);
  if (!m) return null;
  const d = new Date(m[1]!);
  return isNaN(d.getTime()) ? null : d;
}

function findDeadlineInText(text: string): Date | null {
  const m =
    /(?:Deadline|Closing Date|Apply by|Applications? due)[^A-Za-z0-9]+([A-Za-z]+ \d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(
      text,
    );
  if (!m) return null;
  const d = new Date(m[1]!);
  return isNaN(d.getTime()) ? null : d;
}

function extractLocation(text: string): string | null {
  const m = /\bLocation\s*:\s*([^\n.;]{2,80})/i.exec(text.slice(0, 600));
  return m ? collapse(m[1]!).replace(/[.;]+$/, "") : null;
}

function detectPaid(lowerText: string): boolean | null {
  if (/\bunpaid\b/.test(lowerText)) return false;
  if (/\bpaid\b|\bstipend\b|\bmonthly\s+allowance\b/.test(lowerText)) return true;
  return null;
}

function extractStipend(text: string): string | null {
  const m = /(stipend|allowance|salary)[^.\n]{0,120}/i.exec(text);
  return m ? collapse(m[0]) : null;
}
