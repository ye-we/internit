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

// Channel broadcast (CLAUDE.md): org (bold), role, deadline, fit badge,
// 2-sentence snippet, Read link, source attribution. Restrained, English.
export function formatChannelPost(l: Listing, siteUrl: string): string {
  const e = escapeHtml;
  const lines: string[] = [`<b>${e(l.orgName)}</b>`, e(l.title)];

  const meta: string[] = [];
  meta.push(l.isRemote ? "Remote" : (l.location ?? "").trim());
  if (l.deadline) {
    const d = daysUntil(l.deadline);
    meta.push(`Deadline ${l.deadline.toISOString().slice(0, 10)}${d !== null && d >= 0 ? ` (${d}d left)` : ""}`);
  }
  const metaLine = meta.filter(Boolean).join(" · ");
  if (metaLine) lines.push(e(metaLine));

  const pay = l.isPaid === true ? " · Paid" : l.isPaid === false ? " · Unpaid" : "";
  lines.push(`Fit ${l.fitScore}/100${pay}`);

  const snippet = firstSentences(l.descriptionText, 2);
  if (snippet) lines.push(e(snippet));

  lines.push(
    `<a href="${e(siteUrl)}/?listing=${l.id}">Read</a> · <a href="${e(l.sourceUrl)}">Source</a>`,
  );
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
