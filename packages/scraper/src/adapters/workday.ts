// Workday adapter. {tenant}.{dc}.myworkdayjobs.com hosts expose an
// unauthenticated CXS JSON API. Search is a POST; details come from a GET
// per posting, so each kept listing costs one extra (throttled) request.

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing } from "../index.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { isEthiopiaAccessible, isInternship } from "./types.js";

type WdSearch = {
  jobPostings?: Array<{
    title?: string;
    externalPath?: string;
    locationsText?: string;
    postedOn?: string;
    bulletFields?: string[];
  }>;
};

type WdDetail = {
  jobPostingInfo?: {
    id?: string;
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    postedOn?: string;
    startDate?: string;
    timeType?: string;
    jobReqId?: string;
    externalUrl?: string;
  };
};

export const workdayAdapter: Adapter = {
  name: "workday",

  detect(url: string): boolean {
    return parseWorkdayUrl(url) !== null;
  },

  async scrape(
    config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts: AdapterOpts = {},
  ): Promise<ScrapedListing[]> {
    const max = opts.max ?? 20;
    const parsed = parseWorkdayUrl(config.url);
    if (!parsed) throw new Error(`not a workday url: ${config.url}`);
    const { origin, tenant, site } = parsed;

    const searchUrl = `${origin}/wday/cxs/${tenant}/${site}/jobs`;
    const body = await fetcher.post(searchUrl, {
      limit: 20,
      offset: 0,
      searchText: "intern",
      appliedFacets: {},
    });
    const search = JSON.parse(body) as WdSearch;

    const out: ScrapedListing[] = [];
    for (const posting of search.jobPostings ?? []) {
      if (out.length >= max) break;
      const title = collapse(posting.title);
      if (!title || !posting.externalPath) continue;
      if (!isInternship(title)) continue;

      // Cheap pre-filter on the search row before paying for the detail GET.
      const rowLocation = collapse(posting.locationsText) || null;
      if (
        rowLocation &&
        !isEthiopiaAccessible({ location: rowLocation, title, descriptionText: "" })
      ) {
        continue;
      }

      const detailUrl = `${origin}/wday/cxs/${tenant}/${site}${posting.externalPath}`;
      let detail: WdDetail;
      try {
        detail = JSON.parse(await fetcher.get(detailUrl, "application/json")) as WdDetail;
      } catch {
        continue;
      }
      const info = detail.jobPostingInfo;
      if (!info) continue;

      const descriptionHtml = cleanDescriptionHtml(info.jobDescription ?? "");
      const descriptionText = collapse(cheerio.load(descriptionHtml).text());
      const location =
        collapse([info.location, ...(info.additionalLocations ?? [])].filter(Boolean).join(", ")) ||
        rowLocation;
      if (!isEthiopiaAccessible({ location, title, descriptionText })) continue;

      const lowerText = `${title}\n${location ?? ""}\n${descriptionText}`.toLowerCase();
      const sourceUrl = info.externalUrl ?? `${origin}/${site}${posting.externalPath}`;

      out.push({
        source: `workday:${config.orgSlug ?? tenant}`,
        sourceUrl,
        sourceId: info.jobReqId ?? info.id ?? posting.externalPath,
        orgName: config.orgName ?? tenant,
        orgSlug: config.orgSlug ?? null,
        title,
        location,
        isRemote: /\bremote\b|home-?based/.test(lowerText),
        isPaid: detectPaid(lowerText),
        stipendText: extractStipend(descriptionText),
        deadline: null,
        postedAt: null,
        descriptionHtml,
        descriptionText,
        raw: { postedOn: info.postedOn ?? posting.postedOn, timeType: info.timeType },
      });
    }
    return out;
  },
};

function parseWorkdayUrl(
  url: string,
): { origin: string; tenant: string; site: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = /^([a-z0-9-]+)\.(?:wd\d+\.)?myworkdayjobs\.com$/i.exec(u.hostname);
  if (!m) return null;
  // Path is /{site} or /{locale}/{site}; locale looks like en-US.
  const segs = u.pathname.split("/").filter(Boolean);
  const site =
    segs.find((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s) && !s.startsWith("job")) ?? segs[0];
  if (!site) return null;
  return { origin: u.origin, tenant: m[1]!.toLowerCase(), site };
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
