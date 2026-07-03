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
        if (!listing) continue;
        // Idealist's description only carries the org's *general* careers URL; the
        // specific apply link lives behind the "Apply" button on the listing page.
        // Fetch it for every kept hit — NOT just hasAts ones: hasAts is false for
        // form-based applications (typeform/Google Forms), yet the page still
        // carries the org-registered apply URL. Skipping those left applyUrl null
        // and let the LLM structurer "fill the gap" with hallucinated links.
        const applyUrl = await fetchApplyUrl(fetcher, listing.sourceUrl);
        if (applyUrl) listing.applyUrl = applyUrl;
        out.push(listing);
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

export async function fetchApplyUrl(fetcher: PoliteFetcher, pageUrl: string): Promise<string | null> {
  try {
    const found = extractAtsUrl(await fetcher.get(pageUrl));
    return found ? await resolveShortener(found) : null;
  } catch {
    return null;
  }
}

// Idealist's own nav/boilerplate, social and analytics — never the apply link.
const IGNORE_HOST =
  /idealist|google-?analytics|googletagmanager|gstatic|googleapis|fonts\.google|facebook|instagram|twitter|tiktok|youtube|schema\.org|w3\.org|classy\.org|github|doubleclick|maps\.google/i;
const ATS_HOST =
  /bamboohr|greenhouse|lever\.co|myworkdayjobs|workday|jobs2web|smartrecruiters|applytojob|breezy|workable|icims|taleo|jobvite|recruitee|ashbyhq/i;
const FORM_HOST =
  /forms\.gle|forms\.office\.com|typeform\.com|jotform|airtable\.com|tally\.so|formstack|cognitoforms|surveymonkey/i;
const SHORTENER = /^(?:bit\.ly|tinyurl\.com|rebrand\.ly|cutt\.ly|lnkd\.in|t\.co|s\.id)$/i;

// The Idealist page carries the org's real apply link — an ATS, a Google/MS
// form, or a shortlink to one — alongside the org website, social and nav.
// First preference: the page state's own "applyUrl" field, which is exactly
// what Idealist's Apply button uses (present at any JSON-escape depth). Fall
// back to scoring every external URL by how apply-like it is (host + path
// signals); the org homepage and social links score 0 and are ignored.
export function extractAtsUrl(html: string): string | null {
  const state = html.match(/\\*"applyUrl\\*",\\*"(https?:\/\/[^"\\]+)/);
  if (state?.[1]) return stripTracking(state[1].replace(/&amp;/g, "&"));

  let best: { url: string; score: number } | null = null;
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
    let u: URL;
    try {
      // Trailing \ runs are JSON-escape artifacts (\" at various depths), not
      // part of the URL.
      u = new URL(m[0].replace(/&amp;/g, "&").replace(/\\+$/, ""));
    } catch {
      continue;
    }
    const host = u.hostname.replace(/^www\./, "");
    if (IGNORE_HOST.test(host)) continue;
    let score = 0;
    if (ATS_HOST.test(host)) score += 12;
    if (FORM_HOST.test(host) || (host === "docs.google.com" && u.pathname.includes("/forms"))) score += 12;
    if (SHORTENER.test(host)) score += 6;
    if (/\/apply|\/careers?\/[\w-]|\/jobs?\/|gh_jid=/i.test(u.pathname + u.search)) score += 5;
    if (/\/\d{2,}(?:[/?#]|$)/.test(u.pathname)) score += 4; // a specific job id
    if (score === 0) continue;
    if (!best || score > best.score) best = { url: stripTracking(u.toString()), score };
  }
  return best?.url ?? null;
}

// Follow a shortlink (bit.ly/…) to the real form/ATS URL so the button shows a
// trustworthy destination, not an opaque redirector.
async function resolveShortener(url: string): Promise<string> {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
  if (!SHORTENER.test(host)) return url;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal });
    clearTimeout(timer);
    return stripTracking(res.url || url);
  } catch {
    return url;
  }
}

function stripTracking(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      // Drop tracking/AMP markers and any empty-valued param.
      if (/^(?:utm_|gh_src$|source$|ref$|amp$)/i.test(k) || url.searchParams.get(k) === "") {
        url.searchParams.delete(k);
      }
    }
    const qs = url.searchParams.toString();
    url.search = qs ? `?${qs}` : "";
    return url.toString().replace(/#$/, "");
  } catch {
    return u;
  }
}
