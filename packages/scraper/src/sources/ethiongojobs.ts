// ethiongojobs.com scraper. WordPress + Jannah theme.
// List page: /?s=<query> with /page/N/ pagination.
// Card: li.post-item with classes `post-<ID> category-* tag-*`.
// Detail: h1.post-title, .entry-content, JSON-LD Article@datePublished.

import * as cheerio from "cheerio";
import { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing, Source } from "../index.js";

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
    const max = opts.max ?? 50;
    const maxPages = opts.maxPages ?? 5;

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
        try {
          const detail = await this.fetcher.get(card.sourceUrl);
          out.push(parseDetailPage(card, detail));
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

function isBrowserInterstitial(html: string): boolean {
  return /<title>\s*One moment, please\.\.\.\s*<\/title>/i.test(html);
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
  const descriptionText = collapse($body.text());

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

function extractTopMeta(text: string): {
  location?: string;
  organization?: string;
  deadline?: string;
  closingDate?: string;
  department?: string;
  dutyStation?: string;
  workLocation?: string;
} {
  // Pull the first occurrence of each labelled field from the top of the body.
  // Labels look like "Location: Remote Organization: AfricaNenda Foundation Deadline: May 29, 2026".
  const head = text.slice(0, 600);
  const grab = (label: RegExp) => {
    const m = label.exec(head);
    if (!m) return undefined;
    const rest = head.slice(m.index + m[0].length);
    // Stop at the next labelled field or sentence break.
    const stop = rest.search(
      /\s+(?:Location|Work Location|Duty Station|Organization|Organisation|Department|Deadline|Closing Date|Job Description|Duration|Hours|Engagement|About)\s*:/i,
    );
    const value = (stop === -1 ? rest : rest.slice(0, stop)).trim();
    return value ? collapse(value).replace(/[.;]+$/, "") : undefined;
  };
  return {
    location: grab(/\bLocation\s*:/i),
    workLocation: grab(/\bWork Location\s*:/i),
    dutyStation: grab(/\bDuty Station\s*:/i),
    organization: grab(/\bOrganization\s*:|\bOrganisation\s*:/i),
    department: grab(/\bDepartment\s*:/i),
    deadline: grab(/\bDeadline\s*:/i),
    closingDate: grab(/\bClosing Date\s*:/i),
  };
}

function extractDatePublished(html: string): Date | null {
  const m = /"datePublished"\s*:\s*"([^"]+)"/.exec(html);
  if (!m) return null;
  const d = new Date(m[1]!);
  return isNaN(d.getTime()) ? null : d;
}

function parseDeadline(raw: string | undefined): Date | null {
  if (!raw) return null;
  // Common forms: "May 29, 2026", "29 May 2026", "29/05/2026", "2026-05-29".
  const cleaned = raw
    .replace(/\s+\([^)]*\)\s*$/g, "")
    .replace(/,\s*\d{1,2}:\d{2}\s*(AM|PM)\b/i, "")
    .replace(/\s+at\s+\d{1,2}:\d{2}\s*(AM|PM)?\b/i, "")
    .replace(/[.,;]+$/g, "")
    .trim();
  const embedded = /([A-Za-z]+ \d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}-\d{1,2}-\d{1,2})/.exec(
    cleaned,
  );
  if (embedded && embedded[1] !== cleaned) {
    return parseDeadline(embedded[1]);
  }
  const direct = new Date(cleaned);
  if (!isNaN(direct.getTime())) return direct;
  // Try day-month-year.
  const m = /^(\d{1,2})[\s\/\-](\w+|\d{1,2})[\s\/\-](\d{2,4})$/.exec(cleaned);
  if (m) {
    const guess = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
    if (!isNaN(guess.getTime())) return guess;
  }
  return null;
}

function findDeadlineInText(text: string): Date | null {
  const m = /(?:Deadline|Closing Date)[^A-Za-z0-9]+([A-Za-z]+ \d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(
    text,
  );
  return m ? parseDeadline(m[1]) : null;
}

function detectPaid(titleLower: string, lowerText: string): boolean | null {
  // CLAUDE.md: null when unclear; never invent.
  const head = `${titleLower}\n${lowerText.slice(0, 1500)}`;
  if (/\bunpaid\b/.test(head)) return false;
  if (/\bpaid\b|\bstipend\b|\bmonthly\s+allowance\b/.test(head)) return true;
  return null;
}

function extractStipend(text: string): string | null {
  const m = /(stipend|allowance|salary)[^.\n]{0,120}/i.exec(text);
  return m ? collapse(m[0]) : null;
}

function orgFromTitle(title: string): string | null {
  // "Internship at FooBar Foundation" → "FooBar Foundation"
  const m = /\bat\s+(.{2,80})$/i.exec(title);
  return m ? m[1]!.replace(/[.,;]+$/, "").trim() : null;
}
