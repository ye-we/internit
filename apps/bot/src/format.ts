import type { Listing } from "@internit/db";

export function daysUntil(deadline: Date | null): number | null {
  if (!deadline) return null;
  return Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
}

// Telegram HTML parse mode — far less escaping than MarkdownV2 (only & < >).
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const lines: string[] = [`<b>${e(l.orgName)}</b>`, e(l.title), ""];

  const summary = (str(s?.summary) ?? firstSentences(l.descriptionText, 2)).slice(0, 300);
  if (summary) lines.push(e(summary), "");

  if (l.deadline) {
    const d = daysUntil(l.deadline);
    const when = d === null || d < 0 ? "" : d === 0 ? " (today)" : ` (${d}d left)`;
    lines.push(e(`Deadline ${fmtDate(l.deadline)}${when}`));
  }

  const links = [`<a href="${e(siteUrl)}/?listing=${l.id}">Read</a>`];
  // Prefer the scraper's deterministic apply_url (parsed from the body) over the
  // LLM's application_url.
  const applyUrl = str(l.applyUrl) ?? str(s?.application_url);
  if (applyUrl && /^https?:\/\//i.test(applyUrl)) {
    links.push(`<a href="${e(applyUrl)}">Apply</a>`);
  }
  links.push(`<a href="${e(l.sourceUrl)}">Source</a>`);
  lines.push(links.join(" · "));

  return lines.join("\n");
}

// Compact one-liner for /saved.
export function formatSavedLine(l: Listing): string {
  const d = daysUntil(l.deadline);
  const when =
    d === null ? "no deadline" : d < 0 ? "closed" : d === 0 ? "closes today" : `${d}d left`;
  const loc = l.isRemote ? "Remote" : (l.location?.split(",")[0] ?? "—");
  return `• <b>${escapeHtml(l.title)}</b> — ${escapeHtml(loc)} · ${when}`;
}
