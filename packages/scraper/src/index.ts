// Scraper entrypoint. One module per source under ./sources/.
// v1 ships with ethiongojobs only.

// Politeness policy (CLAUDE.md): the UA must link a real contact page so site
// operators can reach us. Prefer the deployed site's /about; the public repo
// is the fallback contact when SITE_URL isn't set.
const SCRAPER_CONTACT = process.env.SITE_URL
  ? `${process.env.SITE_URL.replace(/\/$/, "")}/about`
  : "https://github.com/ye-we/internit";
export const SCRAPER_USER_AGENT = `TilqBot/0.1 (+${SCRAPER_CONTACT}; internship aggregator for Ethiopian social-studies students)`;

export type ScrapedListing = {
  source: string;
  sourceUrl: string;
  sourceId: string | null;
  applyUrl?: string | null;
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
export { structureListingsBatch, getGeminiRequestCount } from "./structure.js";
export { ensureStructured, type StructuredResult } from "./structure-listings.js";
export { evidencedApplyUrl } from "./structure.js";
export { fetchApplyUrl } from "./adapters/idealist.js";
export { dispatchOrg, findAdapter, type DispatchOrg, type DispatchResult } from "./dispatch.js";
export { ADAPTERS, type Adapter, type AdapterConfig } from "./adapters/index.js";
export { EthioNGOJobsSource } from "./sources/ethiongojobs.js";
export { UndpSource } from "./sources/undp.js";
export { UnCareersSource } from "./sources/un-careers.js";
export { EhrcdSource } from "./sources/ehrdc.js";
