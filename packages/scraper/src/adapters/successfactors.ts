// SAP SuccessFactors career-site adapter. SF sites on custom domains (e.g. the
// African Union's jobs.au.int) render job tiles client-side (the search page is
// unscrapable) and disallow their /services/ RSS feed in robots.txt. But AU also
// publishes the same job feed (RSS, full title + location + description per
// item) at the robots-allowed /sitemap_index.xml — one fetch covers every
// posting, so no per-job detail requests are needed. We filter the feed to
// internships and read location from the title ("… (Addis Ababa, Ethiopia)").

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse, htmlToText } from "../html.js";
import { detectPaid, extractStipend, findDeadlineInText } from "../text-extract.js";
import type { ScrapedListing } from "../index.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { isEthiopiaAccessible, isInternship } from "./types.js";

const MAX_LISTINGS = 20;
const FEED_TTL_MS = 30 * 60 * 1000;
// robots.txt blocks /services/ (the canonical RSS) but not these public mirrors.
const FEED_PATHS = ["/sitemap_index.xml", "/sitemap.xml"];

type FeedItem = { title: string; link: string; description: string; pubDate: string };

// Keyed by origin so AU's sub-orgs (au, au-paps, au-psc…) on jobs.au.int share
// one feed fetch within a run.
const feedCache = new Map<string, { at: number; items: FeedItem[] }>();

export const successfactorsAdapter: Adapter = {
  name: "successfactors",

  detect(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return host === "jobs.au.int" || /\.successfactors\.|\.sapsf\./i.test(host);
    } catch {
      return false;
    }
  },

  async scrape(
    config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts: AdapterOpts = {},
  ): Promise<ScrapedListing[]> {
    const max = Math.min(opts.max ?? MAX_LISTINGS, MAX_LISTINGS);
    const origin = new URL(config.url).origin;
    const items = await loadFeed(origin, fetcher);

    const out: ScrapedListing[] = [];
    for (const item of items) {
      if (out.length >= max) break;
      if (!isInternship(item.title)) continue;

      const listing = parseItem(item, origin, config);
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

async function loadFeed(origin: string, fetcher: PoliteFetcher): Promise<FeedItem[]> {
  const cached = feedCache.get(origin);
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached.items;

  let xml = "";
  for (const path of FEED_PATHS) {
    try {
      xml = await fetcher.get(origin + path, "application/rss+xml, application/xml, text/xml");
      if (/<item\b/i.test(xml)) break;
    } catch {
      // try the next candidate path
    }
  }

  const $ = cheerio.load(xml, { xmlMode: true });
  const items: FeedItem[] = [];
  $("item").each((_, el) => {
    const $i = $(el);
    const link = collapse($i.find("link").text());
    if (!link) return;
    items.push({
      title: collapse($i.find("title").text()),
      link,
      description: $i.find("description").text(),
      pubDate: collapse($i.find("pubDate").text()),
    });
  });

  feedCache.set(origin, { at: Date.now(), items });
  return items;
}

export function parseItem(
  item: FeedItem,
  origin: string,
  config: AdapterConfig,
): ScrapedListing | null {
  const descriptionHtml = cleanDescriptionHtml(item.description, {
    resolveUrl: (href) => new URL(href, origin).href,
  });
  const descriptionText = htmlToText(item.description);
  if (descriptionText.length < 80) return null;

  // AU titles carry the duty station: "Internship Program (Addis Ababa, Ethiopia)".
  const location = /\(([^)]+)\)\s*$/.exec(item.title)?.[1]?.trim() ?? null;
  const title = collapse(item.title.replace(/\s*\([^)]*\)\s*$/, "")) || item.title;
  const sourceUrl = stripQuery(item.link);
  const lowerText = descriptionText.toLowerCase();
  const host = new URL(origin).hostname.replace(/^www\./, "");

  return {
    source: `successfactors:${host}`,
    sourceUrl,
    sourceId: /\/job\/[^/]*\/(\d+)/.exec(sourceUrl)?.[1] ?? null,
    orgName: config.orgName ?? host,
    orgSlug: config.orgSlug ?? null,
    title,
    location,
    isRemote: /\bremote\b|home-?based/.test(lowerText) || /remote/i.test(location ?? ""),
    isPaid: detectPaid(title.toLowerCase(), lowerText),
    stipendText: extractStipend(descriptionText),
    deadline: findDeadlineInText(descriptionText),
    postedAt: parseDate(item.pubDate),
    descriptionHtml,
    descriptionText,
    raw: { pubDate: item.pubDate },
  };
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
