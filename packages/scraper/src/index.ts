// Scraper entrypoint. One module per source under ./sources/.
// v1 ships with ethiongojobs only.

export const SCRAPER_USER_AGENT =
  "TilqBot/0.1 (+https://example.com/about; internship aggregator for Ethiopian social-studies students)";

export type ScrapedListing = {
  source: string;
  sourceUrl: string;
  sourceId: string | null;
  orgName: string;
  orgSlug: string | null;
  title: string;
  location: string | null;
  isRemote: boolean;
  isPaid: boolean | null;
  stipendText: string | null;
  deadline: Date | null;
  postedAt: Date | null;
  descriptionHtml: string;
  descriptionText: string;
  raw: unknown;
};

export interface Source {
  name: string;
  scrape(): Promise<ScrapedListing[]>;
}

export { PoliteFetcher } from "./fetcher.js";
export { persistListings, type PersistResult } from "./persist.js";
export { EthioNGOJobsSource } from "./sources/ethiongojobs.js";
export { UndpSource } from "./sources/undp.js";
export { UnCareersSource } from "./sources/un-careers.js";
