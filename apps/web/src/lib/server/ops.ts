// Ops readers for the analytics System tab: tails of the PM2 process logs.
// The web app runs under the same PM2 user as the worker/bot, so the default
// ~/.pm2/logs files are readable directly — no agent, no shipping. Fixed path
// candidates only (nothing user-supplied), read as bounded tails so a huge log
// can't balloon the page. Missing files (e.g. local dev) resolve to null.

import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "$env/dynamic/private";

const TAIL_BYTES = 24 * 1024;
const MAX_LINES = 120;

async function tailFile(path: string): Promise<string[] | null> {
  try {
    const { size } = await stat(path);
    const fh = await open(path, "r");
    try {
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      const lines = buf.toString("utf8").split("\n").filter(Boolean);
      // Drop the first (likely partial) line when we started mid-file.
      return (start > 0 ? lines.slice(1) : lines).slice(-MAX_LINES);
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

export type ProcessLog = {
  name: string;
  out: string[] | null;
  err: string[] | null;
};

export async function readProcessLogs(): Promise<ProcessLog[]> {
  const pm2Dir = env.PM2_LOG_DIR || join(homedir(), ".pm2", "logs");
  const procs = [
    { name: "worker", pm2: "internit-worker", local: "worker.log" },
    { name: "bot", pm2: "internit-bot", local: "bot.log" },
    { name: "web", pm2: "internit-web", local: "web.log" },
  ];
  return Promise.all(
    procs.map(async (p) => ({
      name: p.name,
      out:
        (await tailFile(join(pm2Dir, `${p.pm2}-out.log`))) ??
        // repo-local fallback (dev): ./logs/<name>.log
        (await tailFile(join(process.cwd(), "..", "..", "logs", p.local))) ??
        (await tailFile(join(process.cwd(), "logs", p.local))),
      err: await tailFile(join(pm2Dir, `${p.pm2}-error.log`)),
    })),
  );
}
