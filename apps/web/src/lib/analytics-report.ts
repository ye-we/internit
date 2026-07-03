// Builds the System-tab data into a self-contained Markdown report, shaped for
// pasting into an LLM (or archiving): labelled sections, pipe tables, fenced
// logs. Error logs are included in full (they're the signal); output logs are
// trimmed. Pure client-side — generated from the page's already-loaded data.

type Run = {
  source: string;
  started: string;
  secs: number | null;
  new_count: number;
  updated_count: number;
  error_count: number;
};
type OrgStat = { slug: string; adapter: string; errors: number; kept: number; ms: number };
type ProcessLog = { name: string; out: string[] | null; err: string[] | null };

export type SystemReportData = {
  totals: { views30: number; visitors30: number; tg30: number; applies30: number };
  health: {
    active: number;
    expired: number;
    hidden: number;
    structured: number;
    withApply: number;
    backlog: number;
    events: number;
  };
  product: {
    active: number;
    posted: number;
    subscribers: number;
    bookmarks: number;
    reminders: number;
  };
  bySource: { source: string; active: number }[];
  runs: Run[];
  orgStats: OrgStat[];
  processLogs: ProcessLog[];
};

const OUT_LOG_LINES = 40;

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");
const secs = (s: number | null) =>
  s === null ? "unfinished" : s < 90 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

function fence(lines: string[] | null, trim?: number): string {
  if (lines === null) return "_no log file found_";
  if (lines.length === 0) return "_empty_";
  const shown = trim ? lines.slice(-trim) : lines;
  const note = trim && lines.length > trim ? `_(last ${trim} of ${lines.length} lines)_\n` : "";
  return `${note}\`\`\`\n${shown.join("\n")}\n\`\`\``;
}

export function buildSystemReport(d: SystemReportData): string {
  const now = new Date();
  const parts: string[] = [];

  parts.push(
    `# internit — system report`,
    ``,
    `Generated ${now.toISOString()} · internship aggregator for Ethiopian social-studies students · all windows are last 30 days unless noted.`,
    ``,
    `## Traffic snapshot`,
    `${d.totals.views30} views · ${d.totals.visitors30} unique visitors · ${d.totals.tg30} visitors from the Telegram channel · ${d.totals.applies30} apply clicks.`,
    ``,
    `## Health`,
    `| metric | value | note |`,
    `|---|---|---|`,
    `| Structured coverage | ${d.health.structured}/${d.health.active} (${pct(d.health.structured, d.health.active)}) | active listings processed by the LLM structurer (reader sections + repaired deadline/pay) |`,
    `| Direct apply links | ${d.health.withApply}/${d.health.active} (${pct(d.health.withApply, d.health.active)}) | active listings with a parsed direct application URL |`,
    `| Channel backlog | ${d.health.backlog} | active, fit ≥ 70, not yet posted to the Telegram channel (bot drains every 15 min — should be ~0) |`,
    `| Expired · hidden | ${d.health.expired} · ${d.health.hidden} | lifecycle counts; expired = past deadline/stale, hidden = pulled deliberately |`,
    `| Analytics event rows | ${d.health.events} | total page_events rows ever |`,
    ``,
    `## Product`,
    `Active listings ${d.product.active} · posted to channel ${d.product.posted} · Telegram subscribers ${d.product.subscribers} · web bookmarks ${d.product.bookmarks} · web reminders ${d.product.reminders}.`,
    ``,
    `Active by source: ${d.bySource.map((s) => `${s.source} ${s.active}`).join(" · ") || "none"}.`,
  );

  parts.push(
    ``,
    `## Scrape runs (latest ${d.runs.length})`,
    `NEW = first-time inserts, UPDATED = re-seen and refreshed, ERRORS = org-level failures the run continued past.`,
    ``,
    `| source | started | duration | new | updated | errors |`,
    `|---|---|---|---|---|---|`,
    ...d.runs.map(
      (r) =>
        `| ${r.source} | ${r.started} | ${secs(r.secs)} | ${r.new_count} | ${r.updated_count} | ${r.error_count} |`,
    ),
  );

  if (d.orgStats.length) {
    parts.push(
      ``,
      `## Latest orgs run — per-org, worst first`,
      `| org | adapter | duration | errors | kept |`,
      `|---|---|---|---|---|`,
      ...d.orgStats.map(
        (o) => `| ${o.slug} | ${o.adapter} | ${(o.ms / 1000).toFixed(1)}s | ${o.errors} | ${o.kept} |`,
      ),
    );
  }

  parts.push(``, `## Process logs (PM2 tails)`);
  for (const p of d.processLogs) {
    parts.push(
      ``,
      `### ${p.name} — error log`,
      fence(p.err),
      ``,
      `### ${p.name} — output log`,
      fence(p.out, OUT_LOG_LINES),
    );
  }

  return parts.join("\n");
}
