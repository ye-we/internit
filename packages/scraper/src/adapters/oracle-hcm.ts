// Oracle HCM Cloud (Recruiting Cloud / CandidateExperience) adapter.
// Career sites live at {origin}/hcmUI/CandidateExperience/en/sites/{site}/...
// with a public REST API for search and detail. UNDP's bespoke list page is
// handled by sources/undp.ts; this adapter covers any generic Oracle tenant.

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing } from "../index.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { isEthiopiaAccessible, isInternship } from "./types.js";

type SearchItem = {
  Id: string;
  Title: string;
  PostedDate?: string | null;
  PrimaryLocation?: string | null;
  ShortDescriptionStr?: string | null;
};

type DetailItem = {
  Id: string;
  Title: string;
  ExternalPostedStartDate: string | null;
  ExternalPostedEndDate: string | null;
  ExternalDescriptionStr: string | null;
  PrimaryLocation: string | null;
  PrimaryLocationCountry: string | null;
};

export const oracleHcmAdapter: Adapter = {
  name: "oracle-hcm",

  detect(url: string): boolean {
    return /\.oraclecloud\.com\//.test(url);
  },

  async scrape(
    config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts: AdapterOpts = {},
  ): Promise<ScrapedListing[]> {
    const max = opts.max ?? 20;
    const { origin, site } = parseSite(config.url);

    const searchUrl =
      `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
      `?onlyData=true&finder=findReqs;siteNumber=${site},keyword=intern,limit=${Math.min(max * 3, 100)},sortBy=POSTING_DATES_DESC`;
    const searchBody = await fetcher.get(searchUrl, "application/json");
    const search = JSON.parse(searchBody) as {
      items?: Array<{ requisitionList?: SearchItem[] }>;
    };
    const reqs = (search.items ?? []).flatMap((item) => item.requisitionList ?? []);

    const out: ScrapedListing[] = [];
    for (const req of reqs) {
      if (out.length >= max) break;
      if (!isInternship(req.Title)) continue;
      try {
        const detailUrl =
          `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
          `?finder=ById;Id=${encodeURIComponent(req.Id)},siteNumber=${site}`;
        const detailBody = await fetcher.get(detailUrl, "application/json");
        const detail = (JSON.parse(detailBody) as { items?: DetailItem[] }).items?.[0];
        if (!detail) continue;
        const listing = parseDetail(origin, site, detail, config);
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
      } catch (err) {
        console.error(`[oracle-hcm] failed detail for ${req.Id}:`, err);
      }
    }
    return out;
  },
};

function parseSite(url: string): { origin: string; site: string } {
  const u = new URL(url);
  const m = /\/sites\/([^/]+)/.exec(u.pathname);
  return { origin: u.origin, site: m?.[1] ?? "CX_1" };
}

function parseDetail(
  origin: string,
  site: string,
  detail: DetailItem,
  config: AdapterConfig,
): ScrapedListing {
  const descriptionHtml = cleanDescriptionHtml(detail.ExternalDescriptionStr ?? "", {
    resolveUrl: (href) => new URL(href, origin).href,
  });
  const descriptionText = collapse(cheerio.load(descriptionHtml).text());
  const title = collapse(detail.Title);
  const lowerText = `${title}\n${descriptionText}`.toLowerCase();

  return {
    source: `oracle-hcm:${config.orgSlug ?? new URL(origin).hostname}`,
    sourceUrl: `${origin}/hcmUI/CandidateExperience/en/sites/${site}/job/${detail.Id}`,
    sourceId: detail.Id,
    orgName: config.orgName ?? "Unknown",
    orgSlug: config.orgSlug ?? null,
    title,
    location: detail.PrimaryLocation,
    isRemote: /\bremote\b|home-?based/.test(lowerText),
    isPaid: detectPaid(lowerText),
    stipendText: extractStipend(descriptionText),
    deadline: parseDate(detail.ExternalPostedEndDate),
    postedAt: parseDate(detail.ExternalPostedStartDate),
    descriptionHtml,
    descriptionText,
    raw: { primaryLocationCountry: detail.PrimaryLocationCountry },
  };
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function detectPaid(lowerText: string): boolean | null {
  if (/\bunpaid\b|gratis personnel|not remunerated/.test(lowerText)) return false;
  if (/\bstipend\b|\bpaid\b|\bmonthly allowance\b/.test(lowerText)) return true;
  return null;
}

function extractStipend(text: string): string | null {
  const m = /(stipend|allowance)[^.\n]{0,160}/i.exec(text);
  return m ? collapse(m[0]) : null;
}
