import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Org } from "@rue/shared";
import { OrgRow } from "../components/OrgRow.js";
import { OrgDetail } from "../components/OrgDetail.js";

const ALL = "all";
const PRIORITY_ORDER = ["critical", "high", "medium", "low"];

export function OrgsPage() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [category, setCategory] = useState(ALL);
  const [region, setRegion] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [publicOnly, setPublicOnly] = useState(false);
  const [query, setQuery] = useState("");

  const orgsQuery = useQuery({
    queryKey: ["orgs"],
    queryFn: () =>
      fetch("/api/orgs").then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Org[]>;
      }),
  });

  const orgs = orgsQuery.data ?? [];
  const categories = useMemo(
    () => Array.from(new Set(orgs.map((o) => o.category))).sort(),
    [orgs],
  );
  const regions = useMemo(
    () =>
      Array.from(new Set(orgs.map((o) => o.region).filter(Boolean) as string[])).sort(),
    [orgs],
  );
  const priorities = useMemo(
    () =>
      Array.from(
        new Set(orgs.map((o) => o.scrape_priority).filter(Boolean) as string[]),
      ).sort((a, b) => PRIORITY_ORDER.indexOf(a) - PRIORITY_ORDER.indexOf(b)),
    [orgs],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orgs.filter((o) => {
      if (category !== ALL && o.category !== category) return false;
      if (region !== ALL && o.region !== region) return false;
      if (priority !== ALL && o.scrape_priority !== priority) return false;
      if (publicOnly && !["yes", "sometimes"].includes(o.posts_publicly)) return false;
      if (!q) return true;
      return [o.name, o.slug, o.category, o.region ?? "", o.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [orgs, category, region, priority, publicOnly, query]);

  const selected = visible.find((o) => o.slug === selectedSlug) ?? visible[0] ?? null;
  const countLabel = orgsQuery.isLoading ? "Loading" : `${visible.length}/${orgs.length} orgs`;

  return (
    <>
      <div className="sticky top-12 z-10 border-b border-ink/15 bg-paper/95 px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 min-w-0 flex-[1_1_200px] border border-ink/20 bg-paper px-3 text-sm font-medium outline-none focus:border-ink"
            placeholder="Search orgs, notes, URLs"
            aria-label="Search orgs"
          />
          <Select
            label="Category"
            value={category}
            onChange={(v) => { setCategory(v); setSelectedSlug(null); }}
            options={[ALL, ...categories]}
          />
          <Select
            label="Region"
            value={region}
            onChange={(v) => { setRegion(v); setSelectedSlug(null); }}
            options={[ALL, ...regions]}
          />
          <Select
            label="Priority"
            value={priority}
            onChange={(v) => { setPriority(v); setSelectedSlug(null); }}
            options={[ALL, ...priorities]}
          />
          <Toggle
            label="Public"
            checked={publicOnly}
            onChange={(v) => { setPublicOnly(v); setSelectedSlug(null); }}
          />
          <span className="ml-auto shrink-0 text-xs font-medium uppercase tracking-[0.14em] text-em">
            {countLabel}
          </span>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[minmax(340px,30%)_minmax(0,1fr)]">
        <section className="border-b border-ink/15 lg:min-h-[calc(100vh-97px)] lg:border-b-0 lg:border-r">
          {orgsQuery.isError ? (
            <StateMessage title="Could not load orgs" body="Check that the API server is running." />
          ) : visible.length === 0 && !orgsQuery.isLoading ? (
            <StateMessage title="No matching orgs" body="Clear a filter or search term." />
          ) : (
            <div className="divide-y divide-ink/10">
              {visible.map((o) => (
                <OrgRow
                  key={o.slug}
                  org={o}
                  selected={selected?.slug === o.slug}
                  onSelect={() => setSelectedSlug(o.slug)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0">
          {selected ? <OrgDetail org={selected} /> : null}
        </section>
      </div>
    </>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 flex-[1_1_140px]">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full min-w-0 border border-ink/20 bg-paper px-2 text-sm font-medium text-ink outline-none focus:border-ink"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === ALL ? `All ${label.toLowerCase()}s` : o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex h-9 shrink-0 items-center justify-center gap-2 border px-3 text-sm font-black ${
        checked ? "border-ink bg-ink text-paper" : "border-ink/20"
      } min-w-[72px]`}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function StateMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-10 sm:px-6">
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-em">{body}</p>
    </div>
  );
}
