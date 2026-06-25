// Idealist.org adapter. The site is a JS SPA, but its search is powered by a
// public Algolia index — the app id and a search-only API key are shipped to
// the browser, so we query the very same endpoint the frontend uses. Idealist
// is US-centric, but it carries globally-remote social-studies internships an
// Addis student can do from home — the "remote from anywhere" slice. We keep
// type=INTERNSHIP postings that are worldwide-remote (remoteOk, not locked to a
// foreign country) or based in Ethiopia; the downstream classifier filters to
// the social-studies cluster.

import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse, htmlToText } from "../html.js";
import { detectPaid, extractStipend, findDeadlineInText } from "../text-extract.js";
import type { ScrapedListing } from "../index.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";

// Public client-side search credentials, lifted from the Idealist frontend
// config (window.__ … "algolia":{ appId, searchApiKey, siteIndexName }). The key
// is search-only and meant to be called from browsers.
const ALGOLIA_APP = "NSV3AUESS7";
const ALGOLIA_KEY = "c2730ea10ab82787f2f3cc961e8c1e06";
const ALGOLIA_INDEX = "idealist7-production";
const BASE = "https://www.idealist.org";

type Hit = {
  objectID: string;
  type: string;
  name: string;
  description?: string;
  orgName?: string;
  orgType?: string;
  url?: string | Record<string, string>;
  country?: string;
  city?: string;
  remoteOk?: boolean;
  remoteCountry?: string;
  areasOfFocus?: string[];
  detailsStipendProvided?: boolean;
};

export const idealistAdapter: Adapter = {
  name: "idealist",

  detect(url: string): boolean {
    try {
      return /(^|\.)idealist\.org$/i.test(new URL(url).hostname);
    } catch {
      return false;
    }
  },

  async scrape(
    _config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts: AdapterOpts = {},
  ): Promise<ScrapedListing[]> {
    const max = Math.min(opts.max ?? 40, 100);
    const out: ScrapedListing[] = [];

    for (let page = 0; page < 3 && out.length < max; page++) {
      const hits = await search(fetcher, page);
      if (hits.length === 0) break;
      for (const hit of hits) {
        if (out.length >= max) break;
        const listing = parseHit(hit);
        if (listing) out.push(listing);
      }
    }
    return out;
  },
};

async function search(fetcher: PoliteFetcher, page: number): Promise<Hit[]> {
  const params = new URLSearchParams({
    "x-algolia-application-id": ALGOLIA_APP,
    "x-algolia-api-key": ALGOLIA_KEY,
    hitsPerPage: "100",
    page: String(page),
    filters: "type:INTERNSHIP AND locale:en",
  });
  const url = `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}?${params}`;
  // Documented public search API (browser-facing) — skip the robots gate, same
  // rationale as the ReliefWeb / SmartRecruiters APIs.
  const body = await fetcher.get(url, "application/json", { skipRobots: true });
  const json = JSON.parse(body) as { hits?: Hit[] };
  return json.hits ?? [];
}

export function parseHit(hit: Hit): ScrapedListing | null {
  if (hit.type !== "INTERNSHIP") return null;

  const access = accessibleLocation(hit);
  if (!access) return null;

  const rawUrl = typeof hit.url === "string" ? hit.url : hit.url?.en;
  if (!rawUrl) return null;

  const descriptionHtml = cleanDescriptionHtml(hit.description ?? "", {
    resolveUrl: (href) => new URL(href, BASE).href,
  });
  const descriptionText = htmlToText(hit.description ?? "");
  if (descriptionText.length < 80) return null;

  const title = collapse(hit.name);
  const lowerText = descriptionText.toLowerCase();

  return {
    source: "idealist",
    sourceUrl: new URL(rawUrl, BASE).href,
    sourceId: hit.objectID,
    orgName: collapse(hit.orgName) || "Idealist",
    orgSlug: null,
    title,
    location: access.location,
    isRemote: access.isRemote,
    isPaid: hit.detailsStipendProvided === true ? true : detectPaid(title.toLowerCase(), lowerText),
    stipendText: extractStipend(descriptionText),
    deadline: findDeadlineInText(descriptionText),
    postedAt: null,
    descriptionHtml,
    descriptionText,
    raw: {
      objectID: hit.objectID,
      areasOfFocus: hit.areasOfFocus,
      remoteCountry: hit.remoteCountry,
      orgType: hit.orgType,
    },
  };
}

// An Idealist internship is reachable from Addis when it's worldwide-remote
// (remote, with no foreign-country lock) or physically in Ethiopia. A
// remoteCountry of "US" means "remote but must be in the US" — not accessible.
function accessibleLocation(hit: Hit): { location: string; isRemote: boolean } | null {
  if (hit.remoteOk === true && (!hit.remoteCountry || hit.remoteCountry === "ET")) {
    return { location: "Remote", isRemote: true };
  }
  if (hit.country === "ET") {
    return { location: [hit.city, "Ethiopia"].filter(Boolean).join(", "), isRemote: false };
  }
  return null;
}
