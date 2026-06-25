// Shared text heuristics for prose-style sources (WordPress blogs, generic
// HTML pages) where structured fields only exist as labelled lines in the
// body, e.g. "Location: Remote Organization: Foo Deadline: May 29, 2026".

import { collapse } from "./html.js";

export type TopMeta = {
  location?: string;
  organization?: string;
  deadline?: string;
  closingDate?: string;
  department?: string;
  dutyStation?: string;
  workLocation?: string;
};

export function extractTopMeta(text: string): TopMeta {
  const head = text.slice(0, 600);
  const grab = (label: RegExp) => {
    const m = label.exec(head);
    if (!m) return undefined;
    const rest = head.slice(m.index + m[0].length);
    // Stop at the next labelled field, a block boundary (newline), or a footer
    // marker — whichever comes first. The newline stop matters most: bodies are
    // block-separated, so a labelled line like "Location: Addis Ababa" ends at
    // its own newline rather than running into the next paragraph of prose.
    // Labels allow internal whitespace, and "Deadline Date" is listed explicitly
    // — without it "Addis Ababa Deadline Date: …" never stops.
    const labelStop = rest.search(
      /\s+(?:Location|Work\s+Location|Duty\s+Station|Organization|Organisation|Department(?:\s*\/\s*Office)?|Deadline(?:\s+Date)?|Closing\s+Date|Application\s+Deadline|Apply\s+By|Posting\s+Title|Job\s+(?:Description|Opening|Schedule|ID|Code|Network|Family)|Expected\s+duration|Duration|Hours|Engagement|About|Categories|Category|Grade|Level|Posted|Eligibility|Type\s+of\s+Contract)\s*:|\s+Related\s+Articles\b|\s+©/i,
    );
    const nlStop = rest.indexOf("\n");
    const candidates = [labelStop, nlStop].filter((i) => i !== -1);
    const stop = candidates.length ? Math.min(...candidates) : -1;
    const value = (stop === -1 ? rest : rest.slice(0, stop)).trim();
    return value ? collapse(value).replace(/[.;]+$/, "") : undefined;
  };
  return {
    location: grab(/\bLocation\s*:/i),
    workLocation: grab(/\bWork Location\s*:/i),
    dutyStation: grab(/\bDuty Station\s*:/i),
    organization: grab(/\bOrganization\s*:|\bOrganisation\s*:/i),
    department: grab(/\bDepartment\s*:/i),
    deadline: grab(/\bDeadline(?:\s+Date)?\s*:/i),
    closingDate: grab(/\bClosing Date\s*:/i),
  };
}

export function parseDeadline(raw: string | undefined): Date | null {
  if (!raw) return null;
  // Common forms: "May 29, 2026", "29 May 2026", "29/05/2026", "2026-05-29".
  const cleaned = raw
    .replace(/\s+\([^)]*\)\s*$/g, "")
    .replace(/,\s*\d{1,2}:\d{2}\s*(AM|PM)\b/i, "")
    .replace(/\s+at\s+\d{1,2}:\d{2}\s*(AM|PM)?\b/i, "")
    // Strip ordinal suffixes so Date can parse them: "November 2nd, 2022" → "2".
    .replace(/(\d{1,2})(?:st|nd|rd|th)\b/gi, "$1")
    .replace(/[.,;]+$/g, "")
    .trim();
  const embedded = /([A-Za-z]+ \d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}-\d{1,2}-\d{1,2})/.exec(
    cleaned,
  );
  if (embedded && embedded[1] !== cleaned) {
    return parseDeadline(embedded[1]);
  }
  const direct = new Date(cleaned);
  if (!isNaN(direct.getTime())) return direct;
  // Try day-month-year.
  const m = /^(\d{1,2})[\s\/\-](\w+|\d{1,2})[\s\/\-](\d{2,4})$/.exec(cleaned);
  if (m) {
    const guess = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
    if (!isNaN(guess.getTime())) return guess;
  }
  return null;
}

// One date in any of the common forms: "January 4, 2022", "November 2nd, 2022",
// "4 January 2022", "21st June 2025", "2022-01-04", "04/01/2022". The optional
// (st|nd|rd|th) ordinal matters — a bare day number like "2nd" otherwise breaks
// the match and the deadline slips through as null (stale 2022 posting → shows
// as active forever).
const DATE_TOKEN =
  /([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s*\d{4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})/;

export function findDeadlineInText(text: string): Date | null {
  // 1) Anchor on a deadline label, then take the first date within ~80 chars.
  // Tolerates "Deadline Date:", a weekday prefix ("Tuesday, …"), "by", etc.,
  // which the old immediate-adjacency regex couldn't read.
  const label =
    /(?:Deadline(?:\s+Date)?|Closing\s+Date|Apply\s+by|Application\s+Deadline|Applications?\s+(?:close|due|deadline))\b/i.exec(
      text,
    );
  if (label) {
    const m = DATE_TOKEN.exec(text.slice(label.index, label.index + 80));
    if (m) return parseDeadline(m[1]);
  }

  // 2) Unambiguous deadline phrasing, date immediately after.
  const strong = new RegExp(
    String.raw`(?:no(?:t)?\s+later\s+than|on\s+or\s+before)\s+(?:${DATE_TOKEN.source})`,
    "i",
  ).exec(text);
  if (strong) return parseDeadline(strong[1]);

  // 3) Weak "… by/before <date>" (e.g. "send your application … by 25 October
  // 2024") — only trusted when the body actually talks about applying, so a
  // stray "by March 2025 the project will …" can't masquerade as a deadline.
  if (/\b(appl(?:y|ication|ications|icants)|submit|submission|send\s+your|received\s+by)\b/i.test(text)) {
    const weak = new RegExp(String.raw`\b(?:by|before)\s+(?:${DATE_TOKEN.source})`, "i").exec(text);
    if (weak) return parseDeadline(weak[1]);
  }
  return null;
}

export function detectPaid(titleLower: string, lowerText: string): boolean | null {
  // CLAUDE.md: null when unclear; never invent.
  const head = `${titleLower}\n${lowerText.slice(0, 1500)}`;
  if (/\bunpaid\b|not remunerated/.test(head)) return false;
  if (/\bpaid\b|\bstipend\b|\bmonthly\s+allowance\b/.test(head)) return true;
  return null;
}

// Compensation as an actual figure ("$1,500 per month", "ETB 5,000 monthly"),
// or null. Prose like "salary scale" or "a monetary stipend to cover costs"
// carries no number → null; we never invent a value (CLAUDE.md: is_paid/stipend
// stay empty when unclear). is_paid is set separately by detectPaid, so a paid
// role with no published figure correctly yields is_paid=true + stipend=null.
const CURRENCY = String.raw`(?:US\$|USD|\$|€|EUR|£|GBP|ETB|Birr|KES|Ksh|NGN)`;
const AMOUNT = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const PERIOD = String.raw`(?:\s*(?:per|\/|a)\s*(?:month|mo|annum|year|yr|week|day)|\s*(?:monthly|weekly|daily|annually|p\.?a\.?|pcm))`;
const STIPEND_VALUE = new RegExp(
  `(?:${CURRENCY}\\s?${AMOUNT}|${AMOUNT}\\s?(?:USD|EUR|GBP|ETB|Birr|KES|Ksh|NGN))` +
    `(?:\\s*(?:[-–—]|to)\\s*(?:${CURRENCY}\\s?)?${AMOUNT})?` +
    `(?:${PERIOD})?`,
  "i",
);
const STIPEND_CONTEXT =
  /stipend|allowance|salar|remunerat|honorar|compensat|wage|paid|payment|per\s+month|monthly|gross|net\s+pay/i;

export function extractStipend(text: string): string | null {
  const m = STIPEND_VALUE.exec(text);
  if (!m) return null;
  // Require compensation context near the figure so we don't grab "$200 travel
  // cap", "5 years", or a phone number that happens to look monetary.
  const near = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 40);
  if (!STIPEND_CONTEXT.test(near)) return null;
  return collapse(m[0]).replace(/[\s.,;:–—-]+$/, "");
}

export function orgFromTitle(title: string): string | null {
  // "Internship at FooBar Foundation" → "FooBar Foundation"
  const m = /\bat\s+(.{2,80})$/i.exec(title);
  return m ? m[1]!.replace(/[.,;]+$/, "").trim() : null;
}
