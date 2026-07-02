// Background worker: runs the scrape → dedup → prune → structure pipeline on a schedule.
// It's a long-running process (PM2 keeps it alive) whose only job is to fire the
// nightly batch — kept separate from the web app and the responsive Telegram bot
// so the heavy, bursty scrape can't degrade either.
//
// Each step runs as its own child process: isolation (one step crashing or
// leaking can't take down the worker) and reuse of the already-tested CLI
// scripts. A per-step timeout kills a hung run; an optional Healthchecks.io URL
// gives a dead-man's-switch so a silently-missed night is visible.
//
//   pnpm --filter @internit/worker start      # schedule and wait
//   pnpm --filter @internit/worker run-now    # run the pipeline once and exit

import { spawn } from "node:child_process";
import { Cron } from "croner";

const TZ = "Africa/Addis_Ababa";
// 12:00 EAT = 09:00 UTC — deliberately off Google's US-peak demand window
// (~14:00–23:00 UTC), when Gemini free-tier 503s are worst. The scrape is a slow,
// polite crawl regardless of hour, so this trades a little ethiongojobs off-peak
// for far fewer structurer 503s. Override with WORKER_CRON.
const SCHEDULE = process.env.WORKER_CRON ?? "0 12 * * *";
const STEP_TIMEOUT_MS = Number(process.env.WORKER_STEP_TIMEOUT_MS ?? 30 * 60 * 1000);
const HEALTHCHECK_URL = process.env.WORKER_HEALTHCHECK_URL; // e.g. Healthchecks.io ping URL
// Fast per-deadline deactivation, far more often than the nightly pipeline, so
// the board never shows a closed listing for more than a few hours.
const CLEANUP_SCHEDULE = process.env.WORKER_CLEANUP_CRON ?? "0 */3 * * *"; // every 3h

// The pipeline, in order. Each is an existing, tested workspace script.
const STEPS: Array<{ name: string; args: string[] }> = [
  { name: "scrape", args: ["--filter", "@internit/scraper", "scrape:orgs", "--", "--save", "--max", "20"] },
  { name: "dedup", args: ["--filter", "@internit/scraper", "dedup", "--", "--apply"] },
  { name: "prune", args: ["--filter", "@internit/scraper", "prune:expired", "--", "--apply"] },
  // Structure the fresh listings end-to-end (clean summary + sections, repaired
  // deadline/pay) — paced to the Gemini free-tier limits. Runs last, on the
  // surviving active listings; already-structured (unchanged) ones are skipped.
  { name: "structure", args: ["--filter", "@internit/scraper", "backfill:structure", "--", "--repair-columns", "--limit", "500"] },
];

let running = false;

async function runPipeline(): Promise<void> {
  if (running) {
    log("previous run still in progress — skipping this tick");
    return;
  }
  running = true;
  const started = Date.now();
  log("pipeline start");
  await ping("/start");
  try {
    for (const step of STEPS) {
      log(`→ ${step.name}`);
      await runStep(step);
    }
    log(`pipeline done in ${Math.round((Date.now() - started) / 1000)}s`);
    await ping("");
  } catch (err) {
    log(`pipeline FAILED: ${err instanceof Error ? err.message : String(err)}`);
    await ping("/fail");
  } finally {
    running = false;
  }
}

// Lightweight cleanup tick — one indexed UPDATE, no Gemini. Skipped while the
// heavy pipeline is mid-run to avoid contention.
async function runCleanup(): Promise<void> {
  if (running) {
    log("pipeline running — skipping cleanup tick");
    return;
  }
  try {
    await runStep({ name: "deactivate-expired", args: ["--filter", "@internit/scraper", "deactivate:expired"] });
  } catch (err) {
    log(`cleanup FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function runStep(step: { name: string; args: string[] }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", step.args, { stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${step.name} timed out after ${STEP_TIMEOUT_MS}ms`));
    }, STEP_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${step.name} exited with code ${code}`));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function ping(suffix: string): Promise<void> {
  if (!HEALTHCHECK_URL) return;
  try {
    await fetch(`${HEALTHCHECK_URL}${suffix}`, { method: "POST" });
  } catch {
    // a failed ping must never affect the run
  }
}

function log(msg: string): void {
  console.error(`[worker ${new Date().toISOString()}] ${msg}`);
}

if (process.argv.includes("--now")) {
  await runPipeline();
  process.exit(0);
} else {
  const job = new Cron(SCHEDULE, { timezone: TZ }, runPipeline);
  const cleanup = new Cron(CLEANUP_SCHEDULE, { timezone: TZ }, runCleanup);
  log(
    `scheduled pipeline "${SCHEDULE}" (next ${job.nextRun()?.toISOString() ?? "—"}) + cleanup "${CLEANUP_SCHEDULE}" (next ${cleanup.nextRun()?.toISOString() ?? "—"}) (${TZ})`,
  );
}
