// PM2 process file. `pm2 start ecosystem.config.cjs`
// Scrape schedule: 23:00 UTC = 02:00 EAT (Africa/Addis_Ababa, UTC+3).
module.exports = {
  apps: [
    {
      name: "rue-api",
      cwd: __dirname,
      script: "pnpm",
      args: "--filter @rue/api run start",
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "rue-scrape-orgs",
      cwd: __dirname,
      script: "pnpm",
      args: "--filter @rue/scraper run scrape:orgs -- --save --max 20",
      cron_restart: "0 23 * * *",
      autorestart: false,
    },
  ],
};
