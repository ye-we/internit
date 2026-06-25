import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthSession } from "../lib/auth-client.js";

type ScrapeRun = {
  id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  new_count: number;
  updated_count: number;
  error_count: number;
  log: {
    orgs?: OrgStat[];
    [key: string]: unknown;
  } | null;
};

type OrgStat = {
  slug: string;
  adapter: string | null;
  fetched: number;
  kept: number;
  new: number;
  updated: number;
  errors: number;
  durationMs: number;
  error?: string | null;
};

type CoverageOrg = {
  slug: string;
  name: string;
  category: string;
  scrape_priority: string | null;
  posts_publicly: string;
  url: string | null;
  predicted_adapter: string | null;
  last_run: {
    adapter: string | null;
    fetched: number;
    kept: number;
    new: number;
    updated: number;
    errors: number;
    duration_ms: number;
    error: string | null;
  } | null;
  active_listings: number;
  total_listings: number;
};

type CoverageResponse = {
  latest_run: {
    id: string;
    started_at: string;
    finished_at: string | null;
    new_count: number;
    updated_count: number;
    error_count: number;
  } | null;
  orgs: CoverageOrg[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) throw new Error("forbidden");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function AdminScrapePage() {
  const { user, isPending } = useAuthSession();
  const role = (user as { role?: string } | null)?.role;

  if (isPending) return null;
  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-16 sm:px-6">
        <h1 className="font-display text-3xl font-black">Not authorized</h1>
        <p className="mt-2 text-sm text-em">This page requires an admin account.</p>
      </main>
    );
  }

  return <Dashboard />;
}

function Dashboard() {
  const runsQuery = useQuery({
    queryKey: ["admin", "scrape-runs"],
    queryFn: () => fetchJson<ScrapeRun[]>("/api/admin/scrape-runs?limit=30"),
    refetchInterval: 60_000,
  });
  const coverageQuery = useQuery({
    queryKey: ["admin", "coverage"],
    queryFn: () => fetchJson<CoverageResponse>("/api/admin/coverage"),
  });

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
      <header className="border-b border-ink/15 pb-5">
        <h1 className="font-display text-4xl font-black leading-none">Scraping</h1>
        <p className="mt-2 max-w-prose text-sm text-em">
          Run history and per-org coverage across the adapter fleet. Scheduled daily at 02:00
          EAT.
        </p>
      </header>

      <section className="mt-8">
        <h2 className="text-xs font-black uppercase tracking-wider text-em">Recent runs</h2>
        {runsQuery.isLoading && <Hint>Loading runs…</Hint>}
        {runsQuery.isError && <Hint>Could not load runs. Is the API up?</Hint>}
        {runsQuery.data && runsQuery.data.length === 0 && <Hint>No runs recorded yet.</Hint>}
        {runsQuery.data && runsQuery.data.length > 0 && <RunsTable runs={runsQuery.data} />}
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-black uppercase tracking-wider text-em">Coverage</h2>
        {coverageQuery.isLoading && <Hint>Loading coverage…</Hint>}
        {coverageQuery.isError && <Hint>Could not load coverage.</Hint>}
        {coverageQuery.data && <CoverageTable data={coverageQuery.data} />}
      </section>
    </main>
  );
}

function Hint({ children }: { children: string }) {
  return <p className="mt-3 text-sm text-em">{children}</p>;
}

function RunsTable({ runs }: { runs: ScrapeRun[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="mt-3 border-t border-ink/15">
      <div className="grid grid-cols-[7rem_1fr_5rem_4rem_4rem_4rem] gap-2 border-b border-ink/15 py-1.5 text-[11px] font-black uppercase tracking-wide text-em sm:grid-cols-[10rem_1fr_6rem_5rem_5rem_5rem]">
        <span>Started</span>
        <span>Source</span>
        <span className="text-right">Duration</span>
        <span className="text-right">New</span>
        <span className="text-right">Updated</span>
        <span className="text-right">Errors</span>
      </div>
      {runs.map((run) => {
        const orgStats = run.log?.orgs ?? null;
        const open = openId === run.id;
        const expandable = Boolean(orgStats && orgStats.length > 0);
        return (
          <div key={run.id} className="border-b border-ink/10">
            <button
              type="button"
              disabled={!expandable}
              onClick={() => setOpenId(open ? null : run.id)}
              className={`grid w-full grid-cols-[7rem_1fr_5rem_4rem_4rem_4rem] gap-2 py-2 text-left text-sm sm:grid-cols-[10rem_1fr_6rem_5rem_5rem_5rem] ${
                expandable ? "hover:bg-ink/[0.03]" : "cursor-default"
              }`}
            >
              <span className="tabular-nums text-em">{formatStamp(run.started_at)}</span>
              <span className="font-medium">
                {run.source}
                {expandable && (
                  <span className="ml-2 text-xs text-em">
                    {open ? "▾" : "▸"} {orgStats!.length} orgs
                  </span>
                )}
              </span>
              <span className="text-right tabular-nums text-em">
                {duration(run.started_at, run.finished_at)}
              </span>
              <span className="text-right tabular-nums">{run.new_count}</span>
              <span className="text-right tabular-nums">{run.updated_count}</span>
              <span
                className={`text-right tabular-nums ${run.error_count > 0 ? "font-black" : "text-em"}`}
              >
                {run.error_count}
              </span>
            </button>
            {open && orgStats && <RunOrgDetail stats={orgStats} />}
          </div>
        );
      })}
    </div>
  );
}

function RunOrgDetail({ stats }: { stats: OrgStat[] }) {
  const sorted = [...stats].sort(
    (a, b) => b.errors - a.errors || b.kept - a.kept || a.slug.localeCompare(b.slug),
  );
  return (
    <div className="mb-3 ml-2 border-l border-ink/15 pl-4 sm:ml-4">
      <div className="grid grid-cols-[1fr_7rem_3.5rem_3.5rem_3.5rem_4.5rem] gap-2 py-1 text-[11px] font-black uppercase tracking-wide text-em sm:grid-cols-[1fr_9rem_4rem_4rem_4rem_5rem]">
        <span>Org</span>
        <span>Adapter</span>
        <span className="text-right">Fetched</span>
        <span className="text-right">Kept</span>
        <span className="text-right">New</span>
        <span className="text-right">Time</span>
      </div>
      {sorted.map((s) => (
        <div key={s.slug} className="border-t border-ink/10 py-1 text-xs">
          <div className="grid grid-cols-[1fr_7rem_3.5rem_3.5rem_3.5rem_4.5rem] gap-2 sm:grid-cols-[1fr_9rem_4rem_4rem_4rem_5rem]">
            <span className="truncate font-medium">{s.slug}</span>
            <span className="truncate text-em">{s.adapter ?? "—"}</span>
            <span className="text-right tabular-nums text-em">{s.fetched}</span>
            <span className="text-right tabular-nums">{s.kept}</span>
            <span className="text-right tabular-nums">{s.new}</span>
            <span className="text-right tabular-nums text-em">{Math.round(s.durationMs / 1000)}s</span>
          </div>
          {s.error && <p className="mt-0.5 truncate text-[11px] text-em">⚠ {s.error}</p>}
        </div>
      ))}
    </div>
  );
}

function CoverageTable({ data }: { data: CoverageResponse }) {
  const [filter, setFilter] = useState<"all" | "errors" | "unscraped">("all");

  const orgs = data.orgs.filter((o) => {
    if (filter === "errors") return Boolean(o.last_run?.error);
    if (filter === "unscraped") return o.last_run === null;
    return true;
  });

  const scraped = data.orgs.filter((o) => o.last_run !== null).length;
  const withListings = data.orgs.filter((o) => o.active_listings > 0).length;
  const erroring = data.orgs.filter((o) => o.last_run?.error).length;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2 border border-ink/15 px-4 py-3">
        <Stat label="Eligible orgs" value={data.orgs.length} />
        <Stat label="Scraped last run" value={scraped} />
        <Stat label="With active listings" value={withListings} />
        <Stat label="Erroring" value={erroring} />
        {data.latest_run && (
          <span className="ml-auto text-xs text-em">
            Last run {formatStamp(data.latest_run.started_at)}
          </span>
        )}
      </div>

      <div className="mt-4 flex gap-0 text-xs font-black">
        {(["all", "errors", "unscraped"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`border border-ink/20 px-3 py-1 ${
              filter === f ? "bg-ink text-paper" : "text-em hover:text-ink"
            } ${f !== "all" ? "-ml-px" : ""}`}
          >
            {f === "all" ? "All" : f === "errors" ? "Errors" : "Never scraped"}
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-ink/15">
        <div className="grid grid-cols-[1fr_5rem_7rem_3.5rem_3.5rem_4rem] gap-2 border-b border-ink/15 py-1.5 text-[11px] font-black uppercase tracking-wide text-em sm:grid-cols-[1fr_6rem_9rem_4rem_4rem_5rem]">
          <span>Org</span>
          <span>Priority</span>
          <span>Adapter</span>
          <span className="text-right">Kept</span>
          <span className="text-right">Active</span>
          <span className="text-right">Status</span>
        </div>
        {orgs.map((o) => (
          <div key={o.slug} className="border-b border-ink/10 py-1.5 text-sm">
            <div className="grid grid-cols-[1fr_5rem_7rem_3.5rem_3.5rem_4rem] items-baseline gap-2 sm:grid-cols-[1fr_6rem_9rem_4rem_4rem_5rem]">
              <span className="truncate font-medium" title={o.url ?? undefined}>
                {o.name}
              </span>
              <span className="text-xs text-em">{o.scrape_priority ?? "—"}</span>
              <span className="truncate text-xs text-em">
                {o.last_run?.adapter ?? o.predicted_adapter ?? "none"}
                {!o.last_run && o.predicted_adapter && (
                  <span className="text-em/60"> (predicted)</span>
                )}
              </span>
              <span className="text-right tabular-nums text-em">{o.last_run?.kept ?? "—"}</span>
              <span className="text-right tabular-nums">{o.active_listings}</span>
              <span className="text-right text-xs">
                {o.last_run?.error ? (
                  <span className="font-black">error</span>
                ) : o.last_run ? (
                  <span className="text-em">ok</span>
                ) : (
                  <span className="text-em/60">—</span>
                )}
              </span>
            </div>
            {o.last_run?.error && (
              <p className="mt-0.5 truncate text-[11px] text-em">⚠ {o.last_run.error}</p>
            )}
          </div>
        ))}
        {orgs.length === 0 && <Hint>Nothing matches this filter.</Hint>}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-sm">
      <span className="font-display text-2xl font-black tabular-nums">{value}</span>{" "}
      <span className="text-xs text-em">{label}</span>
    </span>
  );
}

function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function duration(start: string, end: string | null): string {
  if (!end) return "running";
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
