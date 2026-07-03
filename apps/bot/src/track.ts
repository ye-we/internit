// Bot-side analytics: subscribes and saves land in the same page_events table
// the web writes to, so the dashboard sees the whole channel→bot funnel.
// visitor_hash is a STABLE hash of the chat id (unlike the web's daily-rotating
// ip hash) so unique-user counts are real; the raw chat id already lives in
// subscribers, so hashing adds no new exposure. Fire-and-forget: analytics must
// never break a bot reply.

import { createHash } from "node:crypto";
import { getDb, pageEvents } from "@internit/db";

export type TgEventType = "tg_subscribe" | "tg_save";

export function trackTg(
  type: TgEventType,
  chatId: bigint | number,
  opts: { listingId?: string | null; ref?: string | null } = {},
): void {
  void getDb()
    .insert(pageEvents)
    .values({
      type,
      listingId: opts.listingId ?? null,
      ref: opts.ref ?? null,
      visitorHash: createHash("sha256").update(`tg:${chatId}`).digest("hex"),
      device: "telegram",
    })
    .catch(() => {});
}
