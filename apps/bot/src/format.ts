import type { Listing } from "@internit/db";

export function daysUntil(deadline: Date | null): number | null {
  if (!deadline) return null;
  return Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
}

// Telegram HTML parse mode — far less escaping than MarkdownV2. `"` matters
// too: these strings also go inside href="..." attributes.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstSentences(text: string, n: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return clean.slice(0, 200);
  return sentences.slice(0, n).join(" ").trim().slice(0, 280);
}

// Fields the caption reads from the Gemini structurer's output at
// raw.structured.data. Loosely typed on purpose — raw is jsonb.
type StructuredCaption = { summary?: unknown; application_url?: unknown };
function structuredData(l: Listing): StructuredCaption | null {
  const data = (l.raw as { structured?: { data?: unknown } } | null)?.structured?.data;
  return data && typeof data === "object" ? (data as StructuredCaption) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Channel caption. The card image already carries org, title, deadline pill,
// fit, location and tags, so the caption stays lean: it adds the one-line
// summary, a human deadline, and the apply/read/source links — no duplication.
// Restrained, English (CLAUDE.md). Kept well under Telegram's 1024-char photo
// caption limit.
export function formatChannelPost(l: Listing, siteUrl: string): string {
  const e = escapeHtml;
  const s = structuredData(l);
  // Cap scraped fields before formatting (never truncate the final HTML — that
  // can cut mid-tag). Telegram photo captions hard-fail past 1024 chars, and a
  // failed post would otherwise clog the broadcast queue.
  const lines: string[] = [`<b>${e(l.orgName.slice(0, 120))}</b>`, e(l.title.slice(0, 200)), ""];

  const summary = (str(s?.summary) ?? firstSentences(l.descriptionText, 2)).slice(0, 300);
  if (summary) lines.push(e(summary), "");

  if (l.deadline) {
    const d = daysUntil(l.deadline);
    const when = d === null || d < 0 ? "" : d === 0 ? " (today)" : ` (${d}d left)`;
    lines.push(e(`Deadline ${fmtDate(l.deadline)}${when}`));
  }

  // ref=tg lets the site's analytics attribute the visit to the channel.
  const links = [`<a href="${e(siteUrl)}/?listing=${l.id}&amp;ref=tg">Read</a>`];
  // Prefer the scraper's deterministic apply_url (parsed from the body) over the
  // LLM's application_url.
  const applyUrl = str(l.applyUrl) ?? str(s?.application_url);
  if (applyUrl && applyUrl.length <= 512 && /^https?:\/\//i.test(applyUrl)) {
    links.push(`<a href="${e(applyUrl)}">Apply</a>`);
  }
  links.push(`<a href="${e(l.sourceUrl)}">Source</a>`);
  lines.push(links.join(" · "));

  return lines.join("\n");
}

// Deadline phrasing with a single restrained urgency marker: red only when it's
// genuinely tight, nothing at all for rolling deadlines.
export function deadlinePhrase(deadline: Date | null): string {
  const d = daysUntil(deadline);
  if (d === null) return "rolling deadline";
  if (d < 0) return "closed";
  if (d === 0) return "🔴 closes today";
  if (d <= 3) return `🔴 ${d}d left`;
  if (d <= 14) return `⏳ ${d}d left`;
  return `${fmtDate(deadline!)} · ${d}d left`;
}

// One /saved row: numbered, title links to the board (tappable), location and
// urgency underneath so rows scan as a column.
export function formatSavedLine(l: Listing, index: number, siteUrl: string): string {
  const loc = l.isRemote ? "Remote" : (l.location?.split(",")[0]?.trim() ?? "—");
  return (
    `${index}. <a href="${escapeHtml(siteUrl)}/?listing=${l.id}&amp;ref=tg-saved"><b>${escapeHtml(l.title.slice(0, 80))}</b></a>\n` +
    `    ${escapeHtml(l.orgName.slice(0, 60))} · ${escapeHtml(loc)} · ${deadlinePhrase(l.deadline)}`
  );
}

// Caption for the card photo sent when a listing is saved.
export function formatSaveConfirmation(l: Listing): string {
  const lines = [`✅ Saved — <b>${escapeHtml(l.title.slice(0, 120))}</b>`];
  if (l.deadline) {
    lines.push(`${deadlinePhrase(l.deadline)} · I'll remind you 24h &amp; 72h before it closes.`);
  } else {
    lines.push("Rolling deadline — no reminders needed, apply when ready.");
  }
  return lines.join("\n");
}

// Caption for the deadline-reminder card DM. Leads with the time pressure,
// then hands the reader straight to the apply/read links.
export function formatReminder(l: Listing, siteUrl: string, window: "24h" | "72h"): string {
  const e = escapeHtml;
  const s = structuredData(l);
  const lines = [
    `⏰ <b>Closes in ~${window}</b>`,
    `<b>${e(l.orgName.slice(0, 120))}</b> — ${e(l.title.slice(0, 120))}`,
    "",
  ];
  const links = [`<a href="${e(siteUrl)}/?listing=${l.id}&amp;ref=tg-reminder">Read</a>`];
  const applyUrl = str(l.applyUrl) ?? str(s?.application_url);
  if (applyUrl && applyUrl.length <= 512 && /^https?:\/\//i.test(applyUrl)) {
    links.push(`<a href="${e(applyUrl)}">Apply now</a>`);
  }
  lines.push(links.join(" · "));
  return lines.join("\n");
}
