import { describe, expect, it } from "vitest";
import { cleanDescriptionHtml, htmlToText } from "../html.js";
import { ethiopiaAccess, isEthiopiaAccessible, isInternship, isRoundup } from "../filter.js";

describe("isRoundup — exclude digest/aggregator posts", () => {
  const yes = [
    "10 Job and Internship opportunities at CECOE",
    "Job vacancies at Plan International, Ethiopia",
    "Job opportunities at WaterAid International, Ethiopia",
    "5 Vacancies at the Ministry of Peace",
  ];
  const no = [
    "Internship: Human Resources Intern",
    "Internship Opportunity: Procurement and Logistics Intern",
    "Governance Internship at Hope Foundation",
    "Internship – Operations Assistant (4 Required)",
  ];
  for (const t of yes) it(`flags "${t}"`, () => expect(isRoundup(t)).toBe(true));
  for (const t of no) it(`keeps "${t}"`, () => expect(isRoundup(t)).toBe(false));
});
import { clusterDuplicates, normalizeTitle, type DedupItem } from "../dedup.js";
import { verify } from "../llm-extract.js";

describe("llm-extract verify — evidence guard (never invent)", () => {
  const text =
    "The internship runs for six months. Interested applicants should apply before November 2, 2026. This is an unpaid position.";

  it("keeps deadline + paid when the quote is found verbatim in the posting", () => {
    const g = verify(
      {
        deadline_iso: "2026-11-02",
        deadline_evidence: "apply before November 2, 2026",
        is_paid: "unpaid",
        pay_evidence: "This is an unpaid position",
      },
      text,
    );
    expect(g.deadline?.getUTCFullYear()).toBe(2026);
    expect(g.isPaid).toBe(false);
  });

  it("rejects values whose quote is NOT in the posting (hallucinated)", () => {
    const g = verify(
      {
        deadline_iso: "2025-01-15",
        deadline_evidence: "applications close January 15, 2025",
        is_paid: "paid",
        pay_evidence: "a monthly stipend of $2000 is provided",
      },
      text,
    );
    expect(g.deadline).toBeNull();
    expect(g.isPaid).toBeNull();
  });

  it("returns null for unclear pay and unstated deadline", () => {
    expect(verify({ deadline_iso: "", deadline_evidence: "", is_paid: "unclear", pay_evidence: "" }, text)).toEqual({
      deadline: null,
      isPaid: null,
    });
  });
});

describe("dedup — cross-source duplicate collapse", () => {
  it("normalizes titles across source quirks", () => {
    expect(normalizeTitle("Internship: Human Resources Intern")).toBe("human resources");
    expect(normalizeTitle("Human Resources Intern")).toBe("human resources");
    expect(normalizeTitle("(MEL and Communication Intern)")).toBe("mel and communication");
    expect(normalizeTitle("IT Support Internship (5 Required)")).toBe("it support");
    // doesn't eat words that merely contain "intern"
    expect(normalizeTitle("Internal Audit Intern")).toBe("internal audit");
  });

  const item = (over: Partial<DedupItem> & { id: string }): DedupItem => ({
    title: "Human Resources Intern",
    location: "Addis Ababa",
    descriptionText: "support the human resources unit with recruitment onboarding and staff records",
    sourceUrl: `https://example.org/${over.id}`,
    ...over,
  });

  it("clusters the same job across sources, leaves distinct jobs alone", () => {
    const ecaA = item({ id: "ej", title: "Internship: Human Resources Intern", sourceUrl: "https://ethiongojobs.com/a", descriptionText: "support the human resources unit with recruitment onboarding and staff records management" });
    const ecaB = item({ id: "un", title: "Human Resources Intern", location: "ADDIS ABABA", sourceUrl: "https://careers.un.org/b", descriptionText: "support the human resources unit with recruitment onboarding and staff records" });
    // same normalized title + location, but a totally different job (low overlap)
    const other = item({ id: "x", descriptionText: "draft policy briefs on peace and security and electoral governance across the region" });

    const clusters = clusterDuplicates([ecaA, ecaB, other]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
    // canonical = the longer description (ethiongojobs here)
    expect(clusters[0]![0]!.id).toBe("ej");
    expect(clusters[0]!.map((c) => c.id).sort()).toEqual(["ej", "un"]);
  });

  it("does not merge same-title jobs in different cities", () => {
    const addis = item({ id: "a", title: "Communications Intern", location: "Addis Ababa" });
    const nairobi = item({ id: "n", title: "Communications Intern", location: "Nairobi" });
    expect(clusterDuplicates([addis, nairobi])).toHaveLength(0);
  });
});

describe("htmlToText — block boundaries survive", () => {
  it("keeps adjacent block fields from fusing", () => {
    // The bug: .text() concatenates across <div>s → "Addis AbabaDeadline".
    const text = htmlToText(
      "<div>Location: Addis Ababa</div><div>Deadline Date: Wednesday, October 4, 2023</div>",
    );
    expect(text).not.toContain("AbabaDeadline");
    expect(text).toMatch(/Addis Ababa\s+Deadline Date/);
  });

  it("separates table cells and drops script/style", () => {
    const text = htmlToText(
      "<table><tr><td>Stipend</td><td>$500</td></tr></table><script>x()</script><p>Apply now</p>",
    );
    expect(text).toMatch(/Stipend\s+\$500/);
    expect(text).not.toContain("x()");
    expect(text).toContain("Apply now");
  });
});

describe("cleanDescriptionHtml — rich, safe preservation", () => {
  it("keeps table structure", () => {
    const out = cleanDescriptionHtml(
      "<table><thead><tr><th>Role</th><th>Stipend</th></tr></thead>" +
        "<tbody><tr><td>Intern</td><td>$500</td></tr></tbody></table>",
    );
    expect(out).toContain("<table>");
    expect(out).toContain("<th>Role</th>");
    expect(out).toContain("<td>Intern</td>");
  });

  it("keeps definition lists, hr, sub/sup, blockquote, code", () => {
    const out = cleanDescriptionHtml(
      "<dl><dt>Location</dt><dd>Addis Ababa</dd></dl><hr>" +
        "<p>H<sub>2</sub>O and x<sup>2</sup></p><blockquote>Quote</blockquote><p><code>apply()</code></p>",
    );
    expect(out).toContain("<dt>Location</dt>");
    expect(out).toContain("<dd>Addis Ababa</dd>");
    expect(out).toContain("<hr>");
    expect(out).toContain("<sub>2</sub>");
    expect(out).toContain("<sup>2</sup>");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("<code>apply()</code>");
  });

  it("keeps images with resolved src + alt, drops dimensions and handlers", () => {
    const out = cleanDescriptionHtml(
      '<img src="/banner.png" alt="Banner" width="600" height="200" onerror="x()" class="hero">',
      { resolveUrl: (h) => new URL(h, "https://org.example").href },
    );
    expect(out).toContain('src="https://org.example/banner.png"');
    expect(out).toContain('alt="Banner"');
    expect(out).not.toContain("width");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("class");
  });

  it("drops images without a usable src and tracking pixels", () => {
    expect(cleanDescriptionHtml('<p>a</p><img alt="x">')).not.toContain("<img");
    expect(cleanDescriptionHtml('<p>a</p><img src="data:image/png;base64,zzz">')).not.toContain(
      "<img",
    );
    // 1x1 pixel and an empty-alt tracking gif.
    expect(
      cleanDescriptionHtml('<p>a</p><img src="https://t.io/p.png" width="1" height="1">'),
    ).not.toContain("<img");
    expect(cleanDescriptionHtml('<p>a</p><img src="https://t.io/x.gif?id=9" alt="">')).not.toContain(
      "<img",
    );
    // a real captioned image survives.
    expect(
      cleanDescriptionHtml('<img src="https://org.et/banner.jpg" alt="Programme banner">'),
    ).toContain("<img");
  });

  it("strips scripts, styles, iframes, ad <ins>, and comments", () => {
    const out = cleanDescriptionHtml(
      "<p>Real</p><script>alert(1)</script><style>.x{}</style>" +
        '<iframe src="x"></iframe><ins class="adsbygoogle"></ins><!-- ad -->',
    );
    expect(out).toBe("<p>Real</p>");
  });

  it("unwraps layout containers but keeps their text", () => {
    const out = cleanDescriptionHtml("<div><span>Hello</span> world</div>");
    expect(out).not.toContain("<div");
    expect(out).not.toContain("<span");
    expect(out).toContain("Hello world");
  });

  it("strips class/style/id/event attributes on allowed tags", () => {
    const out = cleanDescriptionHtml(
      '<p class="lead" style="color:red" id="p1" onclick="x()">Text</p>',
    );
    expect(out).toBe("<p>Text</p>");
  });

  it("rewrites real links and neutralizes dangerous ones", () => {
    const resolveUrl = (h: string) => new URL(h, "https://org.example").href;
    const web = cleanDescriptionHtml('<a href="/apply" onclick="x()">Apply</a>', { resolveUrl });
    expect(web).toContain('href="https://org.example/apply"');
    expect(web).toContain('target="_blank"');
    expect(web).toContain('rel="noopener noreferrer"');
    expect(web).not.toContain("onclick");

    const mail = cleanDescriptionHtml('<a href="mailto:jobs@org.org">Email</a>');
    expect(mail).toContain('href="mailto:jobs@org.org"');
    expect(mail).not.toContain("target=");

    const js = cleanDescriptionHtml('<a href="javascript:alert(1)">x</a>');
    expect(js).toBe("x");
  });

  it("promotes h1 to h2 and removes empty blocks", () => {
    const out = cleanDescriptionHtml("<h1>Title</h1><p></p><p>Body</p>");
    expect(out).toContain("<h2>Title</h2>");
    expect(out).not.toContain("<h1");
    expect(out).toBe("<h2>Title</h2><p>Body</p>");
  });
});

describe("isInternship — internships only", () => {
  const yes = [
    "Governance Policy Intern",
    "Human Rights Internship",
    "Internship Programme 2026",
    "EU Blue Book Traineeship",
    "Communications Officer (Internship)",
    "Research Intern - Peace and Security",
  ];
  const no = [
    "Internship Coordinator",
    "Internship Programme Manager",
    "Intern Supervisor",
    "Communications Fellowship",
    "Management Trainee",
    "Internal Auditor",
    "Senior Accountant",
    "Programme Officer",
  ];
  for (const t of yes) it(`keeps "${t}"`, () => expect(isInternship(t)).toBe(true));
  for (const t of no) it(`drops "${t}"`, () => expect(isInternship(t)).toBe(false));
});

describe("ethiopiaAccess — only realistically reachable roles", () => {
  const accessible: Array<[string, Parameters<typeof ethiopiaAccess>[0]]> = [
    ["Ethiopia duty station", { location: "Addis Ababa, Ethiopia" }],
    ["Remote location field", { location: "Remote" }],
    ["Remote modality in text", { descriptionText: "This is a fully remote internship." }],
    [
      "Abroad but sponsored",
      {
        location: "Brussels, Belgium",
        descriptionText: "Visa support and relocation assistance provided.",
      },
    ],
  ];
  const blocked: Array<[string, Parameters<typeof ethiopiaAccess>[0]]> = [
    ["NYC in-person", { location: "New York, USA", descriptionText: "On-site, full-time." }],
    ["Geneva in-person", { location: "Geneva, Switzerland" }],
    [
      "Remote-as-geography only",
      { location: "Nairobi, Kenya", descriptionText: "Serving remote rural communities." },
    ],
    [
      "Negated remote",
      { location: "London, UK", descriptionText: "This is not a remote position." },
    ],
    [
      "Foreign work authorization required",
      { descriptionText: "Applicants must be authorized to work in the United States." },
    ],
    ["No signal at all", { descriptionText: "A great opportunity to grow." }],
    [
      "Visa support letter is not sponsorship",
      {
        descriptionText:
          "We do not cover the cost of travel or visas; however, the office can prepare a visa support letter.",
      },
    ],
    [
      "'Fully funded' programme is not relocation support",
      {
        location: "Washington, DC",
        descriptionText: "Dedicated to fully funded summer internships for exceptional students.",
      },
    ],
    [
      "Partial-percentage remote anchored abroad is hybrid, not remote",
      {
        location: "Switzerland",
        descriptionText:
          "Based in Geneva. Up to 40% of remote work on a weekly basis after the first 3 months.",
      },
    ],
    [
      "Hybrid arrangement abroad is not remote",
      { location: "Nairobi, Kenya", descriptionText: "This is a hybrid remote role." },
    ],
    [
      "Accommodation alone is not travel sponsorship",
      {
        location: "India",
        descriptionText:
          "Stipend of 2000 Rupees per month. 2 meals a day, 6 days a week, and basic accommodation provided.",
      },
    ],
  ];

  for (const [name, parts] of accessible) {
    it(`keeps: ${name}`, () => expect(isEthiopiaAccessible(parts)).toBe(true));
  }
  for (const [name, parts] of blocked) {
    it(`blocks: ${name}`, () => expect(isEthiopiaAccessible(parts)).toBe(false));
  }

  it("labels the access category", () => {
    expect(ethiopiaAccess({ location: "Addis Ababa" }).category).toBe("ethiopia");
    expect(ethiopiaAccess({ location: "Remote" }).category).toBe("remote");
    expect(ethiopiaAccess({ location: "New York" }).category).toBe("elsewhere");
    expect(
      ethiopiaAccess({ descriptionText: "must be authorized to work in the EU" }).category,
    ).toBe("restricted");
  });
});
