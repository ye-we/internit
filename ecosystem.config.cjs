// PM2 process file. `pm2 start ecosystem.config.cjs`
//
// Web (public + admin) is the SvelteKit app with direct DB access — not here.
// Two long-running processes, both PM2-managed (its strength):
//   - internit-worker: schedules the nightly scrape→dedup→prune pipeline itself
//     (croner, 02:00 EAT), so no cron_restart hack.
//   - internit-bot: the Telegram bot (commands + channel auto-post + reminders).
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
  ],
};
