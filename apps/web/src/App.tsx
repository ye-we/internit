import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Listing, Org } from "@rue/shared";

const ALL = "all";
type Mode = "listings" | "orgs";

export default function App() {
  const [mode, setMode] = useState<Mode>("listings");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOrgSlug, setSelectedOrgSlug] = useState<string | null>(null);
  const [field, setField] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [region, setRegion] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [publicOnly, setPublicOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [paidOnly, setPaidOnly] = useState(false);
  const [includeExpired, setIncludeExpired] = useState(false);

  const listingsQuery = useQuery({
    queryKey: ["listings", includeExpired],
    queryFn: () =>
      fetchListings({
        status: includeExpired ? "all" : "active",
      }),
  });

  const orgsQuery = useQuery({
    queryKey: ["orgs"],
    queryFn: fetchOrgs,
  });

  const listings = listingsQuery.data ?? [];
  const orgs = orgsQuery.data ?? [];
  const fields = useMemo(
    () => Array.from(new Set(listings.flatMap((listing) => listing.field_tags))).sort(),
    [listings],
  );
  const sources = useMemo(
    () => Array.from(new Set(listings.map((listing) => listing.source))).sort(),
    [listings],
  );
  const categories = useMemo(
    () => Array.from(new Set(orgs.map((org) => org.category))).sort(),
    [orgs],
  );
  const regions = useMemo(
    () => Array.from(new Set(orgs.map((org) => org.region).filter(Boolean) as string[])).sort(),
    [orgs],
  );
  const priorities = useMemo(
    () =>
      Array.from(
        new Set(orgs.map((org) => org.scrape_priority).filter(Boolean) as string[]),
      ).sort(sortPriority),
    [orgs],
  );

  const visibleListings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((listing) => {
      if (field !== ALL && !listing.field_tags.includes(field)) return false;
      if (source !== ALL && listing.source !== source) return false;
      if (paidOnly && listing.is_paid !== true) return false;
      if (!q) return true;
      return [
        listing.title,
        listing.org_name,
        listing.location ?? "",
        listing.source,
        listing.field_tags.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
      });
  }, [field, listings, paidOnly, query, source]);

  const visibleOrgs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orgs.filter((org) => {
      if (category !== ALL && org.category !== category) return false;
      if (region !== ALL && org.region !== region) return false;
      if (priority !== ALL && org.scrape_priority !== priority) return false;
      if (publicOnly && !["yes", "sometimes"].includes(org.posts_publicly)) return false;
      if (!q) return true;
      return [
        org.name,
        org.slug,
        org.category,
        org.region ?? "",
        org.notes ?? "",
        org.website ?? "",
        org.careers_url ?? "",
        org.internship_url ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [category, orgs, priority, publicOnly, query, region]);

  const selected =
    visibleListings.find((listing) => listing.id === selectedId) ??
    visibleListings[0] ??
    null;
  const selectedOrg =
    visibleOrgs.find((org) => org.slug === selectedOrgSlug) ?? visibleOrgs[0] ?? null;

  const activeCount =
    mode === "listings"
      ? `${visibleListings.length}/${listings.length} ${includeExpired ? "total" : "active"}`
      : `${visibleOrgs.length}/${orgs.length} orgs`;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-20 border-b border-ink/15 bg-paper/95 px-4 py-3 sm:px-6">
        <div className="mx-auto grid max-w-[1500px] gap-3 xl:grid-cols-[240px_minmax(0,1fr)] xl:items-center">
          <div className="flex items-baseline justify-between gap-4 xl:block">
            <div className="flex items-center gap-3 xl:block">
              <h1 className="font-display text-3xl font-black leading-none">Rue</h1>
              <div className="flex border border-ink/20 xl:mt-2">
                <ModeButton active={mode === "listings"} onClick={() => setMode("listings")}>
                  Listings
                </ModeButton>
                <ModeButton active={mode === "orgs"} onClick={() => setMode("orgs")}>
                  Orgs
                </ModeButton>
              </div>
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-em">
              {(mode === "listings" ? listingsQuery.isLoading : orgsQuery.isLoading)
                ? "Loading"
                : activeCount}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 min-w-0 flex-[1_1_240px] border border-ink/20 bg-paper px-3 text-sm font-medium outline-none focus:border-ink"
              placeholder={
                mode === "listings"
                  ? "Search title, org, location"
                  : "Search orgs, notes, URLs"
              }
              aria-label="Search"
            />
            {mode === "listings" ? (
              <>
                <Select
                  label="Field"
                  value={field}
                  onChange={(value) => {
                    setField(value);
                    setSelectedId(null);
                  }}
                  options={[ALL, ...fields]}
                />
                <Select
                  label="Source"
                  value={source}
                  onChange={(value) => {
                    setSource(value);
                    setSelectedId(null);
                  }}
                  options={[ALL, ...sources]}
                />
                <Toggle
                  label="Paid"
                  checked={paidOnly}
                  onChange={(checked) => {
                    setPaidOnly(checked);
                    setSelectedId(null);
                  }}
                />
                <Toggle
                  label="All"
                  checked={includeExpired}
                  onChange={(checked) => {
                    setIncludeExpired(checked);
                    setSelectedId(null);
                  }}
                />
              </>
            ) : (
              <>
                <Select
                  label="Category"
                  value={category}
                  onChange={(value) => {
                    setCategory(value);
                    setSelectedOrgSlug(null);
                  }}
                  options={[ALL, ...categories]}
                />
                <Select
                  label="Region"
                  value={region}
                  onChange={(value) => {
                    setRegion(value);
                    setSelectedOrgSlug(null);
                  }}
                  options={[ALL, ...regions]}
                />
                <Select
                  label="Priority"
                  value={priority}
                  onChange={(value) => {
                    setPriority(value);
                    setSelectedOrgSlug(null);
                  }}
                  options={[ALL, ...priorities]}
                />
                <Toggle
                  label="Public"
                  checked={publicOnly}
                  onChange={(checked) => {
                    setPublicOnly(checked);
                    setSelectedOrgSlug(null);
                  }}
                />
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[minmax(340px,30%)_minmax(0,1fr)]">
        <section className="border-b border-ink/15 lg:min-h-[calc(100vh-61px)] lg:border-b-0 lg:border-r">
          {mode === "listings" && listingsQuery.isError ? (
            <StateMessage
              title="Could not load listings"
              body="Check that the API server is running on port 8787."
            />
          ) : mode === "orgs" && orgsQuery.isError ? (
            <StateMessage
              title="Could not load orgs"
              body="Check that the API server is running on port 8787."
            />
          ) : mode === "listings" && visibleListings.length === 0 && !listingsQuery.isLoading ? (
            <StateMessage
              title="No matching listings"
              body="Clear a filter or run another scraper source."
            />
          ) : mode === "orgs" && visibleOrgs.length === 0 && !orgsQuery.isLoading ? (
            <StateMessage title="No matching orgs" body="Clear a filter or search term." />
          ) : (
            <div className="divide-y divide-ink/12">
              {mode === "listings"
                ? visibleListings.map((listing) => (
                    <ListingRow
                      key={listing.id}
                      listing={listing}
                      selected={selected?.id === listing.id}
                      onSelect={() => setSelectedId(listing.id)}
                    />
                  ))
                : visibleOrgs.map((org) => (
                    <OrgRow
                      key={org.slug}
                      org={org}
                      selected={selectedOrg?.slug === org.slug}
                      onSelect={() => setSelectedOrgSlug(org.slug)}
                    />
                  ))}
            </div>
          )}
        </section>

        <section className="min-w-0">
          {mode === "listings" && selected ? <Reader listing={selected} /> : null}
          {mode === "orgs" && selectedOrg ? <OrgDetail org={selectedOrg} /> : null}
        </section>
      </div>
    </main>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 px-2 text-xs font-black ${
        active ? "bg-ink text-paper" : "text-ink hover:bg-ink/[0.04]"
      }`}
    >
      {children}
    </button>
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
    <label className="min-w-0 flex-[1_1_150px]">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-0 border border-ink/20 bg-paper px-2 text-sm font-medium text-ink outline-none focus:border-ink"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === ALL ? `All ${label.toLowerCase()}s` : option}
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
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex h-9 items-center justify-center gap-2 border px-3 text-sm font-black ${
        checked ? "border-ink bg-ink text-paper" : "border-ink/20"
      } min-w-[72px] shrink-0`}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function ListingRow({
  listing,
  selected,
  onSelect,
}: {
  listing: Listing;
  selected: boolean;
  onSelect: () => void;
}) {
  const days = daysUntil(listing.deadline);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left sm:px-6 ${
        selected ? "bg-ink text-paper" : "hover:bg-ink/[0.04]"
      } ${listing.status !== "active" && !selected ? "opacity-60" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`shrink-0 text-[11px] font-black uppercase tracking-[0.12em] ${
              selected ? "text-paper/70" : "text-em"
            }`}
          >
            {listing.source}
          </span>
          <span className={selected ? "text-paper/35" : "text-ink/25"}>/</span>
          <span
            className={`truncate text-xs font-medium ${
              selected ? "text-paper/75" : "text-em"
            }`}
          >
            {listing.org_name}
          </span>
        </div>

        <h2 className="mt-1 truncate text-[15px] font-black leading-5 sm:text-base">
          {listing.title}
        </h2>

        <div
          className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
            selected ? "text-paper/75" : "text-em"
          }`}
        >
          <span>{compactDeadline(listing.deadline)}</span>
          <span>{listing.location ?? "Location unclear"}</span>
          <span>{payLabel(listing.is_paid)}</span>
          {listing.status !== "active" ? <span>{listing.status}</span> : null}
        </div>
      </div>

      <div className="grid justify-items-end gap-2">
        <span className="border border-current px-2 py-1 text-xs font-black leading-none">
          {listing.fit_score}
        </span>
        <span
          className={`text-xs font-black ${
            days !== null && days <= 7
              ? selected
                ? "text-paper"
                : "text-ink"
              : selected
                ? "text-paper/60"
                : "text-em"
          }`}
        >
          {daysLabel(days)}
        </span>
      </div>
    </button>
  );
}

function OrgRow({
  org,
  selected,
  onSelect,
}: {
  org: Org;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left sm:px-6 ${
        selected ? "bg-ink text-paper" : "hover:bg-ink/[0.04]"
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`shrink-0 text-[11px] font-black uppercase tracking-[0.12em] ${
              selected ? "text-paper/70" : "text-em"
            }`}
          >
            {org.category}
          </span>
          <span className={selected ? "text-paper/35" : "text-ink/25"}>/</span>
          <span
            className={`truncate text-xs font-medium ${
              selected ? "text-paper/75" : "text-em"
            }`}
          >
            {org.region ?? "global"}
          </span>
        </div>
        <h2 className="mt-1 truncate text-[15px] font-black leading-5 sm:text-base">
          {org.name}
        </h2>
        <div
          className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
            selected ? "text-paper/75" : "text-em"
          }`}
        >
          <span>posts {org.posts_publicly}</span>
          <span>{remoteLabel(org.has_remote)}</span>
          <span>{paidOrgLabel(org.has_paid)}</span>
        </div>
      </div>
      <div className="grid justify-items-end gap-2">
        <span className="border border-current px-2 py-1 text-xs font-black leading-none">
          {org.scrape_priority ?? "-"}
        </span>
        <span className={`text-xs font-black ${selected ? "text-paper/60" : "text-em"}`}>
          {org.addis_office === true ? "Addis" : org.addis_office === false ? "No office" : "-"}
        </span>
      </div>
    </button>
  );
}

function Reader({ listing }: { listing: Listing }) {
  const scrollRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    if (window.innerWidth < 1024) {
      scrollRef.current?.scrollIntoView({ block: "start" });
    }
  }, [listing.id]);

  return (
    <article
      ref={scrollRef}
      className="lg:sticky lg:top-[61px] lg:max-h-[calc(100vh-61px)] lg:overflow-y-auto"
    >
      <div className="border-b border-ink/15 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-em">
          <span>{listing.source}</span>
          <span>/</span>
          <span>{listing.org_name}</span>
        </div>

        <h2 className="mt-2 font-serif text-3xl leading-tight sm:text-4xl">
          {listing.title}
        </h2>

        <div className="mt-4 grid gap-px border border-ink/15 bg-ink/15 sm:grid-cols-5">
          <Meta label="Deadline" value={compactDeadline(listing.deadline)} />
          <Meta label="Days" value={daysLabel(daysUntil(listing.deadline))} />
          <Meta label="Pay" value={payLabel(listing.is_paid)} />
          <Meta label="Fit" value={`${listing.fit_score}`} />
          <Meta label="Status" value={listing.status} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {listing.field_tags.map((tag) => (
            <span key={tag} className="border border-ink/20 px-2 py-1 text-xs font-medium">
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href={listing.source_url}
            className="inline-flex h-9 items-center border border-ink bg-ink px-4 text-sm font-black text-paper"
            target="_blank"
            rel="noreferrer"
          >
            Open source
          </a>
          <span className="text-xs text-em">
            scraped {formatDate(listing.scraped_at)}
          </span>
        </div>
      </div>

      <div
        className="reader-body px-4 py-5 sm:px-6"
        dangerouslySetInnerHTML={{ __html: listing.description_html }}
      />
    </article>
  );
}

function OrgDetail({ org }: { org: Org }) {
  const scrollRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    if (window.innerWidth < 1024) {
      scrollRef.current?.scrollIntoView({ block: "start" });
    }
  }, [org.slug]);

  return (
    <article
      ref={scrollRef}
      className="lg:sticky lg:top-[61px] lg:max-h-[calc(100vh-61px)] lg:overflow-y-auto"
    >
      <div className="border-b border-ink/15 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-em">
          <span>{org.category}</span>
          <span>/</span>
          <span>{org.region ?? "global"}</span>
        </div>
        <h2 className="mt-2 font-serif text-3xl leading-tight sm:text-5xl">
          {org.name}
        </h2>

        <div className="mt-4 grid gap-px border border-ink/15 bg-ink/15 sm:grid-cols-5">
          <Meta label="Priority" value={org.scrape_priority ?? "-"} />
          <Meta label="Posts" value={org.posts_publicly} />
          <Meta label="Remote" value={remoteLabel(org.has_remote)} />
          <Meta label="Paid" value={paidOrgLabel(org.has_paid)} />
          <Meta
            label="Addis"
            value={org.addis_office === true ? "yes" : org.addis_office === false ? "no" : "-"}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <OrgLink label="Website" href={org.website} />
          <OrgLink label="Careers" href={org.careers_url} />
          <OrgLink label="Internships" href={org.internship_url} />
          {org.application_email ? (
            <a
              href={`mailto:${org.application_email}`}
              className="inline-flex h-9 items-center border border-ink px-4 text-sm font-black"
            >
              Email
            </a>
          ) : null}
        </div>
      </div>

      <div className="px-4 py-5 sm:px-6">
        <section className="border-b border-ink/15 pb-5">
          <h3 className="text-sm font-black uppercase tracking-[0.14em]">Notes</h3>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-em">
            {org.notes || "No notes yet."}
          </p>
        </section>

        <dl className="mt-5 grid gap-px border border-ink/15 bg-ink/15 md:grid-cols-2">
          <OrgContact label="Twitter" value={org.twitter} />
          <OrgContact label="LinkedIn" value={org.linkedin} />
          <OrgContact label="Telegram" value={org.telegram} />
          <OrgContact label="Slug" value={org.slug} />
        </dl>
      </div>
    </article>
  );
}

function OrgLink({ label, href }: { label: string; href: string | null }) {
  if (!href) return null;
  return (
    <a
      href={href}
      className="inline-flex h-9 items-center border border-ink bg-ink px-4 text-sm font-black text-paper"
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  );
}

function OrgContact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 bg-paper p-3">
      <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-em">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium">{value || "-"}</dd>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper px-3 py-2">
      <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-em">
        {label}
      </dt>
      <dd className="mt-1 truncate text-xs font-black">{value}</dd>
    </div>
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

async function fetchListings(filters: {
  status?: "active" | "all";
}): Promise<Listing[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (filters.status) params.set("status", filters.status);

  const res = await fetch(`/api/listings?${params.toString()}`);
  if (!res.ok) throw new Error(`GET /api/listings failed: ${res.status}`);
  return (await res.json()) as Listing[];
}

async function fetchOrgs(): Promise<Org[]> {
  const res = await fetch("/api/orgs");
  if (!res.ok) throw new Error(`GET /api/orgs failed: ${res.status}`);
  return (await res.json()) as Org[];
}

function formatDate(raw: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(raw));
}

function compactDeadline(raw: string | null): string {
  if (!raw) return "No deadline";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(raw));
}

function daysUntil(raw: string | null): number | null {
  if (!raw) return null;
  return Math.ceil((new Date(raw).getTime() - Date.now()) / 86_400_000);
}

function daysLabel(days: number | null): string {
  if (days === null) return "-";
  if (days < 0) return "expired";
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

function payLabel(value: boolean | null): string {
  if (value === true) return "Paid";
  if (value === false) return "Unpaid";
  return "Pay unclear";
}

function remoteLabel(value: Org["has_remote"]): string {
  if (value === "yes") return "remote";
  if (value === "sometimes") return "some remote";
  if (value === "no") return "not remote";
  return "remote unclear";
}

function paidOrgLabel(value: Org["has_paid"]): string {
  if (value === "yes") return "paid";
  if (value === "sometimes") return "sometimes paid";
  if (value === "no") return "unpaid";
  return "pay unclear";
}

function sortPriority(a: string, b: string): number {
  const order = ["critical", "high", "medium", "low"];
  return order.indexOf(a) - order.indexOf(b);
}
