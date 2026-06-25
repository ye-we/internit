import { ADAPTERS } from "./adapters/index.js";
import type { Adapter } from "./adapters/types.js";
import type { PoliteFetcher } from "./fetcher.js";
import { BrowserChallengeError } from "./html.js";
import type { ScrapedListing } from "./index.js";

export type DispatchOrg = {
  slug: string;
  name: string;
  careersUrl?: string | null;
  internshipUrl?: string | null;
};

export type DispatchResult = {
  org: DispatchOrg;
  adapter: string | null;
  listings: ScrapedListing[];
  error: string | null;
  durationMs: number;
};

export function findAdapter(url: string): Adapter | null {
  return ADAPTERS.find((a) => a.detect(url)) ?? null;
}

export async function dispatchOrg(
  org: DispatchOrg,
  fetcher: PoliteFetcher,
  opts: { max?: number } = {},
): Promise<DispatchResult> {
  const t0 = Date.now();
  const url = org.internshipUrl ?? org.careersUrl;
  if (!url) {
    return { org, adapter: null, listings: [], error: "no url", durationMs: 0 };
  }

  const adapter = findAdapter(url);
  if (!adapter) {
    return {
      org,
      adapter: null,
      listings: [],
      error: "no adapter",
      durationMs: Date.now() - t0,
    };
  }

  try {
    const listings = await adapter.scrape(
      { url, orgSlug: org.slug, orgName: org.name },
      fetcher,
      opts,
    );
    return { org, adapter: adapter.name, listings, error: null, durationMs: Date.now() - t0 };
  } catch (err) {
    const error =
      err instanceof BrowserChallengeError
        ? `browser challenge: ${err.url}`
        : err instanceof Error
          ? err.message
          : String(err);
    return { org, adapter: adapter.name, listings: [], error, durationMs: Date.now() - t0 };
  }
}
