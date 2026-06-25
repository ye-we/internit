// Thin wrapper over the Inspira adapter for the legacy CLI path.

import { inspiraAdapter } from "../adapters/inspira.js";
import { PoliteFetcher } from "../fetcher.js";
import type { ScrapedListing, Source } from "../index.js";

export class UnCareersSource implements Source {
  name = "un-careers";

  constructor(private readonly fetcher: PoliteFetcher = new PoliteFetcher()) {}

  async scrape(opts: { max?: number } = {}): Promise<ScrapedListing[]> {
    return inspiraAdapter.scrape(
      { url: "https://careers.un.org", orgSlug: "un-careers" },
      this.fetcher,
      opts,
    );
  }
}
