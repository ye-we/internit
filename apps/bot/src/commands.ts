import { renderBrandCard, renderListingCard } from "@internit/card";
import { and, eq, getDb, getTableColumns, inArray, listings, orgs, sql, subscribers, type Listing } from "@internit/db";
import { Markup, type Context, type Telegraf } from "telegraf";
import { formatChannelPost, formatSaveConfirmation, formatSavedLine } from "./format.js";
import type { BotConfig } from "./jobs.js";
import { sendListingCard } from "./media.js";
import { sampleListings } from "./samples.js";
import { trackTg } from "./track.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WELCOME =
  "<b>Internit</b> — internships for Ethiopian social-studies students\n" +
  "<i>political science · IR · governance · human rights · peace &amp; conflict · development</i>\n\n" +
  "<blockquote>New listings post to the channel as they're found. Save the ones you like — " +
  "I'll remind you 24h and 72h before they close.</blockquote>\n" +
  "<b>Commands</b>\n" +
  "/saved — your saved listings + deadlines\n" +
  "/save &lt;id&gt; — save a listing for reminders\n" +
  "/filter — field / paid / remote preferences\n" +
  "/orgs — orgs worth contacting directly\n" +
  "/help — everything else";

const HELP =
  "<b>Commands</b>\n\n" +
  "/saved — your saved listings, soonest deadline first\n" +
  "/save &lt;id&gt; — save a listing (or tap 🔔 under any channel post)\n" +
  "/filter — field / paid / remote preferences\n" +
  "/orgs — the cold-outreach directory: orgs that rarely post but take interns\n" +
  "/digest — weekly Friday digest (coming soon)\n\n" +
  "<i>Saved listings get a reminder 24h and 72h before they close.</i>";

export function registerCommands(bot: Telegraf, config: BotConfig): void {
  bot.start(async (ctx) => {
    const payload = ctx.payload.trim();
    // Deep link from the web "remind me" bell: t.me/<bot>?start=save_<listingId>
    if (payload.startsWith("save_")) {
      const id = payload.slice(5);
      if (UUID_RE.test(id)) {
        const res = await saveListing(ctx, id, "deeplink");
        await replySaveResult(ctx, res, config);
        return;
      }
    }
    await upsertSubscriber(ctx);
    await sendWelcome(ctx);
  });

  bot.help((ctx) => ctx.replyWithHTML(HELP));

  bot.command("save", async (ctx) => {
    const id = ctx.payload.trim();
    if (!UUID_RE.test(id)) {
      await ctx.reply("Usage: /save <listing id> — find the id on the listing page.");
      return;
    }
    const res = await saveListing(ctx, id, "command");
    await replySaveResult(ctx, res, config);
  });

  bot.command("saved", async (ctx) => {
    const db = getDb();
    const chatId = BigInt(ctx.chat!.id);
    const [sub] = await db.select().from(subscribers).where(eq(subscribers.chatId, chatId));
    if (!sub || sub.savedListingIds.length === 0) {
      await ctx.reply("You haven't saved anything yet. Use /save <id> on a listing you like.");
      return;
    }
    const saved = await db.select().from(listings).where(inArray(listings.id, sub.savedListingIds));
    const open = saved
      .filter((l) => !l.deadline || l.deadline.getTime() >= Date.now())
      .sort((a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity));
    if (open.length === 0) {
      await ctx.reply("Your saved listings have all closed.");
      return;
    }
    // Chunked: 50 saves × two-line entries can clear Telegram's 4096 cap.
    const header = `📌 <b>Your saved listings</b> — ${open.length} open, soonest first\n`;
    const lines = open.map((l, i) => formatSavedLine(l, i + 1, config.siteUrl));
    for (let i = 0; i < lines.length; i += 15) {
      await ctx.reply((i === 0 ? `${header}\n` : "") + lines.slice(i, i + 15).join("\n\n"), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    }
  });

  bot.command("filter", async (ctx) => {
    const sub = await upsertSubscriber(ctx);
    const f = sub.filters as { fields?: string[]; paid_only?: boolean; remote_ok?: boolean };
    await ctx.replyWithHTML(
      "🎛 <b>Your filters</b>\n\n" +
        `Fields — <b>${f.fields?.length ? escape(f.fields.join(", ")) : "all"}</b>\n` +
        `Paid only — <b>${f.paid_only ? "yes" : "no"}</b>\n` +
        `Remote ok — <b>${f.remote_ok === false ? "no" : "yes"}</b>\n\n` +
        "<i>Tap-to-edit filters are coming. For now, the channel posts everything that fits.</i>",
    );
  });

  bot.command("orgs", async (ctx) => {
    const db = getDb();
    // Cold-outreach directory: orgs that don't post publicly — contact directly.
    const dir = await db
      .select({ name: orgs.name, website: orgs.website, email: orgs.applicationEmail })
      .from(orgs)
      .where(inArray(orgs.postsPublicly, ["no", "sometimes"]))
      .limit(12);
    if (dir.length === 0) {
      await ctx.reply("No directory orgs yet.");
      return;
    }
    const lines = dir.map((o) => {
      const name =
        o.website && /^https?:\/\//i.test(o.website)
          ? `<a href="${escape(o.website)}"><b>${escape(o.name)}</b></a>`
          : `<b>${escape(o.name)}</b>`;
      return `• ${name}${o.email ? ` — ${escape(o.email)}` : ""}`;
    });
    await ctx.reply(
      "🏛 <b>Orgs to contact directly</b>\n" +
        "<i>They rarely post openings — a good email with your CV goes further than waiting.</i>\n\n" +
        lines.join("\n") +
        `\n\nFull directory with how-to-apply notes → ${escape(config.siteUrl)}/orgs`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  });

  bot.command("digest", async (ctx) => {
    await upsertSubscriber(ctx);
    await ctx.reply("Weekly digest opt-in is coming soon.");
  });

  // Dev utility: preview the channel card + caption on dummy listings, sent to
  // whoever asks (their own DM) — never the channel. `/test_card 3` → 3 samples.
  // Admin-only: card rendering is CPU-heavy (satori + resvg), so leaving it
  // open to any user is a cheap DoS.
  bot.command("test_card", async (ctx) => {
    if (!config.adminChatId || ctx.chat?.id !== config.adminChatId) return;
    const samples = sampleListings();
    const requested = parseInt(ctx.payload.trim(), 10);
    const n = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 1, samples.length);
    await ctx.reply(`Rendering ${n} test card${n > 1 ? "s" : ""}…`);
    for (const l of samples.slice(0, n)) {
      try {
        const png = await renderListingCard(l);
        await ctx.replyWithPhoto(
          { source: png },
          { caption: formatChannelPost(l, config.siteUrl), parse_mode: "HTML" },
        );
      } catch (err) {
        console.error("[bot] test_card render failed:", err instanceof Error ? err.message : err);
        await ctx.reply("Render failed — see server logs.");
      }
    }
  });
}

// Welcome banner: the inverted brand card (matches the bot's profile picture).
// Rendered once per process, then reused via Telegram's file_id — the render
// only ever happens for the first /start after a restart.
let welcomePng: Buffer | null = null;
let welcomeFileId: string | null = null;

async function sendWelcome(ctx: Context): Promise<void> {
  const opts = { caption: WELCOME, parse_mode: "HTML" as const };
  try {
    if (welcomeFileId) {
      await ctx.replyWithPhoto(welcomeFileId, opts);
      return;
    }
    welcomePng ??= await renderBrandCard({
      title: "Internit",
      subtitle: "Internships for Ethiopian social-studies students",
      tagline: "political science · IR · governance · human rights · peace & conflict",
    });
    const msg = await ctx.replyWithPhoto({ source: welcomePng }, opts);
    welcomeFileId = msg.photo?.at(-1)?.file_id ?? null;
  } catch (err) {
    console.error("[bot] welcome card failed, sending text:", err instanceof Error ? err.message : err);
    await ctx.replyWithHTML(WELCOME);
  }
}

async function upsertSubscriber(ctx: Context) {
  const db = getDb();
  const chatId = BigInt(ctx.chat!.id);
  const username = ctx.from?.username ?? null;
  const [sub] = await db
    .insert(subscribers)
    .values({ chatId, username })
    .onConflictDoUpdate({ target: subscribers.chatId, set: { username } })
    // Postgres trick: xmax = 0 iff the row was freshly inserted, not updated —
    // lets one round-trip tell us whether this is a brand-new subscriber.
    .returning({ ...getTableColumns(subscribers), isNew: sql<boolean>`(xmax = 0)` });
  if (sub!.isNew) trackTg("tg_subscribe", chatId);
  return sub!;
}

// Save a listing to a subscriber's reminder list. Returns the full listing row
// so the confirmation can show its card. Shared by /save and the web "remind
// me" deep link (t.me/<bot>?start=save_<id>).
const MAX_SAVED = 50;

type SaveResult = { status: "saved"; listing: Listing } | { status: "missing" } | { status: "capped" };

async function saveListing(
  ctx: Context,
  id: string,
  ref: "deeplink" | "command",
): Promise<SaveResult> {
  const db = getDb();
  // Only active listings: hidden ones are pulled deliberately (e.g. CSO-safety
  // takedowns) and must not be retrievable by UUID, expired ones have nothing
  // to remind about.
  const [listing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.status, "active")));
  if (!listing) return { status: "missing" };
  const sub = await upsertSubscriber(ctx);
  if (!sub.savedListingIds.includes(id)) {
    if (sub.savedListingIds.length >= MAX_SAVED) return { status: "capped" };
    await db
      .update(subscribers)
      .set({ savedListingIds: [...sub.savedListingIds, id] })
      .where(eq(subscribers.chatId, sub.chatId));
    // Only genuinely-new saves count; ref splits channel-button vs /save command.
    trackTg("tg_save", sub.chatId, { listingId: id, ref });
  }
  return { status: "saved", listing };
}

// Confirmation for both save entry points: the listing's card image (cached
// file_id after the channel post — no render cost) captioned with the deadline
// plan, plus an Open button into the board. Text fallback if the card fails.
async function replySaveResult(ctx: Context, res: SaveResult, config: BotConfig): Promise<void> {
  if (res.status === "capped") {
    await ctx.reply(`You've hit the ${MAX_SAVED}-listing limit — prune some with /saved first.`);
    return;
  }
  if (res.status === "missing") {
    await ctx.reply("Couldn't find that listing — it may have closed.");
    return;
  }
  const l = res.listing;
  const caption = formatSaveConfirmation(l);
  const openButton = Markup.inlineKeyboard([
    Markup.button.url("Open listing", `${config.siteUrl}/?listing=${l.id}&ref=tg-saved`),
  ]).reply_markup;
  try {
    await sendListingCard(ctx.telegram, ctx.chat!.id, l, { caption, reply_markup: openButton });
  } catch (err) {
    // Visible in pm2 logs — a silent text fallback would hide render/send bugs.
    console.error(`[bot] save card failed for ${l.id}, sending text:`, err instanceof Error ? err.message : err);
    await ctx.reply(caption, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: openButton,
    });
  }
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
