// Lever postings adapter. jobs.lever.co/{slug} → public JSON API.

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing } from "../index.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { isEthiopiaAccessible, isInternship } from "./types.js";

type LeverPosting = {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { location?: string; commitment?: string; team?: string };
  description?: string;
  descriptionPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
};

export const leverAdapter: Adapter = {
  name: "lever",

  detect(url: string): boolean {
    return extractSlug(url) !== null;
  },

  async scrape(
    config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts: AdapterOpts = {},
  ): Promise<ScrapedListing[]> {
    const max = opts.max ?? 20;
    const slug = extractSlug(config.url);
    if (!slug) throw new Error(`not a lever url: ${config.url}`);

    const apiUrl = `https://api.lever.co/v0/postings/${slug}?mode=json`;
    const body = await fetcher.get(apiUrl, "application/json");
    const postings = JSON.parse(body) as LeverPosting[];

    const out: ScrapedListing[] = [];
    for (const posting of postings) {
      if (out.length >= max) break;
      const isCommitmentIntern = /intern/i.test(posting.categories?.commitment ?? "");
      if (!isInternship(posting.text) && !isCommitmentIntern) continue;
      const listing = parsePosting(posting, slug, config);
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

function extractSlug(url: string): string | null {
  const m = /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9_-]+)/.exec(url);
  return m?.[1]?.toLowerCase() ?? null;
}

function parsePosting(
  posting: LeverPosting,
  slug: string,
  config: AdapterConfig,
): ScrapedListing {
  const listsHtml = (posting.lists ?? [])
    .map((l) => `<h3>${l.text ?? ""}</h3><ul>${l.content ?? ""}</ul>`)
    .join("");
  const descriptionHtml = cleanDescriptionHtml(`${posting.description ?? ""}${listsHtml}`);
  const descriptionText = collapse(cheerio.load(descriptionHtml).text());
  const title = collapse(posting.text);
  const location = collapse(posting.categories?.location) || null;
  const lowerText = `${title}\n${location ?? ""}\n${descriptionText}`.toLowerCase();

  return {
    source: `lever:${slug}`,
    sourceUrl: posting.hostedUrl,
    sourceId: posting.id,
    orgName: config.orgName ?? slug,
    orgSlug: config.orgSlug ?? null,
    title,
    location,
    isRemote: /\bremote\b|home-?based/.test(lowerText),
    isPaid: detectPaid(lowerText),
    stipendText: extractStipend(descriptionText),
    deadline: null,
    postedAt: posting.createdAt ? new Date(posting.createdAt) : null,
    descriptionHtml,
    descriptionText,
    raw: { categories: posting.categories },
  };
}

function detectPaid(lowerText: string): boolean | null {
  if (/\bunpaid\b|not remunerated/.test(lowerText)) return false;
  if (/\bstipend\b|\bpaid internship\b|\bhourly rate\b|\$\d/.test(lowerText)) return true;
  return null;
}

function extractStipend(text: string): string | null {
  const m = /(stipend|allowance|compensation|hourly rate)[^.\n]{0,160}/i.exec(text);
  return m ? collapse(m[0]) : null;
}
