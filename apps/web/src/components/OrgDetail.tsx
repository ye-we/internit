import { useEffect, useRef } from "react";
import type { Org } from "@rue/shared";

export function OrgDetail({ org }: { org: Org }) {
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
      className="lg:sticky lg:top-[49px] lg:max-h-[calc(100vh-49px)] lg:overflow-y-auto"
    >
      <div className="border-b border-ink/15 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-em">
          <span>{org.category}</span>
          <span>/</span>
          <span>{org.region ?? "global"}</span>
        </div>
        <h2 className="mt-2 font-serif text-3xl leading-tight sm:text-5xl">{org.name}</h2>

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
          <p className="mt-3 max-w-3xl text-sm leading-6 text-em">{org.notes || "No notes yet."}</p>
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
      <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-em">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{value || "-"}</dd>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper px-3 py-2">
      <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-em">{label}</dt>
      <dd className="mt-1 truncate text-xs font-black">{value}</dd>
    </div>
  );
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
