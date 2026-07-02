import { renderListingCard } from "@internit/card";
import { eq, getDb, inArray, listings, orgs, subscribers } from "@internit/db";
import type { Context, Telegraf } from "telegraf";
import { formatChannelPost, formatSavedLine } from "./format.js";
import type { BotConfig } from "./jobs.js";
import { sampleListings } from "./samples.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WELCOME =
  "Internships for Ethiopian social-studies students — political science, IR, governance, " +
  "human rights, peace &amp; conflict, development.\n\n" +
  "• /saved — your saved listings + deadlines\n" +
  "• /save &lt;id&gt; — save a listing for reminders\n" +
  "• /filter — set field / paid / remote preferences\n" +
  "• /orgs — browse orgs to contact directly\n" +
  "• /help — all commands\n\n" +
  "New listings post to the channel as they're found. Save the ones you like and I'll remind you before they close.";

const HELP =
  "<b>Commands</b>\n" +
  "/saved — your saved listings with days-until-deadline\n" +
  "/save &lt;id&gt; — save a listing (id is on the listing page)\n" +
  "/filter — adjust field / paid / remote preferences\n" +
  "/orgs — browse the cold-outreach org directory\n" +
  "/digest — weekly Friday digest (on/off)\n" +
  "/help — this message";

export function registerCommands(bot: Telegraf, config: BotConfig): void {
  bot.start(async (ctx) => {
    const payload = ctx.payload.trim();
    // Deep link from the web "remind me" bell: t.me/<bot>?start=save_<listingId>
    if (payload.startsWith("save_")) {
      const id = payload.slice(5);
      if (UUID_RE.test(id)) {
        const title = await saveListing(ctx, id);
        await (title
          ? ctx.replyWithHTML(
              `Saved <b>${escape(title)}</b>. I'll remind you 24h &amp; 72h before it closes — see all with /saved.`,
            )
          : ctx.reply("That listing has closed, so there's nothing to remind you about."));
        return;
      }
    }
    await upsertSubscriber(ctx);
    await ctx.replyWithHTML(WELCOME);
  });

  bot.help((ctx) => ctx.replyWithHTML(HELP));

  bot.command("save", async (ctx) => {
    const id = ctx.payload.trim();
    if (!UUID_RE.test(id)) {
      await ctx.reply("Usage: /save <listing id> — find the id on the listing page.");
      return;
    }
    const title = await saveListing(ctx, id);
    if (!title) {
      await ctx.reply("Couldn't find that listing — it may have closed.");
      return;
    }
    await ctx.replyWithHTML(`Saved <b>${escape(title)}</b>. I'll remind you before it closes.`);
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
    await ctx.replyWithHTML(["<b>Your saved listings</b>", ...open.map(formatSavedLine)].join("\n"));
  });

  bot.command("filter", async (ctx) => {
    const sub = await upsertSubscriber(ctx);
    const f = sub.filters as { fields?: string[]; paid_only?: boolean; remote_ok?: boolean };
    await ctx.replyWithHTML(
      "<b>Your filters</b>\n" +
        `Fields: ${f.fields?.length ? escape(f.fields.join(", ")) : "all"}\n` +
        `Paid only: ${f.paid_only ? "yes" : "no"}\n` +
        `Remote ok: ${f.remote_ok === false ? "no" : "yes"}\n\n` +
        "Tap-to-edit filters are coming. For now, the channel posts everything that fits.",
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
      const contact = o.email ? escape(o.email) : o.website ? escape(o.website) : "—";
      return `• <b>${escape(o.name)}</b> — ${contact}`;
    });
    await ctx.replyWithHTML(["<b>Orgs to contact directly</b>", ...lines].join("\n"));
  });

  bot.command("digest", async (ctx) => {
    await upsertSubscriber(ctx);
    await ctx.reply("Weekly digest opt-in is coming soon.");
  });

  // Dev utility: preview the channel card + caption on dummy listings, sent to
  // whoever asks (their own DM) — never the channel. `/test_card 3` → 3 samples.
  bot.command("test_card", async (ctx) => {
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
        await ctx.reply(`Render failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  });
}

async function upsertSubscriber(ctx: Context) {
  const db = getDb();
  const chatId = BigInt(ctx.chat!.id);
  const username = ctx.from?.username ?? null;
  const [sub] = await db
    .insert(subscribers)
    .values({ chatId, username })
    .onConflictDoUpdate({ target: subscribers.chatId, set: { username } })
    .returning();
  return sub!;
}

// Save a listing to a subscriber's reminder list. Returns the listing title,
// or null if the listing no longer exists. Shared by /save and the web "remind
// me" deep link (t.me/<bot>?start=save_<id>).
async function saveListing(ctx: Context, id: string): Promise<string | null> {
  const db = getDb();
  const [listing] = await db
    .select({ title: listings.title })
    .from(listings)
    .where(eq(listings.id, id));
  if (!listing) return null;
  const sub = await upsertSubscriber(ctx);
  if (!sub.savedListingIds.includes(id)) {
    await db
      .update(subscribers)
      .set({ savedListingIds: [...sub.savedListingIds, id] })
      .where(eq(subscribers.chatId, sub.chatId));
  }
  return listing.title;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
