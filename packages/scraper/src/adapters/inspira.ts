// Inspira (careers.un.org) adapter. One JSON payload covers the whole UN
// Secretariat; per-org runs filter by department so UNECA, OHCHR, DPPA, DPO
// can each be dispatched without refetching.

import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing } from "../index.js";
import type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
import { ethiopiaAccess } from "./types.js";

const ACTIVE_JOBS_URL = "https://careers.un.org/api/public/opening/jo/activeJo?language=en";
const JOB_URL_BASE = "https://careers.un.org/jobSearchDescription/";
const PAYLOAD_TTL_MS = 30 * 60 * 1000;

const DEPT_BY_SLUG: Record<string, RegExp> = {
  uneca: /\bECA\b|Economic Commission for Africa/i,
  ohchr: /OHCHR|High Commissioner for Human Rights/i,
  "un-dppa": /DPPA|Political and Peacebuilding/i,
  "un-dpo": /\bDPO\b|Peace Operations/i,
};

type UnCareerRow = {
  jobId: number;
  categoryCode: string;
  jobTitle: string;
  postingTitle: string;
  jobDescription: string;
  dutyStation?: Array<{ description?: string }>;
  recruitmentType?: string;
  startDate?: string;
  endDate?: string;
  dept?: string;
};

let payloadCache: { at: number; rows: UnCareerRow[] } | null = null;

export const inspiraAdapter: Adapter = {
  name: "inspira",

  detect(url: string): boolean {
    try {
      return new URL(url).hostname === "careers.un.org";
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
    const rows = await loadRows(fetcher);
    const deptFilter = config.orgSlug ? DEPT_BY_SLUG[config.orgSlug] : undefined;

    return rows
      .filter((row) => isRelevantInternship(row, deptFilter))
      .slice(0, max)
      .map((row) => parseRow(row, config));
  },
};

async function loadRows(fetcher: PoliteFetcher): Promise<UnCareerRow[]> {
  if (payloadCache && Date.now() - payloadCache.at < PAYLOAD_TTL_MS) {
    return payloadCache.rows;
  }
  // One ~7MB JSON of the entire UN Secretariat. The default 45s timeout can
  // stall mid-download under concurrent load, failing the whole org — give it
  // generous headroom (the payload is cached for 30min, so this runs rarely).
  const body = await fetcher.get(ACTIVE_JOBS_URL, "application/json", {
    timeoutMs: 120_000,
  });
  const json = JSON.parse(body) as { data?: UnCareerRow[] };
  payloadCache = { at: Date.now(), rows: json.data ?? [] };
  return payloadCache.rows;
}

function isRelevantInternship(row: UnCareerRow, deptFilter?: RegExp): boolean {
  // categoryCode INT is the UN's own internship facet — authoritative.
  if (row.categoryCode !== "INT") return false;
  if (deptFilter && !deptFilter.test(row.dept ?? "")) return false;
  const locations = (row.dutyStation ?? [])
    .map((station) => station.description ?? "")
    .join(", ");
  // A UN internship is tied to its duty station, so judge accessibility from
  // that alone — NOT row.jobDescription. The descriptions are long, standardized
  // boilerplate that mention "remote"/travel/funding and otherwise false-positive
  // New York / Paris / Panama internships as Ethiopia-accessible. We keep Addis
  // duty stations and genuinely remote/home-based ones (doable from anywhere,
  // including Addis) — the global-remote slice.
  return (
    ethiopiaAccess({ location: locations, title: row.postingTitle }).accessible ||
    REMOTE_DUTY_RE.test(locations)
  );
}

// Duty stations an Addis student can take from home. "Remote" alone is already
// caught by ethiopiaAccess; this adds the home-based/virtual phrasings.
const REMOTE_DUTY_RE = /\bremote\b|home[-\s]?based|virtual|telecommut/i;

function parseRow(row: UnCareerRow, config: AdapterConfig): ScrapedListing {
  const descriptionHtml = cleanDescriptionHtml(row.jobDescription, {
    resolveUrl: (href) => new URL(href, "https://careers.un.org").href,
  });
  const descriptionText = collapse(cheerio.load(descriptionHtml).text());
  const title = collapse(row.postingTitle || row.jobTitle);
  const location = (row.dutyStation ?? [])
    .map((station) => collapse(station.description))
    .filter(Boolean)
    .join(", ");
  const lowerText = `${title}\n${descriptionText}`.toLowerCase();

  return {
    source: "un-careers",
    sourceUrl: `${JOB_URL_BASE}${row.jobId}`,
    sourceId: String(row.jobId),
    orgName: config.orgName ?? "United Nations Careers",
    orgSlug: config.orgSlug ?? "un-careers",
    title,
    location: location || null,
    isRemote: /\bremote\b|home-?based/.test(lowerText),
    isPaid: detectPaid(lowerText),
    stipendText: extractStipend(descriptionText),
    deadline: parseDate(row.endDate),
    postedAt: parseDate(row.startDate),
    descriptionHtml,
    descriptionText,
    raw: {
      categoryCode: row.categoryCode,
      recruitmentType: row.recruitmentType,
      department: row.dept,
    },
  };
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function detectPaid(lowerText: string): boolean | null {
  if (/\bunpaid\b|not financially remunerated|not remunerated/.test(lowerText)) {
    return false;
  }
  if (/\bpaid\b|\bstipend\b|\bmonthly allowance\b/.test(lowerText)) return true;
  return null;
}

function extractStipend(text: string): string | null {
  const m = /(stipend|allowance|remunerated|unpaid)[^.\n]{0,160}/i.exec(text);
  return m ? collapse(m[0]) : null;
}
