// Listing-card photos for bot messages. Telegram re-hosts every uploaded photo
// and returns a stable file_id, so each card is rendered (satori + resvg,
// CPU-heavy) and uploaded at most once — the id is cached in raw.telegramFileId
// and reused for every later save confirmation, reminder, and channel post that
// shows the same listing.

import { renderListingCard } from "@internit/card";
import { eq, getDb, listings, sql, type Listing } from "@internit/db";
import type { Telegraf } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";

type Telegram = Telegraf["telegram"];
type CardExtra = { caption: string; reply_markup?: InlineKeyboardMarkup };

export function cachedCardFileId(l: Listing): string | null {
  const raw = l.raw as { telegramFileId?: unknown } | null;
  return typeof raw?.telegramFileId === "string" ? raw.telegramFileId : null;
}

async function storeCardFileId(id: string, fileId: string): Promise<void> {
  await getDb()
    .update(listings)
    .set({
      raw: sql`coalesce(raw, '{}'::jsonb) || jsonb_build_object('telegramFileId', ${fileId}::text)`,
    })
    .where(eq(listings.id, id));
}

// Send a listing's card photo with an HTML caption. Prefers the cached file_id;
// falls back to a fresh render if the cache misses or Telegram rejects a stale
// id. Errors propagate — callers decide between text fallback and quarantine.
export async function sendListingCard(
  telegram: Telegram,
  chatId: number | string,
  l: Listing,
  extra: CardExtra,
): Promise<void> {
  const opts = { ...extra, parse_mode: "HTML" as const };
  const cached = cachedCardFileId(l);
  if (cached) {
    try {
      await telegram.sendPhoto(chatId, cached, opts);
      return;
    } catch (err) {
      // Stale/invalid file_id → re-render below. Anything else (blocked chat,
      // caption parse error) would fail identically on a fresh upload.
      if (!isBadFileId(err)) throw err;
    }
  }
  const png = await renderListingCard(l);
  const msg = await telegram.sendPhoto(chatId, { source: png }, opts);
  const fileId = msg.photo?.at(-1)?.file_id;
  if (fileId) {
    await storeCardFileId(l.id, fileId).catch(() => {}); // cache miss is not an error
  }
}

function isBadFileId(err: unknown): boolean {
  const desc =
    (err as { response?: { description?: string } })?.response?.description ?? "";
  return /wrong file identifier|file_id|FILE_REFERENCE/i.test(desc);
}
