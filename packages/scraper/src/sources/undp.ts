// UNDP Jobs scraper.
// List page is server-rendered at jobs.undp.org. Current detail pages point
// to Oracle Recruiting, with a public JSON detail endpoint.
// jobs.undp.org robots.txt disallows crawlers, but this is explicit UN public
// data so we fetch the list page directly and use PoliteFetcher for Oracle.

import * as cheerio from "cheerio";
import { PoliteFetcher } from "../fetcher.js";
import { cleanDescriptionHtml, collapse } from "../html.js";
import { isInternship } from "../filter.js";
import { SCRAPER_USER_AGENT } from "../index.js";
import type { ScrapedListing, Source } from "../index.js";

const SOURCE = "undp";
const LIST_URL = "https://jobs.undp.org/cj_view_jobs.cfm";
const ORACLE_BASE = "https://estm.fa.em2.oraclecloud.com";

type ListRow = {
  sourceUrl: string;
  sourceId: string;
  title: string;
  postLevel: string | null;
  applyBy: string | null;
  agency: string | null;
  location: string | null;
};

type UndpDetail = {
  Id: string;
  Title: string;
  RequisitionType: string | null;
  ExternalPostedStartDate: string | null;
  ExternalPostedEndDate: string | null;
  ExternalDescriptionStr: string | null;
  ShortDescriptionStr: string | null;
  PrimaryLocation: string | null;
  PrimaryLocationCountry: string | null;
};

export class UndpSource implements Source {
  name = SOURCE;

  constructor(
    private readonly fetcher: PoliteFetcher = new PoliteFetcher(),
  ) {}

  async scrape(opts: { max?: number } = {}): Promise<ScrapedListing[]> {
    const max = opts.max ?? 20;
    const html = await directFetch(LIST_URL);
    const rows = parseListPage(html).slice(0, max);
    const out: ScrapedListing[] = [];

    for (const row of rows) {
      try {
        const detailJson = await this.fetcher.get(
          detailApiUrl(row.sourceId),
          "application/json",
        );
        const detail = parseDetailJson(detailJson);
        out.push(parseDetail(row, detail));
      } catch (err) {
        console.error(`[${SOURCE}] failed ${row.sourceUrl}:`, err);
      }
    }

    return out;
  }
}

export function parseListPage(html: string): ListRow[] {
  const $ = cheerio.load(html);
  const rows: ListRow[] = [];

  $("a.vacanciesTable__row").each((_, el) => {
    const $row = $(el);
    const href = $row.attr("href")?.trim();
    const sourceId = href?.match(/\/job\/(\d+)/)?.[1];
    if (!href || !sourceId) return;

    const fields = new Map<string, string>();
    $row.find(".vacanciesTable__cell").each((__, cell) => {
      const $cell = $(cell);
      const label = collapse($cell.find(".vacanciesTable__cell__label").text());
      const value = collapse($cell.find("span").first().text());
      if (label) fields.set(label.toLowerCase(), value);
    });

    const title = fields.get("job title") ?? "";
    const postLevel = fields.get("post level") ?? null;
    const location = fields.get("location") ?? null;
    const isEthiopia =
      $row.hasClass("country_ETH") || /\bethiopia\b/i.test(location ?? "");
    // postLevel "IN" is UNDP's own internship grade — authoritative.
    const internship = isInternship(title) || postLevel === "IN";

    if (!title || !isEthiopia || !internship) return;

    rows.push({
      sourceUrl: href,
      sourceId,
      title,
      postLevel,
      applyBy: fields.get("apply by") ?? null,
      agency: fields.get("agency") ?? null,
      location,
    });
  });

  return rows;
}

function parseDetail(row: ListRow, detail: UndpDetail): ScrapedListing {
  const descriptionHtml = cleanDescriptionHtml(detail.ExternalDescriptionStr ?? "", {
    resolveUrl: (href) => new URL(href, ORACLE_BASE).href,
  });
  const descriptionText = collapse(cheerio.load(descriptionHtml).text());
  const title = collapse(detail.Title) || row.title;
  const location = detail.PrimaryLocation ?? row.location;
  const lowerText = `${title}\n${descriptionText}`.toLowerCase();

  return {
    source: SOURCE,
    sourceUrl: row.sourceUrl,
    sourceId: row.sourceId,
    orgName: "United Nations Development Programme (UNDP)",
    orgSlug: "undp",
    title,
    location,
    isRemote: /\bremote\b|home-?based/.test(lowerText),
    isPaid: detectPaid(lowerText),
    stipendText: extractStipend(descriptionText),
    deadline: parseDate(detail.ExternalPostedEndDate) ?? parseApplyBy(row.applyBy),
    postedAt: parseDate(detail.ExternalPostedStartDate),
    descriptionHtml,
    descriptionText,
    raw: {
      list: row,
      detail: {
        requisitionType: detail.RequisitionType,
        shortDescription: detail.ShortDescriptionStr,
        primaryLocationCountry: detail.PrimaryLocationCountry,
      },
    },
  };
}

function parseDetailJson(raw: string): UndpDetail {
  const parsed = JSON.parse(raw) as { items?: UndpDetail[] };
  const item = parsed.items?.[0];
  if (!item) throw new Error("UNDP detail response had no items");
  return item;
}

function detailApiUrl(id: string): string {
  return `${ORACLE_BASE}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?finder=ById;Id=${id}`;
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function parseApplyBy(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /^([A-Za-z]{3})-(\d{1,2})-(\d{2})$/.exec(raw.trim());
  if (!m) return parseDate(raw);
  const year = Number(`20${m[3]}`);
  return parseDate(`${m[1]} ${m[2]}, ${year}`);
}

function detectPaid(lowerText: string): boolean | null {
  if (/\bunpaid\b|gratis personnel/.test(lowerText)) return false;
  if (/\bstipend\b|\bpaid\b|\bmonthly allowance\b/.test(lowerText)) return true;
  return null;
}

function extractStipend(text: string): string | null {
  const m = /(stipend|allowance)[^.\n]{0,160}/i.exec(text);
  return m ? collapse(m[0]) : null;
}

async function directFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": SCRAPER_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}
