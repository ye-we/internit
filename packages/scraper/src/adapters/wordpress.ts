// WordPress opportunity-blog adapter. Uses the WP REST API
// (/wp-json/wp/v2/posts?search=internship) — content comes back rendered, so
// one request covers a whole page of postings, no detail fetches.
// Detection is by known host: WP can't be fingerprinted from a URL alone.

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing } from "../index.js";
import {
  detectPaid,
  extractStipend,
  extractTopMeta,
  findDeadlineInText,
  orgFromTitle,
  parseDeadline,
} from "../text-extract.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { isEthiopiaAccessible, isInternship } from "./types.js";

// Opportunity blogs from orgs-seed.csv known to run WordPress with the REST
// API exposed, mapped to the REST base their postings live under: plain blogs
// use core "posts"; WP Job Manager boards (harmeejobs) expose "job-listings".
// ethiongojobs stays on its bespoke source (Jannah-specific noise stripping);
// add hosts here as they're verified.
const KNOWN_WP_HOSTS = new Map([
  ["ngojobsinafrica.com", "posts"],
  ["www.ngojobsinafrica.com", "posts"],
  ["opportunitiesforafricans.com", "posts"],
  ["www.opportunitiesforafricans.com", "posts"],
  ["opportunitydesk.org", "posts"],
  ["www.opportunitydesk.org", "posts"],
  ["globalsouthopportunities.com", "posts"],
  ["www.globalsouthopportunities.com", "posts"],
  ["opportunitiesforyouth.org", "posts"],
  ["www.opportunitiesforyouth.org", "posts"],
  ["harmeejobs.com", "job-listings"],
  ["www.harmeejobs.com", "job-listings"],
]);

type WpPost = {
  id: number;
  link?: string;
  date?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
};

export const wordpressAdapter: Adapter = {
  name: "wordpress",

  detect(url: string): boolean {
    try {
      return KNOWN_WP_HOSTS.has(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  },

  async scrape(
    config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts: AdapterOpts = {},
  ): Promise<ScrapedListing[]> {
    const max = opts.max ?? 20;
    const origin = new URL(config.url).origin;
    const hostname = new URL(config.url).hostname.toLowerCase();
    const host = hostname.replace(/^www\./, "");
    const restBase = KNOWN_WP_HOSTS.get(hostname) ?? "posts";

    const apiUrl =
      `${origin}/wp-json/wp/v2/${restBase}?search=internship&per_page=${Math.min(max * 2, 50)}` +
      "&orderby=date&order=desc&_fields=id,link,date,title,content";
    const body = await fetcher.get(apiUrl, "application/json");
    const posts = JSON.parse(body) as WpPost[];
    if (!Array.isArray(posts)) {
      throw new Error(`wp-json returned non-array at ${apiUrl}`);
    }

    const out: ScrapedListing[] = [];
    for (const post of posts) {
      if (out.length >= max) break;
      const listing = parsePost(post, host, origin, config);
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

function parsePost(
  post: WpPost,
  host: string,
  origin: string,
  config: AdapterConfig,
): ScrapedListing | null {
  // title.rendered is entity-escaped.
  const title = collapse(cheerio.load(post.title?.rendered ?? "")("body").text());
  const sourceUrl = post.link;
  if (!title || !sourceUrl) return null;
  // The search matched anywhere in the post; require an internship in the
  // title so roundup/news posts (and fellowships/jobs) don't slip through.
  if (!isInternship(title)) return null;
  // Skip listicle roundups ("30 Jobs, Internships and Volunteer Roles…") —
  // they aggregate dozens of unrelated postings with no single org/deadline.
  if (/^\d+\+?\s/.test(title)) return null;

  const $raw = cheerio.load(`<main>${post.content?.rendered ?? ""}</main>`, null, false);
  $raw("script, style, ins, iframe, [class*='related'], [class*='share'], [class*='widget']").remove();
  const descriptionHtml = cleanDescriptionHtml($raw("main").html() ?? "", {
    resolveUrl: (href) => new URL(href, origin).href,
  });
  const descriptionText = collapse(cheerio.load(descriptionHtml).text());
  if (!descriptionText) return null;

  const meta = extractTopMeta(descriptionText);
  const location = meta.location ?? meta.dutyStation ?? meta.workLocation ?? null;
  const lowerText = descriptionText.toLowerCase();

  return {
    source: `wordpress:${host}`,
    sourceUrl,
    sourceId: String(post.id),
    orgName: meta.organization ?? orgFromTitle(title) ?? (config.orgName || "Unknown"),
    orgSlug: null, // aggregator blogs post for other orgs
    title,
    location,
    isRemote: /\bremote\b|home-?based/.test(lowerText) || /remote/i.test(location ?? ""),
    isPaid: detectPaid(title.toLowerCase(), lowerText),
    stipendText: extractStipend(descriptionText),
    deadline:
      parseDeadline(meta.deadline) ??
      parseDeadline(meta.closingDate) ??
      findDeadlineInText(descriptionText),
    postedAt: post.date ? parseWpDate(post.date) : null,
    descriptionHtml,
    descriptionText,
    raw: { meta },
  };
}

function parseWpDate(raw: string): Date | null {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
