import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Listing } from "@rue/shared";
import { ListingRow } from "../components/ListingRow.js";
import { Reader } from "../components/Reader.js";

const ALL = "all";

export function Discover() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [field, setField] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [paidOnly, setPaidOnly] = useState(false);
  const [includeExpired, setIncludeExpired] = useState(false);
  const [query, setQuery] = useState("");

  const listingsQuery = useQuery({
    queryKey: ["listings", includeExpired],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      params.set("status", includeExpired ? "all" : "active");
      return fetch(`/api/listings?${params}`).then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Listing[]>;
      });
    },
  });

  const listings = listingsQuery.data ?? [];
  const fields = useMemo(
    () => Array.from(new Set(listings.flatMap((l) => l.field_tags))).sort(),
    [listings],
  );
  const sources = useMemo(
    () => Array.from(new Set(listings.map((l) => l.source))).sort(),
    [listings],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (field !== ALL && !l.field_tags.includes(field)) return false;
      if (source !== ALL && l.source !== source) return false;
      if (paidOnly && l.is_paid !== true) return false;
      if (!q) return true;
      return [l.title, l.org_name, l.location ?? "", l.source, l.field_tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [listings, field, source, paidOnly, query]);

  const selected = visible.find((l) => l.id === selectedId) ?? visible[0] ?? null;

  const countLabel = listingsQuery.isLoading
    ? "Loading"
    : `${visible.length}/${listings.length} ${includeExpired ? "total" : "active"}`;

  return (
    <>
      <div className="sticky top-12 z-10 border-b border-ink/15 bg-paper/95 px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 min-w-0 flex-[1_1_200px] border border-ink/20 bg-paper px-3 text-sm font-medium outline-none focus:border-ink"
            placeholder="Search title, org, location"
            aria-label="Search listings"
          />
          <Select
            label="Field"
            value={field}
            onChange={(v) => { setField(v); setSelectedId(null); }}
            options={[ALL, ...fields]}
          />
          <Select
            label="Source"
            value={source}
            onChange={(v) => { setSource(v); setSelectedId(null); }}
            options={[ALL, ...sources]}
          />
          <Toggle
            label="Paid"
            checked={paidOnly}
            onChange={(v) => { setPaidOnly(v); setSelectedId(null); }}
          />
          <Toggle
            label="All"
            checked={includeExpired}
            onChange={(v) => { setIncludeExpired(v); setSelectedId(null); }}
          />
          <span className="ml-auto shrink-0 text-xs font-medium uppercase tracking-[0.14em] text-em">
            {countLabel}
          </span>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[minmax(340px,30%)_minmax(0,1fr)]">
        <section className="border-b border-ink/15 lg:min-h-[calc(100vh-97px)] lg:border-b-0 lg:border-r">
          {listingsQuery.isError ? (
            <StateMessage
              title="Could not load listings"
              body="Check that the API server is running on port 8787."
            />
          ) : visible.length === 0 && !listingsQuery.isLoading ? (
            <StateMessage title="No matching listings" body="Clear a filter or run another scraper." />
          ) : (
            <div className="divide-y divide-ink/10">
              {visible.map((l) => (
                <ListingRow
                  key={l.id}
                  listing={l}
                  selected={selected?.id === l.id}
                  onSelect={() => setSelectedId(l.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0">
          {selected ? <Reader listing={selected} /> : null}
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
