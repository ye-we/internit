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
  scrape(opts?: { max?: number }): Promise<ScrapedListing[]>;
}

export { PoliteFetcher } from "./fetcher.js";
export {
  persistListings,
  persistOrgRun,
  type OrgRunResult,
  type OrgRunStats,
  type PersistResult,
} from "./persist.js";
export {
  BrowserChallengeError,
  isBrowserInterstitial,
  cleanDescriptionHtml,
  collapse,
  htmlToText,
} from "./html.js";
export {
  isInternship,
  isEthiopiaAccessible,
  ethiopiaAccess,
  type AccessCategory,
  type AccessResult,
  type AccessParts,
} from "./filter.js";
export { structureListingsBatch } from "./structure.js";
export { ensureStructured, type StructuredResult } from "./structure-listings.js";
export { dispatchOrg, findAdapter, type DispatchOrg, type DispatchResult } from "./dispatch.js";
export { ADAPTERS, type Adapter, type AdapterConfig } from "./adapters/index.js";
export { EthioNGOJobsSource } from "./sources/ethiongojobs.js";
export { UndpSource } from "./sources/undp.js";
export { UnCareersSource } from "./sources/un-careers.js";
export { EhrcdSource } from "./sources/ehrdc.js";
