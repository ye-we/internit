// Fixture tests: no network. Each adapter gets a mocked PoliteFetcher that
// serves canned API/HTML payloads keyed by URL.

import { beforeAll, describe, expect, it } from "vitest";
import type { PoliteFetcher } from "../fetcher.js";
import { findAdapter } from "../dispatch.js";
import { genericHtmlAdapter } from "../adapters/generic-html.js";
import { greenhouseAdapter } from "../adapters/greenhouse.js";
import { idealistAdapter } from "../adapters/idealist.js";
import { inspiraAdapter } from "../adapters/inspira.js";
import { leverAdapter } from "../adapters/lever.js";
import { reliefwebAdapter } from "../adapters/reliefweb.js";
import { smartrecruitersAdapter } from "../adapters/smartrecruiters.js";
import { successfactorsAdapter } from "../adapters/successfactors.js";
import { wordpressAdapter } from "../adapters/wordpress.js";
import { workdayAdapter } from "../adapters/workday.js";
import { extractStipend, extractTopMeta, findDeadlineInText, parseDeadline } from "../text-extract.js";

function mockFetcher(routes: Record<string, string | ((body?: unknown) => string)>): PoliteFetcher {
  const lookup = (url: string, body?: unknown): string => {
    for (const [key, value] of Object.entries(routes)) {
      if (url.includes(key)) return typeof value === "function" ? value(body) : value;
    }
    throw new Error(`no fixture for ${url}`);
  };
  return {
    get: async (url: string) => lookup(url),
    post: async (url: string, jsonBody: unknown) => lookup(url, jsonBody),
  } as unknown as PoliteFetcher;
}

describe("findAdapter dispatch priority", () => {
  const cases: Array<[string, string | null]> = [
    ["https://careers.un.org/jobopening", "inspira"],
    ["https://estm.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1", "oracle-hcm"],
    ["https://reliefweb.int/jobs", "reliefweb"],
    ["https://acme.wd3.myworkdayjobs.com/en-US/Careers", "workday"],
    ["https://boards.greenhouse.io/acme", "greenhouse"],
    ["https://jobs.lever.co/acme", "lever"],
    ["https://careers.smartrecruiters.com/Acme", "smartrecruiters"],
    ["https://jobs.au.int/job/Internship-Program/1506-en_US/", "successfactors"],
    ["https://opportunitydesk.org/", "wordpress"],
    ["https://www.example-unknown-ngo.org/vacancies", "generic-html"],
    ["not a url", null],
  ];
  for (const [url, expected] of cases) {
    it(`${url} → ${expected}`, () => {
      expect(findAdapter(url)?.name ?? null).toBe(expected);
    });
  }
});

describe("greenhouse adapter", () => {
  it("parses entity-escaped content and keeps Addis internships", async () => {
    const fetcher = mockFetcher({
      "boards-api.greenhouse.io/v1/boards/acme/jobs": JSON.stringify({
        jobs: [
          {
            id: 11,
            title: "Governance Policy Intern",
            location: { name: "Addis Ababa, Ethiopia" },
            content: "&lt;p&gt;Support our governance research team. Stipend provided monthly.&lt;/p&gt;",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/11",
            updated_at: "2026-05-01T00:00:00Z",
          },
          {
            id: 12,
            title: "Senior Accountant",
            location: { name: "Addis Ababa, Ethiopia" },
            content: "&lt;p&gt;Finance role.&lt;/p&gt;",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/12",
          },
          {
            id: 13,
            title: "Research Intern",
            location: { name: "New York, USA" },
            content: "&lt;p&gt;On-site only in NYC.&lt;/p&gt;",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/13",
          },
        ],
      }),
    });
    const out = await greenhouseAdapter.scrape(
      { url: "https://boards.greenhouse.io/acme", orgSlug: "acme", orgName: "Acme" },
      fetcher,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Governance Policy Intern");
    expect(out[0]!.descriptionHtml).toContain("<p>");
    expect(out[0]!.descriptionHtml).not.toContain("&lt;");
    expect(out[0]!.isPaid).toBe(true);
    expect(out[0]!.source).toBe("greenhouse:acme");
  });
});

describe("lever adapter", () => {
  it("keeps remote internships via commitment category", async () => {
    const fetcher = mockFetcher({
      "api.lever.co/v0/postings/acme": JSON.stringify([
        {
          id: "p1",
          text: "Advocacy Associate (Early Career)",
          hostedUrl: "https://jobs.lever.co/acme/p1",
          createdAt: 1750000000000,
          categories: { location: "Remote", commitment: "Internship" },
          description: "<p>Remote advocacy internship, unpaid.</p>",
          lists: [{ text: "Duties", content: "<li>Write briefs</li>" }],
        },
      ]),
    });
    const out = await leverAdapter.scrape(
      { url: "https://jobs.lever.co/acme", orgSlug: "acme" },
      fetcher,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.isRemote).toBe(true);
    expect(out[0]!.isPaid).toBe(false);
    expect(out[0]!.descriptionHtml).toContain("<h3>Duties</h3>");
  });
});

describe("workday adapter", () => {
  it("POSTs search, GETs detail, uses externalUrl", async () => {
    const fetcher = mockFetcher({
      "/wday/cxs/acme/Careers/jobs": JSON.stringify({
        jobPostings: [
          {
            title: "Peacebuilding Intern",
            externalPath: "/job/Addis-Ababa/Peacebuilding-Intern_JR1",
            locationsText: "Addis Ababa, Ethiopia",
          },
          {
            title: "Logistics Officer",
            externalPath: "/job/Addis-Ababa/Logistics_JR2",
            locationsText: "Addis Ababa, Ethiopia",
          },
        ],
      }),
      "/wday/cxs/acme/Careers/job/Addis-Ababa/Peacebuilding-Intern_JR1": JSON.stringify({
        jobPostingInfo: {
          id: "x1",
          title: "Peacebuilding Intern",
          jobDescription: "<p>Support peace and conflict programs. Paid internship.</p>",
          location: "Addis Ababa, Ethiopia",
          jobReqId: "JR1",
          externalUrl: "https://acme.wd3.myworkdayjobs.com/Careers/job/Addis-Ababa/Peacebuilding-Intern_JR1",
        },
      }),
    });
    const out = await workdayAdapter.scrape(
      { url: "https://acme.wd3.myworkdayjobs.com/en-US/Careers", orgSlug: "acme", orgName: "Acme" },
      fetcher,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceId).toBe("JR1");
    expect(out[0]!.sourceUrl).toBe(
      "https://acme.wd3.myworkdayjobs.com/Careers/job/Addis-Ababa/Peacebuilding-Intern_JR1",
    );
    expect(out[0]!.isPaid).toBe(true);
    expect(out[0]!.source).toBe("workday:acme");
  });

  it("parses tenant and site from locale URLs", () => {
    expect(workdayAdapter.detect("https://acme.wd1.myworkdayjobs.com/en-US/External")).toBe(true);
    expect(workdayAdapter.detect("https://acme.myworkdayjobs.com/External")).toBe(true);
    expect(workdayAdapter.detect("https://acme.example.com/jobs")).toBe(false);
  });
});

describe("smartrecruiters adapter", () => {
  it("joins jobAd sections and respects remote flag", async () => {
    const fetcher = mockFetcher({
      "/postings/sr1": JSON.stringify({
        id: "sr1",
        name: "Human Rights Intern",
        releasedDate: "2026-05-10T00:00:00Z",
        location: { city: "Addis Ababa", country: "Ethiopia", remote: false },
        postingUrl: "https://jobs.smartrecruiters.com/Acme/sr1",
        jobAd: {
          sections: {
            jobDescription: { title: "About", text: "<p>Monitor human rights cases.</p>" },
            qualifications: { title: "Requirements", text: "<p>Law or IR student.</p>" },
          },
        },
      }),
      "/postings?q=intern": JSON.stringify({
        content: [
          {
            id: "sr1",
            name: "Human Rights Intern",
            location: { city: "Addis Ababa", country: "Ethiopia" },
          },
          { id: "sr2", name: "Sr. Data Scientist", location: { city: "London", country: "UK" } },
        ],
      }),
    });
    const out = await smartrecruitersAdapter.scrape(
      { url: "https://careers.smartrecruiters.com/Acme", orgSlug: "acme" },
      fetcher,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.location).toBe("Addis Ababa, Ethiopia");
    expect(out[0]!.descriptionHtml).toContain("<h3>About</h3>");
    expect(out[0]!.descriptionText).toContain("Law or IR student");
  });
});

describe("reliefweb adapter", () => {
  beforeAll(() => {
    process.env.RELIEFWEB_APPNAME = "test-app";
  });

  it("parses v2 jobs and filters by accessibility", async () => {
    const fetcher = mockFetcher({
      "api.reliefweb.int/v2/jobs": JSON.stringify({
        data: [
          {
            id: "900",
            fields: {
              title: "Protection Internship",
              url: "https://reliefweb.int/job/900",
              "body-html": "<p>Support refugee protection work. Unpaid position.</p>",
              source: [{ name: "Refuge Org", shortname: "RO" }],
              country: [{ name: "Ethiopia" }],
              city: [{ name: "Addis Ababa" }],
              date: { created: "2026-05-01T00:00:00Z", closing: "2026-07-01T00:00:00Z" },
            },
          },
          {
            id: "901",
            fields: {
              title: "Reporting Internship",
              url: "https://reliefweb.int/job/901",
              body: "Geneva-based only.",
              country: [{ name: "Switzerland" }],
            },
          },
        ],
      }),
    });
    const out = await reliefwebAdapter.scrape({ url: "https://reliefweb.int" }, fetcher);
    expect(out).toHaveLength(1);
    expect(out[0]!.orgName).toBe("Refuge Org");
    expect(out[0]!.isPaid).toBe(false);
    expect(out[0]!.deadline?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("idealist adapter", () => {
  it("keeps worldwide-remote + Ethiopia internships via Algolia, drops country-locked/onsite-foreign", async () => {
    const desc = "<p>" + "Support advocacy, civic engagement and human rights programs. ".repeat(3) + "</p>";
    const mk = (id: string, name: string, extra: Record<string, unknown>) => ({
      type: "INTERNSHIP",
      name,
      description: desc,
      url: `/en/nonprofit-internship/${id}`,
      objectID: id,
      orgName: `Org ${id}`,
      ...extra,
    });
    const fetcher = mockFetcher({
      "page=0": JSON.stringify({
        hits: [
          mk("a", "Civic Advocacy Intern", { remoteOk: true }), // worldwide remote → keep
          mk("b", "US-only Remote Intern", { remoteOk: true, remoteCountry: "US" }), // country-locked → drop
          mk("c", "NYC Onsite Intern", { remoteOk: false, country: "US", city: "New York" }), // onsite foreign → drop
          mk("d", "Addis Governance Intern", { remoteOk: false, country: "ET", city: "Addis Ababa" }), // ET onsite → keep
        ],
      }),
      "page=1": JSON.stringify({ hits: [] }),
    });
    const out = await idealistAdapter.scrape(
      { url: "https://www.idealist.org/en/internships" },
      fetcher,
    );
    expect(out.map((l) => l.title).sort()).toEqual(["Addis Governance Intern", "Civic Advocacy Intern"]);
    const remote = out.find((l) => l.title === "Civic Advocacy Intern")!;
    expect(remote.location).toBe("Remote");
    expect(remote.isRemote).toBe(true);
    expect(remote.source).toBe("idealist");
    expect(remote.sourceUrl).toBe("https://www.idealist.org/en/nonprofit-internship/a");
    expect(out.find((l) => l.title === "Addis Governance Intern")!.location).toBe("Addis Ababa, Ethiopia");
  });
});

describe("successfactors (au.int) adapter", () => {
  it("reads the robots-allowed feed, keeps Addis internships only", async () => {
    const desc = (s: string) =>
      `<![CDATA[<div><h2>Organization Information</h2><p>${s} ${"Supporting the work of the commission across the continent. ".repeat(3)}</p></div>]]>`;
    const fetcher = mockFetcher({
      "/sitemap_index.xml": `<?xml version="1.0"?><rss version="2.0"><channel>
        <item>
          <title>Internship Program (Addis Ababa, Ethiopia)</title>
          <link>https://jobs.au.int/job/Addis-Ababa-Internship-Program/765006702/?feedId=x</link>
          <description>${desc("The African Union internship supports governance and policy research.")}</description>
        </item>
        <item>
          <title>Principal Officer - Trade in Services (Accra, Ghana)</title>
          <link>https://jobs.au.int/job/Accra-Principal-Officer/1364/</link>
          <description>${desc("Senior trade policy role.")}</description>
        </item>
        <item>
          <title>Communications Intern (Nairobi, Kenya)</title>
          <link>https://jobs.au.int/job/Nairobi-Communications-Intern/999/</link>
          <description>${desc("Media outreach internship based in Nairobi.")}</description>
        </item>
      </channel></rss>`,
    });
    const out = await successfactorsAdapter.scrape(
      { url: "https://jobs.au.int", orgSlug: "au", orgName: "African Union Commission" },
      fetcher,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Internship Program");
    expect(out[0]!.location).toBe("Addis Ababa, Ethiopia");
    expect(out[0]!.source).toBe("successfactors:jobs.au.int");
    // query string stripped, numeric id captured
    expect(out[0]!.sourceUrl).toBe("https://jobs.au.int/job/Addis-Ababa-Internship-Program/765006702/");
    expect(out[0]!.sourceId).toBe("765006702");
    expect(out[0]!.orgName).toBe("African Union Commission");
  });
});

describe("inspira (un-careers) adapter", () => {
  it("keeps Addis internships, drops foreign ones despite remote/travel boilerplate", async () => {
    const fetcher = mockFetcher({
      "activeJo": JSON.stringify({
        data: [
          {
            jobId: 100,
            categoryCode: "INT",
            postingTitle: "Governance Affairs Intern",
            jobTitle: "Intern",
            jobDescription: "<p>Support governance and policy research.</p>",
            dutyStation: [{ description: "ADDIS ABABA" }],
            startDate: "2026-05-01",
            endDate: "2026-08-01T03:59:59.000Z",
            dept: "Economic Commission for Africa (ECA)",
          },
          {
            // Foreign duty station, but the description is the kind of UN
            // boilerplate that used to false-positive as Ethiopia-accessible.
            jobId: 101,
            categoryCode: "INT",
            postingTitle: "Public Information Intern",
            jobTitle: "Intern",
            jobDescription:
              "<p>New York based. Interns may work remotely; travel and accommodation can be covered.</p>",
            dutyStation: [{ description: "NEW YORK" }],
            endDate: "2026-08-01T03:59:59.000Z",
            dept: "DGC",
          },
          {
            jobId: 102,
            categoryCode: "JOB", // not an internship
            postingTitle: "Senior Political Affairs Officer",
            jobTitle: "Officer",
            jobDescription: "<p>Addis Ababa.</p>",
            dutyStation: [{ description: "ADDIS ABABA" }],
            endDate: "2026-08-01T03:59:59.000Z",
          },
          {
            // Home-based / remote → globally accessible (the remote slice).
            jobId: 103,
            categoryCode: "INT",
            postingTitle: "Human Rights Research Intern",
            jobTitle: "Intern",
            jobDescription: "<p>Support human rights monitoring.</p>",
            dutyStation: [{ description: "Home-based" }],
            endDate: "2026-08-01T03:59:59.000Z",
          },
        ],
      }),
    });
    const out = await inspiraAdapter.scrape(
      { url: "https://careers.un.org", orgSlug: "un-careers", orgName: "UN Careers" },
      fetcher,
    );
    // Addis + Home-based kept; New York dropped; non-INT dropped.
    expect(out.map((l) => l.title).sort()).toEqual([
      "Governance Affairs Intern",
      "Human Rights Research Intern",
    ]);
    expect(out.find((l) => l.title === "Governance Affairs Intern")!.location).toBe("ADDIS ABABA");
  });
});

describe("wordpress adapter", () => {
  it("keeps single-org posts, drops roundups and non-internships", async () => {
    const post = (id: number, title: string, content: string, link: string) => ({
      id,
      link,
      date: "2026-05-20T08:00:00",
      title: { rendered: title },
      content: { rendered: content },
    });
    const fetcher = mockFetcher({
      "/wp-json/wp/v2/posts": JSON.stringify([
        post(
          1,
          "Internship at Hope &amp; Justice Foundation",
          "<p>Location: Addis Ababa, Ethiopia Organization: Hope &amp; Justice Foundation Deadline: June 30, 2026</p><p>Support governance advocacy programs across the region.</p>",
          "https://opportunitydesk.org/intern-1/",
        ),
        post(2, "30 Jobs, Internships and Volunteer Roles", "<p>Many things.</p>", "https://opportunitydesk.org/roundup/"),
        post(3, "Scholarship at Example University", "<p>Not an internship.</p>", "https://opportunitydesk.org/scholarship/"),
      ]),
    });
    const out = await wordpressAdapter.scrape(
      { url: "https://opportunitydesk.org/", orgName: "Opportunity Desk" },
      fetcher,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Internship at Hope & Justice Foundation");
    expect(out[0]!.orgName).toBe("Hope & Justice Foundation");
    expect(out[0]!.location).toBe("Addis Ababa, Ethiopia");
    expect(out[0]!.deadline?.getUTCFullYear()).toBe(2026);
    expect(out[0]!.source).toBe("wordpress:opportunitydesk.org");
  });
});

describe("generic-html adapter", () => {
  it("crawls internship links and parses detail heuristically", async () => {
    const filler = "Interns support research, drafting, and stakeholder mapping. ".repeat(8);
    const fetcher = mockFetcher({
      "/vacancies/governance-intern": `<html><body>
        <nav>Menu Internship link noise</nav>
        <h1>Governance Internship</h1>
        <article>
          <p>Location: Addis Ababa, Ethiopia</p>
          <p>Deadline: 15 July 2026</p>
          <p>${filler}</p>
        </article>
        <footer>footer</footer>
      </body></html>`,
      "example-ngo.org/vacancies": `<html><body>
        <a href="/vacancies/governance-intern">Governance Internship</a>
        <a href="/vacancies/driver">Driver</a>
        <a href="https://other-site.com/internship">External Internship</a>
        <a href="#">Internship anchor</a>
      </body></html>`,
    });
    const out = await genericHtmlAdapter.scrape(
      { url: "https://example-ngo.org/vacancies", orgSlug: "example-ngo", orgName: "Example NGO" },
      fetcher,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Governance Internship");
    expect(out[0]!.sourceUrl).toBe("https://example-ngo.org/vacancies/governance-intern");
    expect(out[0]!.location).toBe("Addis Ababa, Ethiopia");
    expect(out[0]!.deadline?.getUTCMonth()).toBe(6);
    expect(out[0]!.orgName).toBe("Example NGO");
    expect(out[0]!.descriptionText).not.toContain("footer");
  });

  it("scopes Drupal pages: strips skip-link/breadcrumb/menu/footer, parses fields", async () => {
    // The exact shape UNECA/cardeth serve: posting body buried in a Drupal node
    // region, wrapped in skip-link + "You are here" breadcrumb + menus + footer,
    // with Location and Deadline in adjacent <div>s (no whitespace between them).
    const filler = "Supporting policy research and analysis across governance portfolios. ".repeat(6);
    const fetcher = mockFetcher({
      "/jobs/governance-affairs-intern": `<html><head>
        <meta property="og:title" content="Governance Affairs Internship">
        </head><body>
        <a class="skip-link" href="#main-content">Skip to main content</a>
        <header class="region-header"><nav class="menu"><ul><li>Home</li><li>About Us</li><li>Contact</li></ul></nav></header>
        <nav class="breadcrumb"><h2 class="visually-hidden">You are here</h2><ol><li>Home</li><li>Jobs</li></ol></nav>
        <main role="main"><article class="node__content">
          <h1>Governance Affairs Internship</h1>
          <div class="field--name-body">
            <div>Location: Addis Ababa, Ethiopia</div>
            <div>Deadline Date: Wednesday, October 4, 2023</div>
            <p>The intern will support the governance and public administration team. ${filler}</p>
            <p>Interns receive a monthly stipend of $1,500 per month to partially cover living costs.</p>
          </div>
        </article></main>
        <footer class="region-footer">© 2023 United Nations Economic Commission for Africa. Home About Us Privacy</footer>
        </body></html>`,
      "uneca.org/vacancies": `<html><body>
        <a href="/jobs/governance-affairs-intern">Governance Affairs Internship</a>
      </body></html>`,
    });
    const out = await genericHtmlAdapter.scrape(
      { url: "https://uneca.org/vacancies", orgSlug: "uneca", orgName: "UN Economic Commission for Africa" },
      fetcher,
    );
    expect(out).toHaveLength(1);
    const row = out[0]!;
    // Structured fields parsed, not dumped.
    expect(row.title).toBe("Governance Affairs Internship");
    expect(row.location).toBe("Addis Ababa, Ethiopia");
    expect(row.deadline?.getUTCFullYear()).toBe(2023);
    expect(row.deadline?.getUTCMonth()).toBe(9);
    expect(row.isPaid).toBe(true);
    expect(row.stipendText).toContain("$1,500");
    expect(row.orgName).toBe("UN Economic Commission for Africa");
    // Chrome stripped from the reader-mode text.
    expect(row.descriptionText).not.toMatch(/Skip to main content/i);
    expect(row.descriptionText).not.toMatch(/You are here/i);
    expect(row.descriptionText).not.toMatch(/About Us/i);
    expect(row.descriptionText).not.toContain("©");
    // Body retained.
    expect(row.descriptionText).toContain("governance and public administration");
    // raw carries the scoped container for re-extraction without a re-fetch.
    expect((row.raw as { containerHtml?: string }).containerHtml).toContain("field--name-body");
  });

  it("throws BrowserChallengeError on interstitials", async () => {
    const fetcher = mockFetcher({
      "blocked.example.com": "<html><head><title>Just a moment...</title></head></html>",
    });
    await expect(
      genericHtmlAdapter.scrape({ url: "https://blocked.example.com/jobs" }, fetcher),
    ).rejects.toThrow(/browser challenge/);
  });
});

describe("text-extract", () => {
  it("extracts labelled top-of-body fields", () => {
    const meta = extractTopMeta(
      "Location: Remote Organization: AfricaNenda Foundation Deadline: May 29, 2026 Job Description: …",
    );
    expect(meta.location).toBe("Remote");
    expect(meta.organization).toBe("AfricaNenda Foundation");
    expect(meta.deadline).toBe("May 29, 2026");
  });

  it("stops label values at Related Articles widgets", () => {
    const meta = extractTopMeta("Location: Ethiopia Related Articles Some Other Post 11 hours ago");
    expect(meta.location).toBe("Ethiopia");
  });

  it("stops the location value before a 'Deadline Date' label", () => {
    // Previously ran straight through "Deadline Date" into the page footer.
    const meta = extractTopMeta(
      "Location: Addis Ababa Deadline Date: Wednesday, October 4, 2023 Job Description: …",
    );
    expect(meta.location).toBe("Addis Ababa");
    expect(meta.deadline).toContain("October 4, 2023");
  });

  it("stops Duty Station before a UN 'Department/Office' label", () => {
    // ECA reposts on ethiongojobs: location bled into the next labelled field.
    const meta = extractTopMeta(
      "Duty Station: Addis Ababa Department/Office: Economic Commission for Africa (ECA) Deadline: Jul 1, 2026",
    );
    expect(meta.dutyStation).toBe("Addis Ababa");
  });

  it("extracts a stipend figure, or null for prose", () => {
    expect(extractStipend("A monthly stipend of $1,500 per month is provided")).toContain("$1,500");
    expect(extractStipend("Interns receive ETB 5,000 monthly")).toMatch(/ETB\s?5,000/i);
    expect(extractStipend("interns are paid $1,200")).toContain("$1,200");
    // Prose / no figure / unrelated amounts → null (never invent a value).
    expect(
      extractStipend("allowance (MSA), which is a monetary stipend to partially cover costs"),
    ).toBeNull();
    expect(extractStipend("Remuneration is per the UN salary scale")).toBeNull();
    expect(extractStipend("A travel cap of $200 applies for fieldwork")).toBeNull();
    expect(extractStipend("The deadline is October 4, 2023")).toBeNull();
  });

  it("parses assorted deadline formats", () => {
    expect(parseDeadline("May 29, 2026")?.getUTCFullYear()).toBe(2026);
    expect(parseDeadline("29 May 2026")?.getUTCFullYear()).toBe(2026);
    expect(parseDeadline("2026-05-29")?.getUTCFullYear()).toBe(2026);
    expect(parseDeadline("June 13, 2026, 5:00 PM (East Africa Time)")?.getUTCFullYear()).toBe(2026);
    expect(parseDeadline("rolling basis")).toBeNull();
  });

  it("reads the UN 'Deadline Date:' format with a weekday prefix", () => {
    // The exact shape UNECA serves — previously parsed to null → shown forever.
    expect(
      findDeadlineInText("Deadline Date: Tuesday, January 4, 2022 © United Nations")?.getUTCFullYear(),
    ).toBe(2022);
    expect(
      findDeadlineInText("Deadline Date: Wednesday, October 4, 2023")?.getUTCMonth(),
    ).toBe(9);
    expect(findDeadlineInText("Apply by 15 July 2026")?.getUTCFullYear()).toBe(2026);
    expect(extractTopMeta("Deadline Date: Friday, December 30, 2022 Job Description: …").deadline).toContain(
      "December 30, 2022",
    );
    expect(findDeadlineInText("No date here at all")).toBeNull();
  });

  it("reads unlabelled deadlines from the application instructions", () => {
    // CARD's real shape: no "Deadline:" label, the date lives in a sentence.
    expect(
      findDeadlineInText(
        "Please send your application to apply@org.org by 25 October 2024. Female candidates encouraged.",
      )?.getUTCFullYear(),
    ).toBe(2024);
    expect(
      findDeadlineInText("Applications must be received no later than 4 January 2026.")?.getUTCMonth(),
    ).toBe(0);
    // "by <date>" with no application context is NOT a deadline.
    expect(findDeadlineInText("By March 2025 the project will conclude its first phase.")).toBeNull();
  });

  it("parses ordinal-suffixed dates (1st/2nd/3rd/Nth)", () => {
    // EHRDC's real shape — previously parsed to null, so a 2022 posting showed
    // as active forever.
    expect(parseDeadline("November 2nd, 2022")?.getUTCFullYear()).toBe(2022);
    expect(parseDeadline("21st June 2025")?.getUTCFullYear()).toBe(2025);
    expect(parseDeadline("March 3rd, 2026")?.getUTCMonth()).toBe(2);
    expect(
      findDeadlineInText(
        "Interested applicants need to submit their CVs, before November 2nd, 2022 via email",
      )?.getUTCFullYear(),
    ).toBe(2022);
  });
});
