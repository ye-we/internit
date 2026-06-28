// PM2 process file. `pm2 start ecosystem.config.cjs`
//
// Three long-running processes, all PM2-managed (its strength):
//   - internit-worker: schedules the nightly scrape→dedup→prune pipeline itself
//     (croner, 02:00 EAT), so no cron_restart hack.
//   - internit-bot: the Telegram bot (commands + channel auto-post + reminders).
//   - internit-web: the SvelteKit app (adapter-node) with direct DB access.
//     Build it first: `pnpm --filter @internit/web build`.
module.exports = {
  apps: [
    {
      name: "internit-worker",
      cwd: __dirname,
      script: "pnpm",
      args: "--filter @internit/worker run start",
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "internit-bot",
      cwd: __dirname,
      script: "pnpm",
      args: "--filter @internit/bot run start",
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "internit-web",
      cwd: __dirname,
      script: "node",
      // adapter-node server. --env-file loads the monorepo-root .env into the
      // process (DATABASE_URL, BETTER_AUTH_*, GOOGLE_*, PUBLIC_TELEGRAM_BOT_USERNAME,
      // PORT, ORIGIN). Requires Node >= 20.6.
      args: "--env-file=.env apps/web/build",
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
