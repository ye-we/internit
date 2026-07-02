// One-off maintenance script: (1) AI-structure existing listings and repair
// their deadline / paid columns, then (2) repost them to the Telegram channel as
// an editorial card image with a clean caption.
//
// SAFETY: dry-run by default. Without --post it structures + repairs the DB and
// writes card previews to a temp dir, but sends NOTHING to Telegram. Reposts are
// silent (no subscriber notification) unless --loud, paced to respect rate
// limits, and marked in raw.repostedToChannel so re-runs skip what's done — so a
// run interrupted by the Gemini free-tier daily cap or a network blip just
// resumes where it left off.
//
// Usage (from repo root):
//   pnpm --filter @internit/bot repost                      # dry run, 20 listings
//   pnpm --filter @internit/bot repost -- --limit 5         # dry run, 5
//   pnpm --filter @internit/bot repost -- --post            # actually broadcast (silent)
//   pnpm --filter @internit/bot repost -- --post --loud     # broadcast with notification
//   flags: --min-fit 70  --source idealist  --force  --include-reposted
//          --allow-unstructured  --delay 3500

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderListingCard } from "@internit/card";
import { and, closeDb, eq, getDb, listings, sql, type Listing } from "@internit/db";
import { ensureStructured } from "@internit/scraper";
import { Markup, Telegraf } from "telegraf";
import { formatChannelPost } from "./format.js";

// The structurer keys off this; the whole point of the script is to structure,
// so force it on regardless of the ambient flag (still needs GEMINI_API_KEY).
process.env.STRUCTURER_ENABLED = "true";

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const numArg = (flag: string, fallback: number): number => {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const strArg = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

const dryRun = !has("--post");
const loud = has("--loud");
const force = has("--force");
const includeReposted = has("--include-reposted");
const allowUnstructured = has("--allow-unstructured");
const limit = numArg("--limit", 20);
const minFit = numArg("--min-fit", 70);
const source = strArg("--source");
const delayMs = numArg("--delay", 3500);

const token = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID ?? null;
const siteUrl = (process.env.SITE_URL ?? "https://example.com").replace(/\/$/, "");

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  console.error("[repost] config");
  console.error(`  mode:            ${dryRun ? "DRY RUN (no posting)" : loud ? "POST (loud)" : "POST (silent)"}`);
  console.error(`  limit:           ${limit}`);
  console.error(`  min fit:         ${minFit}`);
  console.error(`  source:          ${source ?? "(any)"}`);
  console.error(`  gemini key:      ${process.env.GEMINI_API_KEY ? "set" : "MISSING"}`);
  console.error(`  include reposted:${includeReposted}`);
  console.error(`  allow unstruct.: ${allowUnstructured}`);

  if (!dryRun && !token) throw new Error("TELEGRAM_BOT_TOKEN not set — cannot --post");
  if (!dryRun && !channelId) throw new Error("TELEGRAM_CHANNEL_ID not set — cannot --post");
  if (!process.env.GEMINI_API_KEY && !allowUnstructured) {
    throw new Error("GEMINI_API_KEY not set: nothing can be structured. Pass --allow-unstructured to repost with fallback captions anyway.");
  }

  const db = getDb();

  // Candidates: active, high-fit, not obviously expired, not already reposted.
  const conds = [
    sql`status = 'active'`,
    sql`fit_score >= ${minFit}`,
    sql`(deadline IS NULL OR deadline > now())`,
  ];
  if (!includeReposted) conds.push(sql`coalesce(raw->>'repostedToChannel', '') <> 'true'`);
  if (source) conds.push(sql`source = ${source}`);

  const candidates = await db
    .select()
    .from(listings)
    .where(and(...conds))
    .orderBy(sql`fit_score DESC, deadline ASC NULLS LAST`)
    .limit(limit);

  console.error(`\n[repost] ${candidates.length} candidate listing(s) selected\n`);
  if (candidates.length === 0) {
    await closeDb();
    return;
  }

  // Structure + repair deadline/paid (writes raw.structured and repaired columns).
  const structured = await ensureStructured(candidates, { apply: true, force });

  // Re-filter on the REPAIRED data: a structured deadline may now be in the past,
  // or the structurer may have produced nothing for a listing.
  const now = Date.now();
  const ready = structured.filter(({ listing, structured: data }) => {
    if (listing.status !== "active") return false;
    if (listing.deadline && listing.deadline.getTime() < now) return false;
    if (!allowUnstructured && !data) return false;
    return true;
  });
  const dropped = structured.length - ready.length;
  console.error(`[repost] ${ready.length} ready to post${dropped ? `, ${dropped} dropped (expired/unstructured)` : ""}\n`);

  // Wire up Telegram only when actually posting.
  let bot: Telegraf | null = null;
  let username: string | undefined;
  let previewDir = "";
  if (dryRun) {
    previewDir = mkdtempSync(join(tmpdir(), "internit-repost-"));
    console.error(`[repost] card previews → ${previewDir}\n`);
  } else {
    bot = new Telegraf(token!);
    username = (await bot.telegram.getMe()).username;
  }

  let posted = 0;
  let failed = 0;
  for (const { listing } of ready) {
    const caption = capCaption(formatChannelPost(listing, siteUrl));
    let png: Buffer;
    try {
      png = await renderListingCard(listing);
    } catch (err) {
      failed += 1;
      console.error(`[repost] render failed ${listing.id}:`, err instanceof Error ? err.message : err);
      continue;
    }

    if (dryRun) {
      const file = join(previewDir, `${slug(listing)}.png`);
      writeFileSync(file, png);
      console.error(`— ${listing.orgName} · ${listing.title}`);
      console.error(`  ${file}`);
      console.error(`  caption:\n${indent(caption)}\n`);
      posted += 1;
      continue;
    }

    const ok = await sendWithRetry(bot!, channelId!, png, caption, remindMarkup(listing, username));
    if (ok) {
      await markReposted(listing.id);
      posted += 1;
      console.error(`[repost] posted ${listing.orgName} · ${listing.title}`);
      await sleep(delayMs); // pace to stay under Telegram's channel rate limit
    } else {
      failed += 1;
    }
  }

  console.error(`\n[repost] done — ${dryRun ? "previewed" : "posted"}: ${posted}, failed: ${failed}`);
  await closeDb();
}

// Telegram photo captions cap at 1024 chars (messages allow 4096). Our captions
// run ~600; this is a last-resort guard.
function capCaption(html: string): string {
  return html.length <= 1024 ? html : `${html.slice(0, 1021)}…`;
}

async function sendWithRetry(
  bot: Telegraf,
  channelId: string,
  png: Buffer,
  caption: string,
  replyMarkup: ReturnType<typeof remindMarkup>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await bot.telegram.sendPhoto(
        channelId,
        { source: png },
        { caption, parse_mode: "HTML", disable_notification: !loud, reply_markup: replyMarkup },
      );
      return true;
    } catch (err: unknown) {
      const retryAfter = retryAfterOf(err);
      if (retryAfter && attempt === 0) {
        console.error(`[repost] rate limited, waiting ${retryAfter}s`);
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      console.error(`[repost] send failed:`, err instanceof Error ? err.message : err);
      return false;
    }
  }
  return false;
}

function retryAfterOf(err: unknown): number | null {
  const p = (err as { response?: { parameters?: { retry_after?: number } }; parameters?: { retry_after?: number } });
  return p?.response?.parameters?.retry_after ?? p?.parameters?.retry_after ?? null;
}

function remindMarkup(l: Listing, username: string | undefined) {
  if (!username || !l.deadline) return undefined;
  return Markup.inlineKeyboard([
    Markup.button.url("🔔 Remind me before the deadline", `https://t.me/${username}?start=save_${l.id}`),
  ]).reply_markup;
}

async function markReposted(id: string): Promise<void> {
  await getDb()
    .update(listings)
    .set({
      postedToChannel: true,
      raw: sql`coalesce(raw, '{}'::jsonb) || '{"repostedToChannel": true}'::jsonb`,
    })
    .where(eq(listings.id, id));
}

function slug(l: Listing): string {
  return `${l.fitScore}-${l.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
}

function indent(s: string): string {
  return s.split("\n").map((line) => `    ${line}`).join("\n");
}

main().catch((err) => {
  console.error("[repost] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
