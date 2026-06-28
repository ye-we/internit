// Telegram bot — the project's distribution layer and identity layer. Owns ALL
// Telegram I/O: user commands, channel auto-posting, and deadline reminders.
// Long-running (PM2 keeps it alive), responsive, and coordinated with the
// scrape worker only through the shared database.

import { closeDb } from "@internit/db";
import { Telegraf } from "telegraf";
import { registerCommands } from "./commands.js";
import { startJobs, type BotConfig } from "./jobs.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("[bot] TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

const config: BotConfig = {
  channelId: process.env.TELEGRAM_CHANNEL_ID ?? null,
  siteUrl: (process.env.SITE_URL ?? "https://example.com").replace(/\/$/, ""),
};

const bot = new Telegraf(token);
registerCommands(bot, config);
const jobs = startJobs(bot, config);

void bot.launch(() => {
  console.error(
    `[bot] launched; channel=${config.channelId ?? "(none)"} site=${config.siteUrl}; jobs: post(15m) reminders(6h)`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    bot.stop(signal);
    jobs.forEach((j) => j.stop());
    void closeDb();
  });
}
