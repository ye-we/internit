// UN Careers scraper. Uses the public JSON payload consumed by careers.un.org.

import * as cheerio from "cheerio";
import { cleanDescriptionHtml, collapse } from "../html.js";
import type { ScrapedListing, Source } from "../index.js";

const SOURCE = "un-careers";
const ACTIVE_JOBS_URL = "https://careers.un.org/api/public/opening/jo/activeJo?language=en";
const JOB_URL_BASE = "https://careers.un.org/jobSearchDescription/";

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

export class UnCareersSource implements Source {
  name = SOURCE;

  async scrape(opts: { max?: number } = {}): Promise<ScrapedListing[]> {
    const max = opts.max ?? 20;
    const res = await fetch(ACTIVE_JOBS_URL, {
      headers: {
        "User-Agent":
          "TilqBot/0.1 (+https://example.com/about; internship aggregator for Ethiopian social-studies students)",
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`GET ${ACTIVE_JOBS_URL} -> HTTP ${res.status}`);

    const json = (await res.json()) as { data?: UnCareerRow[] };
    return (json.data ?? [])
      .filter(isRelevantInternship)
      .slice(0, max)
      .map(parseRow);
  }
}

function isRelevantInternship(row: UnCareerRow): boolean {
  if (row.categoryCode !== "INT") return false;
  const text = `${row.postingTitle}\n${row.jobDescription}`.toLowerCase();
  const locations = (row.dutyStation ?? [])
    .map((station) => station.description ?? "")
    .join(" ")
    .toLowerCase();

  return (
    /\baddis\b|\bethiopia\b/.test(locations) ||
    /\bremote\b|home-?based/.test(text)
  );
}

function parseRow(row: UnCareerRow): ScrapedListing {
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
    source: SOURCE,
    sourceUrl: `${JOB_URL_BASE}${row.jobId}`,
    sourceId: String(row.jobId),
    orgName: "United Nations Careers",
    orgSlug: "un-careers",
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
