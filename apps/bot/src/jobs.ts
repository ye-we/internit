// Background jobs the bot owns (all Telegram I/O lives in one place):
//   - channel auto-post: broadcast new high-fit listings to the channel
//   - deadline reminders: DM savers 24h / 72h before a saved listing closes
// Coordinated with the worker purely through the database — the worker writes
// listings, the bot polls for ones it hasn't broadcast yet.

import { renderListingCard } from "@internit/card";
import { and, eq, getDb, gte, inArray, listings, subscribers } from "@internit/db";
import { Cron } from "croner";
import { Markup, type Telegraf } from "telegraf";
import { formatChannelPost } from "./format.js";

const CHANNEL_FIT_THRESHOLD = 70; // CLAUDE.md: fit ≥ 70 auto-posts

export type BotConfig = { channelId: string | null; siteUrl: string; adminChatId: number | null };

export function startJobs(bot: Telegraf, config: BotConfig): Cron[] {
  return [
    new Cron("*/15 * * * *", () => postNewListings(bot, config).catch(logErr("post"))),
    new Cron("0 */6 * * *", () => sendReminders(bot, config).catch(logErr("reminders"))),
  ];
}

// One-tap "remind me" button → bot deep link. The bot's /start handler saves
// the listing and schedules its 24h/72h reminders. Shown only when there's a
// deadline and the bot's @username is known (populated by Telegraf at launch).
function remindButton(l: { id: string; deadline: Date | null }, username: string | undefined) {
  if (!username || !l.deadline) return undefined;
  return Markup.inlineKeyboard([
    Markup.button.url(
      "🔔 Remind me before the deadline",
      `https://t.me/${username}?start=save_${l.id}`,
    ),
  ]).reply_markup;
}

async function postNewListings(bot: Telegraf, { channelId, siteUrl }: BotConfig): Promise<void> {
  if (!channelId) return;
  const db = getDb();
  const queue = await db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.postedToChannel, false),
        eq(listings.status, "active"),
        gte(listings.fitScore, CHANNEL_FIT_THRESHOLD),
      ),
    )
    .limit(10);

  for (const l of queue) {
    // Never broadcast something already closed; just mark it so we skip it.
    if (l.deadline && l.deadline.getTime() < Date.now()) {
      await markPosted(l.id);
      continue;
    }
    const caption = formatChannelPost(l, siteUrl);
    const replyMarkup = remindButton(l, bot.botInfo?.username);
    try {
      // Editorial card as the lead image; caption carries the full post. If the
      // render ever throws, or the caption exceeds Telegram's 1024-char photo
      // cap, fall back to a plain text post so a rendering bug can never stall
      // the broadcast queue.
      let usePhoto = caption.length <= 1024;
      if (usePhoto) {
        try {
          const png = await renderListingCard(l);
          await bot.telegram.sendPhoto(
            channelId,
            { source: png },
            { caption, parse_mode: "HTML", reply_markup: replyMarkup },
          );
        } catch (renderErr) {
          if (isTelegramBadRequest(renderErr)) throw renderErr;
          console.error(
            `[bot] card render failed for ${l.id}, sending text:`,
            renderErr instanceof Error ? renderErr.message : renderErr,
          );
          usePhoto = false;
        }
      }
      if (!usePhoto) {
        await bot.telegram.sendMessage(channelId, caption, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: replyMarkup,
        });
      }
      await markPosted(l.id);
    } catch (err) {
      console.error(`[bot] channel post failed for ${l.id}:`, err instanceof Error ? err.message : err);
      // A 400 from Telegram (parse error, caption too long) will fail the same
      // way forever; with no orderBy on the queue, retrying it every 15 minutes
      // would starve everything behind it. Quarantine it and move on. Transient
      // errors (429, network) stay unposted and retry next tick.
      if (isTelegramBadRequest(err)) {
        console.error(`[bot] quarantining listing ${l.id} after non-retryable 400`);
        await markPosted(l.id);
      }
    }
  }
}

function isTelegramBadRequest(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    (err as { response?: { error_code?: number } }).response?.error_code === 400
  );
}

async function markPosted(id: string): Promise<void> {
  await getDb().update(listings).set({ postedToChannel: true }).where(eq(listings.id, id));
}

async function sendReminders(bot: Telegraf, _config: BotConfig): Promise<void> {
  const db = getDb();
  const subs = await db.select().from(subscribers);
  const now = Date.now();

  for (const sub of subs) {
    if (sub.savedListingIds.length === 0) continue;
    const saved = await db.select().from(listings).where(inArray(listings.id, sub.savedListingIds));
    for (const l of saved) {
      if (!l.deadline) continue;
      const hours = (l.deadline.getTime() - now) / 3_600_000;
      // 3h windows on a 6h cadence → each deadline crosses a window once, so no
      // duplicate reminders. (A proper sent-log would harden against missed ticks.)
      if (sub.notify24h && hours > 21 && hours <= 24) {
        await dm(bot, sub.chatId, `⏰ <b>${escape(l.title)}</b> closes in ~24h.`);
      } else if (sub.notify72h && hours > 69 && hours <= 72) {
        await dm(bot, sub.chatId, `⏰ <b>${escape(l.title)}</b> closes in ~72h.`);
      }
    }
  }
}

async function dm(bot: Telegraf, chatId: bigint, html: string): Promise<void> {
  try {
    await bot.telegram.sendMessage(Number(chatId), html, { parse_mode: "HTML" });
  } catch (err) {
    // Blocked/deleted chats are expected — don't let one kill the batch.
    console.error(`[bot] DM to ${chatId} failed:`, err instanceof Error ? err.message : err);
  }
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function logErr(job: string) {
  return (err: unknown) =>
    console.error(`[bot] ${job} job error:`, err instanceof Error ? err.message : err);
}
