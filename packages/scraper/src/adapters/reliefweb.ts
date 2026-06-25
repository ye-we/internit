// ReliefWeb jobs API. Aggregator: one adapter covers many INGO postings.
// Jobs carry a native "Internship" type facet, so the API does the first
// filter pass; accessibility is checked client-side.

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing } from "../index.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { isEthiopiaAccessible } from "./types.js";

// v2 requires a registered appname: https://apidoc.reliefweb.int/parameters#appname
// Set RELIEFWEB_APPNAME in the environment once approved.
function apiUrl(): string {
  const appname = process.env.RELIEFWEB_APPNAME;
  if (!appname) {
    throw new Error(
      "RELIEFWEB_APPNAME not set; request one at https://apidoc.reliefweb.int/parameters#appname",
    );
  }
  return (
    `https://api.reliefweb.int/v2/jobs?appname=${encodeURIComponent(appname)}` +
    "&profile=full&limit=50&filter[field]=type.name&filter[value]=Internship&sort[]=date.created:desc"
  );
}

type RwJob = {
  id: string;
  fields: {
    title?: string;
    url?: string;
    "body-html"?: string;
    body?: string;
    how_to_apply?: string;
    source?: Array<{ name?: string; shortname?: string }>;
    country?: Array<{ name?: string }>;
    city?: Array<{ name?: string }>;
    date?: { created?: string; closing?: string };
  };
};

export const reliefwebAdapter: Adapter = {
  name: "reliefweb",

  detect(url: string): boolean {
    try {
      return new URL(url).hostname.endsWith("reliefweb.int");
    } catch {
      return false;
    }
  },

  async scrape(
    _config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts: AdapterOpts = {},
  ): Promise<ScrapedListing[]> {
    const max = opts.max ?? 50;
    // ReliefWeb's documented public API requires an `appname` identifier and
    // blanket-disallows /v2/ in robots.txt for crawlers — appname is the
    // sanctioned politeness channel, so skip the robots gate (same as the
    // SmartRecruiters posting API).
    const body = await fetcher.get(apiUrl(), "application/json", { skipRobots: true });
    const json = JSON.parse(body) as { data?: RwJob[] };

    const out: ScrapedListing[] = [];
    for (const job of json.data ?? []) {
      if (out.length >= max) break;
      const listing = parseJob(job);
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

function parseJob(job: RwJob): ScrapedListing | null {
  const f = job.fields;
  const title = collapse(f.title);
  const sourceUrl = f.url ?? `https://reliefweb.int/job/${job.id}`;
  if (!title) return null;

  const rawHtml = f["body-html"] ?? (f.body ? `<p>${f.body}</p>` : "");
  const descriptionHtml = cleanDescriptionHtml(rawHtml, {
    resolveUrl: (href) => new URL(href, "https://reliefweb.int").href,
  });
  const descriptionText = collapse(cheerio.load(descriptionHtml).text());
  if (!descriptionText) return null;

  const country = (f.country ?? []).map((c) => collapse(c.name)).filter(Boolean);
  const city = (f.city ?? []).map((c) => collapse(c.name)).filter(Boolean);
  const location = [...city, ...country].join(", ") || null;
  const lowerText = `${title}\n${descriptionText}`.toLowerCase();

  return {
    source: "reliefweb",
    sourceUrl,
    sourceId: String(job.id),
    orgName: collapse(f.source?.[0]?.name) || "Unknown",
    orgSlug: null,
    title,
    location,
    isRemote: /\bremote\b|home-?based/.test(lowerText) || /remote/i.test(location ?? ""),
    isPaid: detectPaid(lowerText),
    stipendText: extractStipend(descriptionText),
    deadline: parseDate(f.date?.closing),
    postedAt: parseDate(f.date?.created),
    descriptionHtml,
    descriptionText,
    raw: { howToApply: f.how_to_apply, shortname: f.source?.[0]?.shortname },
  };
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function detectPaid(lowerText: string): boolean | null {
  if (/\bunpaid\b|not remunerated|no remuneration|voluntary basis/.test(lowerText)) return false;
  if (/\bstipend\b|\bpaid internship\b|\bmonthly allowance\b/.test(lowerText)) return true;
  return null;
}

function extractStipend(text: string): string | null {
  const m = /(stipend|allowance|remunerat\w+|unpaid)[^.\n]{0,160}/i.exec(text);
  return m ? collapse(m[0]) : null;
}
