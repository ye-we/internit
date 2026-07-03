// Operator script: re-extract apply links from the source pages, fix wrong or
// missing apply_url values, and optionally repost the corrected listings to the
// channel. Born from the Feedback Labs incident: Idealist's hasAts=false meant
// the page was never fetched, and the LLM structurer "filled the gap" with a
// hallucinated typeform URL that went out to the channel.
//
// For each selected listing it refetches the source page and extracts the apply
// URL with the (fixed) idealist extractor:
//   - found and different from stored → update
//   - nothing found, but the stored URL doesn't appear anywhere in the scraped
//     posting → clear it (that's the hallucination signature)
//
// SAFETY: dry-run by default — prints what it would do, writes nothing, posts
// nothing. --apply writes the DB; --post additionally reposts fixed listings to
// the channel (requires --apply, silent unless --loud).
//
// Usage (from repo root):
//   pnpm --filter @internit/bot fix-apply                          # dry run over idealist
//   pnpm --filter @internit/bot fix-apply -- --id <uuid>           # one listing
//   pnpm --filter @internit/bot fix-apply -- --apply               # write fixes
//   pnpm --filter @internit/bot fix-apply -- --id <uuid> --apply --post
//   flags: --source <s>  --loud  --delay 3500

import { closeDb, eq, getDb, listings, sql, type Listing } from "@internit/db";
import { PoliteFetcher, evidencedApplyUrl, fetchApplyUrl } from "@internit/scraper";
import { renderListingCard } from "@internit/card";
import { Markup, Telegraf } from "telegraf";
import { formatChannelPost } from "./format.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const strArg = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : (argv[i + 1] ?? null);
};
const numArg = (flag: string, fallback: number): number => {
  const n = Number(strArg(flag));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const apply = has("--apply");
const post = has("--post");
const loud = has("--loud");
const id = strArg("--id");
const source = strArg("--source") ?? "idealist";
const delayMs = numArg("--delay", 3500);

const token = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID ?? null;
const siteUrl = (process.env.SITE_URL ?? "https://example.com").replace(/\/$/, "");

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  if (post && !apply) throw new Error("--post requires --apply: only repost what's actually stored");
  if (id && !UUID_RE.test(id)) throw new Error(`--id is not a UUID: ${id}`);
  if (post && !token) throw new Error("TELEGRAM_BOT_TOKEN not set — cannot --post");
  if (post && !channelId) throw new Error("TELEGRAM_CHANNEL_ID not set — cannot --post");

  console.error("[fix-apply] config");
  console.error(`  mode:    ${apply ? (post ? "APPLY + POST" : "APPLY") : "DRY RUN"}${post && loud ? " (loud)" : ""}`);
  console.error(`  scope:   ${id ? `id ${id}` : `source ${source}`}\n`);

  const db = getDb();
  const rows = id
    ? await db.select().from(listings).where(eq(listings.id, id))
    : await db.select().from(listings).where(eq(listings.source, source));
  if (rows.length === 0) throw new Error("no matching listings");

  const fetcher = new PoliteFetcher();
  const changed: Listing[] = [];
  let unchanged = 0;

  for (const row of rows) {
    const found = await fetchApplyUrl(fetcher, row.sourceUrl);
    let next = row.applyUrl;

    if (found) {
      next = found;
    } else if (row.applyUrl && !evidencedApplyUrl(row.applyUrl, row)) {
      // Nothing on the page, and the stored URL appears nowhere in the posting:
      // an LLM fabrication. Null beats a broken link.
      next = null;
    }

    if (next === row.applyUrl) {
      unchanged += 1;
      continue;
    }

    console.error(`${apply ? "FIX  " : "would"}  ${row.title.slice(0, 50)}`);
    console.error(`         stored: ${row.applyUrl ?? "(null)"}`);
    console.error(`         →       ${next ?? "(null — cleared)"}`);
    if (apply) {
      await db.update(listings).set({ applyUrl: next }).where(eq(listings.id, row.id));
    }
    changed.push({ ...row, applyUrl: next });
  }

  console.error(
    `\n[fix-apply] ${rows.length} scanned · ${changed.length} ${apply ? "fixed" : "would fix"} · ${unchanged} unchanged`,
  );

  // Repost: explicit --id means "this one, even if the URL didn't change";
  // sweep mode only reposts what was actually fixed.
  const repostables = (id ? rows.map((r) => changed.find((c) => c.id === r.id) ?? r) : changed).filter(
    (l) => l.status === "active" && (!l.deadline || l.deadline.getTime() > Date.now()),
  );

  if (post && repostables.length > 0) {
    console.error(`\n[fix-apply] reposting ${repostables.length} listing(s) to ${channelId}\n`);
    const bot = new Telegraf(token!);
    const username = (await bot.telegram.getMe()).username;
    for (const listing of repostables) {
      try {
        const png = await renderListingCard(listing);
        const caption = capCaption(formatChannelPost(listing, siteUrl));
        await bot.telegram.sendPhoto(
          channelId!,
          { source: png },
          {
            caption,
            parse_mode: "HTML",
            disable_notification: !loud,
            reply_markup: remindMarkup(listing, username),
          },
        );
        await markReposted(listing.id);
        console.error(`[fix-apply] posted ${listing.orgName} · ${listing.title}`);
        await sleep(delayMs); // stay under Telegram's channel rate limit
      } catch (err) {
        console.error(`[fix-apply] post failed ${listing.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } else if (post) {
    console.error("[fix-apply] nothing to repost");
  }

  await closeDb();
}

// Telegram photo captions cap at 1024 chars; ours run ~600. Last-resort guard —
// truncating pre-format fields is handled in formatChannelPost itself.
function capCaption(html: string): string {
  return html.length <= 1024 ? html : `${html.slice(0, 1021)}…`;
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

main().catch((err) => {
  console.error("[fix-apply] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
