// SmartRecruiters adapter. Public postings API, no auth. Search GET returns
// summaries; each kept posting needs one detail GET for the description.

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing } from "../index.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { isEthiopiaAccessible, isInternship } from "./types.js";

type SrSearch = {
  content?: Array<{
    id: string;
    uuid?: string;
    name?: string;
    releasedDate?: string;
    location?: { city?: string; country?: string; remote?: boolean };
  }>;
};

type SrDetail = {
  id: string;
  name?: string;
  releasedDate?: string;
  location?: { city?: string; country?: string; remote?: boolean };
  applyUrl?: string;
  postingUrl?: string;
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string }>;
  };
};

export const smartrecruitersAdapter: Adapter = {
  name: "smartrecruiters",

  detect(url: string): boolean {
    return extractCompany(url) !== null;
  },

  async scrape(
    config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts: AdapterOpts = {},
  ): Promise<ScrapedListing[]> {
    const max = opts.max ?? 20;
    const company = extractCompany(config.url);
    if (!company) throw new Error(`not a smartrecruiters url: ${config.url}`);

    // api.smartrecruiters.com robots.txt disallows crawlers, but the Posting
    // API is documented as public for programmatic consumption — skip the
    // robots check here; throttling still applies.
    const searchUrl = `https://api.smartrecruiters.com/v1/companies/${company}/postings?q=intern&limit=50`;
    const body = await fetcher.get(searchUrl, "application/json", { skipRobots: true });
    const search = JSON.parse(body) as SrSearch;

    const out: ScrapedListing[] = [];
    for (const row of search.content ?? []) {
      if (out.length >= max) break;
      const title = collapse(row.name);
      if (!title || !isInternship(title)) continue;

      const rowLocation = formatLocation(row.location);
      if (
        rowLocation &&
        !row.location?.remote &&
        !isEthiopiaAccessible({ location: rowLocation, title, descriptionText: "" })
      ) {
        continue;
      }

      const detailUrl = `https://api.smartrecruiters.com/v1/companies/${company}/postings/${row.id}`;
      let detail: SrDetail;
      try {
        detail = JSON.parse(
          await fetcher.get(detailUrl, "application/json", { skipRobots: true }),
        ) as SrDetail;
      } catch {
        continue;
      }

      const sections = Object.values(detail.jobAd?.sections ?? {});
      const rawHtml = sections
        .map((s) => `${s.title ? `<h3>${s.title}</h3>` : ""}${s.text ?? ""}`)
        .join("");
      const descriptionHtml = cleanDescriptionHtml(rawHtml);
      const descriptionText = collapse(cheerio.load(descriptionHtml).text());
      const location = formatLocation(detail.location) ?? rowLocation;
      if (!isEthiopiaAccessible({ location, title, descriptionText })) continue;

      const lowerText = `${title}\n${location ?? ""}\n${descriptionText}`.toLowerCase();
      const sourceUrl =
        detail.postingUrl ??
        `https://jobs.smartrecruiters.com/${company}/${row.id}`;

      out.push({
        source: `smartrecruiters:${config.orgSlug ?? company.toLowerCase()}`,
        sourceUrl,
        sourceId: String(row.id),
        orgName: config.orgName ?? company,
        orgSlug: config.orgSlug ?? null,
        title,
        location,
        isRemote: Boolean(detail.location?.remote) || /\bremote\b|home-?based/.test(lowerText),
        isPaid: detectPaid(lowerText),
        stipendText: extractStipend(descriptionText),
        deadline: null,
        postedAt: parseDate(detail.releasedDate ?? row.releasedDate),
        descriptionHtml,
        descriptionText,
        raw: { applyUrl: detail.applyUrl },
      });
    }
    return out;
  },
};

function extractCompany(url: string): string | null {
  const m =
    /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/.exec(url) ??
    /smartrecruiters\.com\/(?:company\/)?([A-Za-z0-9_-]+)/.exec(url);
  const c = m?.[1];
  return c && !["v1", "companies"].includes(c.toLowerCase()) ? c : null;
}

function formatLocation(
  loc: { city?: string; country?: string; remote?: boolean } | undefined,
): string | null {
  if (!loc) return null;
  const parts = [collapse(loc.city), collapse(loc.country)].filter(Boolean);
  if (loc.remote) parts.push("Remote");
  return parts.join(", ") || null;
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
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
