import type { PoliteFetcher } from "../fetcher.js";
import type { ScrapedListing } from "../index.js";

export type AdapterConfig = {
  url: string;
  orgSlug?: string | null;
  orgName?: string;
};

export type AdapterOpts = {
  max?: number;
};

export interface Adapter {
  name: string;
  detect(url: string): boolean;
  scrape(
    config: AdapterConfig,
    fetcher: PoliteFetcher,
    opts?: AdapterOpts,
  ): Promise<ScrapedListing[]>;
}

// Pre-classifier gates every adapter must apply before yielding: "is it an
// internship at all" (internships only) + "can a student in Ethiopia plausibly
// take it". Implemented deterministically in ../filter.ts; re-exported here so
// adapters keep a single import.
export {
  isInternship,
  isEthiopiaAccessible,
  ethiopiaAccess,
  type AccessCategory,
  type AccessResult,
  type AccessParts,
} from "../filter.js";
