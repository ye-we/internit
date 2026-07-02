// Dummy listings for /test_card — exercise the card + caption across the cases
// that actually vary the layout: short vs long title, near deadline vs rolling,
// paid / unpaid / unknown, remote vs Addis, with and without an apply link.
// Deadlines are computed relative to now on each call so a long-lived bot never
// renders a stale "expired" sample.

import type { Listing } from "@internit/db";

const DAY = 86_400_000;

// Fill the many Listing columns /test_card doesn't care about with sane defaults;
// callers override only what the card/caption read.
function base(over: Partial<Listing>): Listing {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    source: "sample",
    sourceUrl: "https://example.org/sample-listing",
    sourceId: null,
    orgName: "Sample Org",
    orgSlug: null,
    title: "Sample Intern",
    location: "Addis Ababa",
    isRemote: false,
    isPaid: null,
    stipendText: null,
    deadline: null,
    postedAt: now,
    scrapedAt: now,
    descriptionHtml: "",
    descriptionText: "A sample listing used to preview the /test_card layout.",
    fieldTags: ["governance", "policy"],
    fitScore: 80,
    status: "active",
    postedToChannel: false,
    raw: null,
    ...over,
  } as Listing;
}

// raw.structured.data is what the caption reads for its summary + apply link.
const structured = (summary: string, applicationUrl?: string) => ({
  structured: { data: { summary, application_url: applicationUrl ?? null } },
});

export function sampleListings(): Listing[] {
  return [
    base({
      source: "idealist",
      orgName: "CIVICUS",
      title: "Civic Space Research Intern",
      isRemote: true,
      location: "Remote",
      isPaid: false,
      fitScore: 95,
      deadline: new Date(Date.now() + 6 * DAY),
      fieldTags: ["human-rights", "elections-democracy", "international-relations"],
      sourceUrl: "https://www.idealist.org/en/nonprofit-internship/civic-space-research-intern",
      raw: structured(
        "CIVICUS is seeking a Civic Space Research Intern to support the CIVICUS Monitor's global research collaboration for the annual People Power Under Attack reports.",
        "https://civicus.bamboohr.com/careers",
      ),
    }),
    base({
      source: "un-careers",
      orgName: "Office of the High Commissioner for Human Rights",
      title: "Research & Advocacy Intern, Peace and Conflict Studies Unit",
      isRemote: true,
      location: "Remote",
      isPaid: null,
      fitScore: 88,
      deadline: null,
      fieldTags: ["human-rights", "peacebuilding", "research"],
      raw: structured(
        "A remote internship supporting research and advocacy on peace and conflict issues, open to applicants worldwide on a rolling basis.",
      ),
    }),
    base({
      source: "un-careers",
      orgName: "UN Careers Portal",
      title: "Communications Intern",
      location: "Addis Ababa",
      isPaid: false,
      fitScore: 70,
      deadline: new Date(Date.now() + 1 * DAY),
      fieldTags: ["governance", "advocacy", "policy"],
      raw: structured(
        "Support internal and external communications for a UN office based in Addis Ababa, drafting materials and helping disseminate them.",
      ),
    }),
    base({
      source: "successfactors",
      orgName: "African Union Commission",
      title: "Democracy & Elections Intern",
      location: "Addis Ababa",
      isPaid: true,
      fitScore: 92,
      deadline: new Date(Date.now() + 20 * DAY),
      fieldTags: ["democracy", "elections", "governance"],
      raw: structured(
        "A paid internship with the African Union supporting democracy and elections programming across member states.",
        "https://jobs.au.int/",
      ),
    }),
  ];
}
