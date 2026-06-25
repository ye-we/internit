// Greenhouse boards adapter. Board slug comes from boards.greenhouse.io URLs
// (direct or embed form). The jobs endpoint returns entity-escaped HTML in
// `content`, decoded here before sanitizing.

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing } from "../index.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { isEthiopiaAccessible, isInternship } from "./types.js";

type GhJob = {
  id: number;
  title: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
  absolute_url: string;
};

export const greenhouseAdapter: Adapter = {
  name: "greenhouse",

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
    if (!slug) throw new Error(`not a greenhouse board url: ${config.url}`);

    const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    const body = await fetcher.get(apiUrl, "application/json");
    const json = JSON.parse(body) as { jobs?: GhJob[] };

    const out: ScrapedListing[] = [];
    for (const job of json.jobs ?? []) {
      if (out.length >= max) break;
      if (!isInternship(job.title)) continue;
      const listing = parseJob(job, slug, config);
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
  const m =
    /boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/.exec(url) ??
    /job-boards\.greenhouse\.io\/([A-Za-z0-9_-]+)/.exec(url);
  const slug = m?.[1];
  return slug && slug !== "embed" ? slug.toLowerCase() : null;
}

function parseJob(job: GhJob, slug: string, config: AdapterConfig): ScrapedListing {
  const decoded = job.content ? cheerio.load(`<x>${job.content}</x>`)("x").text() : "";
  const descriptionHtml = cleanDescriptionHtml(decoded);
  const descriptionText = collapse(cheerio.load(descriptionHtml).text());
  const title = collapse(job.title);
  const location = collapse(job.location?.name) || null;
  const lowerText = `${title}\n${location ?? ""}\n${descriptionText}`.toLowerCase();

  return {
    source: `greenhouse:${slug}`,
    sourceUrl: job.absolute_url,
    sourceId: String(job.id),
    orgName: config.orgName ?? slug,
    orgSlug: config.orgSlug ?? null,
    title,
    location,
    isRemote: /\bremote\b|home-?based/.test(lowerText),
    isPaid: detectPaid(lowerText),
    stipendText: extractStipend(descriptionText),
    deadline: findDeadline(descriptionText),
    postedAt: job.updated_at ? new Date(job.updated_at) : null,
    descriptionHtml,
    descriptionText,
    raw: { board: slug },
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

function findDeadline(text: string): Date | null {
  const m = /(deadline|apply by|applications? (?:close|due))[:\s]+([^.\n]{4,40})/i.exec(text);
  if (!m) return null;
  const d = new Date(m[2]!.trim());
  return isNaN(d.getTime()) ? null : d;
}
