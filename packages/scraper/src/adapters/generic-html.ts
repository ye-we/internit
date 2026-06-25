// Last-resort adapter for server-rendered careers pages with no known ATS
// (EHRC, NEBE, MFA Ethiopia, CARD, SIHA, Dereja, GeezJobs…). Crawls the
// given page for internship-looking links, then parses each detail page with
// heuristics. detect() always matches — it MUST stay last in ADAPTERS.

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import {
  BrowserChallengeError,
  cleanDescriptionHtml,
  collapse,
  htmlToText,
  isBrowserInterstitial,
} from "../html.js";
import type { ScrapedListing } from "../index.js";
import {
  detectPaid,
  extractStipend,
  extractTopMeta,
  findDeadlineInText,
  parseDeadline,
} from "../text-extract.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { isEthiopiaAccessible, isInternship } from "./types.js";

// Unknown hosts: keep the per-run request budget small regardless of opts.max.
const MAX_DETAIL_FETCHES = 10;

const CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".entry-content",
  ".job-description",
  ".job-details",
  ".vacancy-details",
  ".post-content",
  // Drupal (UNECA, many UN/gov sites): the posting body lives in a node/field
  // region, while the page shell wraps it in breadcrumb + menu chrome.
  ".node__content",
  ".node-content",
  ".field--name-body",
  ".field-name-body",
  "#block-system-main",
  ".region-content",
  "#content",
  ".content",
];

// Page-shell chrome that rides along inside content regions (or the <body>
// fallback) and otherwise lands at the top of the posting: Drupal skip-links
// ("Skip to main content"), breadcrumbs ("You are here"), menus, headers,
// footers, sidebars, cookie bars. Removed before container selection so neither
// the densest-container pick nor the body fallback can capture it.
const CHROME_SELECTORS = [
  "script", "style", "noscript", "nav", "header", "footer", "aside", "form",
  ".breadcrumb", "[class*='breadcrumb']", "#breadcrumb", ".region-breadcrumb",
  ".skip-link", ".skip-to-content", "[class*='skip-link']",
  "a[href='#main-content']", "a[href='#content']", "a[href='#main']",
  ".visually-hidden", ".sr-only", ".element-invisible",
  ".menu", ".main-menu", ".region-header", ".region-footer", ".tabs", ".pager",
  "[role='navigation']", "[role='banner']", "[role='contentinfo']", "[role='search']",
  ".sidebar", "[class*='sidebar']",
  "[class*='cookie']", "[id*='cookie']",
  ".social-links", "[class*='social-share']", "[class*='share-buttons']",
].join(", ");

function stripChrome($: cheerio.CheerioAPI): void {
  $(CHROME_SELECTORS).remove();
}

export const genericHtmlAdapter: Adapter = {
  name: "generic-html",

  detect(url: string): boolean {
    try {
      const proto = new URL(url).protocol;
      return proto === "https:" || proto === "http:";
    } catch {
      return false;
    }
  },

  async scrape(
    config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts: AdapterOpts = {},
  ): Promise<ScrapedListing[]> {
    const max = Math.min(opts.max ?? MAX_DETAIL_FETCHES, MAX_DETAIL_FETCHES);
    const baseUrl = new URL(config.url);

    const listHtml = await fetcher.get(config.url);
    if (isBrowserInterstitial(listHtml)) {
      throw new BrowserChallengeError(config.url);
    }

    const links = extractInternLinks(listHtml, baseUrl);
    const out: ScrapedListing[] = [];
    for (const link of links) {
      if (out.length >= max) break;
      let detailHtml: string;
      try {
        detailHtml = await fetcher.get(link.href);
      } catch {
        continue;
      }
      if (isBrowserInterstitial(detailHtml)) continue;

      const listing = parseDetail(detailHtml, link, config);
      if (!listing) continue;
      if (
        !isEthiopiaAccessible({
          location: listing.location,
          title: listing.title,
          descriptionText: listing.descriptionText,
        })
      ) {
        continue;
      }
      out.push(listing);
    }
    return out;
  },
};

type InternLink = { href: string; text: string };

function extractInternLinks(html: string, baseUrl: URL): InternLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: InternLink[] = [];

  $("a[href]").each((_, el) => {
    const $a = $(el);
    const text = collapse($a.text());
    if (!text || !isInternship(text)) return;

    const rawHref = $a.attr("href")?.trim();
    if (!rawHref || rawHref.startsWith("#") || /^(javascript|mailto|tel):/i.test(rawHref)) {
      return;
    }
    let href: string;
    try {
      href = new URL(rawHref, baseUrl).href;
    } catch {
      return;
    }
    // Same registrable host only — off-site links are someone else's posting.
    if (!sameSite(new URL(href).hostname, baseUrl.hostname)) return;
    if (href === baseUrl.href) return;
    if (seen.has(href)) return;
    seen.add(href);
    links.push({ href, text });
  });

  return links;
}

function sameSite(a: string, b: string): boolean {
  const root = (h: string) => h.toLowerCase().split(".").slice(-2).join(".");
  return root(a) === root(b);
}

// Strip page chrome, then return the title + densest content container HTML
// (pre-sanitize). Returns null when no usable body remains.
export function selectContainerHtml(
  html: string,
): { title: string; containerHtml: string } | null {
  const $ = cheerio.load(html);
  stripChrome($);

  const title =
    collapse($("h1").first().text()) ||
    collapse($("meta[property='og:title']").attr("content")) ||
    "";

  // Pick the densest content container so menus/sidebars don't win.
  let bestHtml = "";
  let bestLen = 0;
  for (const sel of CONTENT_SELECTORS) {
    const $el = $(sel).first();
    if (!$el.length) continue;
    const len = collapse($el.text()).length;
    if (len > bestLen) {
      bestLen = len;
      bestHtml = $el.html() ?? "";
    }
  }
  // Fallback to the (already de-chromed) body when no semantic container is
  // dense enough — a clean whole-body beats an arbitrary sidebar.
  if (bestLen < 200) {
    bestHtml = $("body").html() ?? "";
  }
  if (!bestHtml || !collapse(cheerio.load(bestHtml).text())) return null;
  return { title, containerHtml: bestHtml };
}

// Build a listing from already-scoped, pre-sanitize container HTML. Shared by
// the live adapter and the backfill so both derive every field identically.
export function buildListing(input: {
  containerHtml: string;
  title: string;
  sourceUrl: string;
  orgName?: string | null;
  orgSlug?: string | null;
}): ScrapedListing | null {
  const { containerHtml, title } = input;
  if (!title || !isInternship(title)) return null;

  const baseUrl = new URL(input.sourceUrl);
  const descriptionHtml = cleanDescriptionHtml(containerHtml, {
    resolveUrl: (href) => new URL(href, input.sourceUrl).href,
  });
  // descriptionText is derived from the PRE-sanitize container: once
  // cleanDescriptionHtml unwraps <div>/<span> the block boundaries are gone, so
  // text taken from it re-fuses labelled fields. htmlToText keeps the splits.
  const descriptionText = htmlToText(containerHtml);
  if (descriptionText.length < 100) return null;

  const meta = extractTopMeta(descriptionText);
  const location = meta.location ?? meta.dutyStation ?? meta.workLocation ?? null;
  const lowerText = descriptionText.toLowerCase();

  return {
    source: `generic:${baseUrl.hostname.replace(/^www\./, "")}`,
    sourceUrl: input.sourceUrl,
    sourceId: null,
    orgName: input.orgName ?? meta.organization ?? baseUrl.hostname,
    orgSlug: input.orgSlug ?? null,
    title,
    location,
    isRemote: /\bremote\b|home-?based/.test(lowerText) || /remote/i.test(location ?? ""),
    isPaid: detectPaid(title.toLowerCase(), lowerText),
    stipendText: extractStipend(descriptionText),
    deadline:
      parseDeadline(meta.deadline) ??
      parseDeadline(meta.closingDate) ??
      findDeadlineInText(descriptionText),
    postedAt: null,
    descriptionHtml,
    descriptionText,
    // Persist the scoped container so re-extraction needs no re-fetch.
    raw: { meta, containerHtml },
  };
}

function parseDetail(
  html: string,
  link: InternLink,
  config: AdapterConfig,
): ScrapedListing | null {
  const selected = selectContainerHtml(html);
  if (!selected) return null;

  const listing = buildListing({
    containerHtml: selected.containerHtml,
    title: selected.title || link.text,
    sourceUrl: link.href,
    orgName: config.orgName,
    orgSlug: config.orgSlug,
  });
  if (!listing) return null;

  // Keep the crawl link text for debugging alongside the extracted meta.
  listing.raw = { linkText: link.text, ...(listing.raw as Record<string, unknown>) };
  return listing;
}
