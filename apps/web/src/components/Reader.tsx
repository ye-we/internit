import { useEffect, useRef } from "react";
import type { Listing } from "@rue/shared";
import { daysUntil, daysLabel, compactDeadline, payLabel, formatDate } from "../lib/utils.js";
import { BookmarkButton, ReminderButton, ShareButton } from "./actions.js";

export function Reader({ listing }: { listing: Listing }) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const structured = listing.structured;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    if (window.innerWidth < 1024) {
      scrollRef.current?.scrollIntoView({ block: "start" });
    }
  }, [listing.id]);

  return (
    <article
      ref={scrollRef}
      className="lg:sticky lg:top-[49px] lg:max-h-[calc(100vh-49px)] lg:overflow-y-auto"
    >
      <div className="border-b border-ink/15 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-em">
          <span>{listing.source}</span>
          <span>/</span>
          <span>{listing.org_name}</span>
        </div>

        <h2 className="mt-2 font-serif text-3xl leading-tight sm:text-4xl">{listing.title}</h2>

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

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a
            href={structured?.application_url ?? listing.source_url}
            className="inline-flex h-9 items-center border border-ink bg-ink px-4 text-sm font-black text-paper"
            target="_blank"
            rel="noreferrer"
          >
            {structured?.application_url ? "Apply" : "Open source"}
          </a>
          {structured?.application_email ? (
            <a
              href={`mailto:${structured.application_email}`}
              className="inline-flex h-9 items-center border border-ink px-4 text-sm font-black"
            >
              Email
            </a>
          ) : null}
          <div className="flex items-center gap-1.5">
            <BookmarkButton listing={listing} variant="detail" />
            <ReminderButton listing={listing} variant="detail" />
            <ShareButton listing={listing} variant="detail" />
          </div>
          <span className="text-xs text-em">scraped {formatDate(listing.scraped_at)}</span>
        </div>
      </div>

      {structured ? <StructuredReader listing={structured} /> : null}

      {structured?.sections.length ? (
        <ReaderSections sections={structured.sections} />
      ) : null}

      <section className="px-4 py-5 sm:px-6">
        <h3 className="text-sm font-black uppercase tracking-[0.14em] text-em">Full posting</h3>
        <div
          className="reader-body mt-4"
          dangerouslySetInnerHTML={{ __html: listing.description_html }}
        />
      </section>
    </article>
  );
}

function StructuredReader({ listing }: { listing: NonNullable<Listing["structured"]> }) {
  return (
    <div className="border-b border-ink/15 px-4 py-5 sm:px-6">
      <section>
        <h3 className="text-sm font-black uppercase tracking-[0.14em]">Summary</h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-em">{listing.summary}</p>
      </section>

      <section className="mt-5 border-t border-ink/15 pt-5">
        <h3 className="text-sm font-black uppercase tracking-[0.14em]">Ethiopia Fit</h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-em">
          <span className="font-black text-ink">{ethiopiaAccessLabel(listing.ethiopia_access)}. </span>
          {listing.ethiopia_access_reason}
        </p>
      </section>

      {listing.how_to_apply ? (
        <section className="mt-5 border-t border-ink/15 pt-5">
          <h3 className="text-sm font-black uppercase tracking-[0.14em]">How To Apply</h3>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-em">{listing.how_to_apply}</p>
        </section>
      ) : null}

      <div className="mt-5 grid gap-5 border-t border-ink/15 pt-5 md:grid-cols-2">
        <StructuredList title="Requirements" items={listing.requirements} />
        <StructuredList title="Responsibilities" items={listing.responsibilities} />
      </div>

      {listing.warnings.length > 0 ? (
        <section className="mt-5 border-t border-ink/15 pt-5">
          <h3 className="text-sm font-black uppercase tracking-[0.14em]">Notes</h3>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-em">
            {listing.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ReaderSections({
  sections,
}: {
  sections: NonNullable<Listing["structured"]>["sections"];
}) {
  return (
    <div className="border-b border-ink/15 px-4 py-5 sm:px-6">
      {sections.map((section) => (
        <section
          key={section.title}
          className="border-b border-ink/15 py-5 first:pt-0 last:border-b-0 last:pb-0"
        >
          <h3 className="font-display text-xl font-black leading-tight">{section.title}</h3>
          <div className="mt-3 max-w-3xl space-y-3">
            {section.paragraphs.map((p) => (
              <p key={p} className="text-sm leading-6 text-em">
                {p}
              </p>
            ))}
            {section.bullets.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-em">
                {section.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

function StructuredList({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3 className="text-sm font-black uppercase tracking-[0.14em]">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-em">
          {items.slice(0, 8).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-em">Not clearly stated.</p>
      )}
    </section>
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

function ethiopiaAccessLabel(value: NonNullable<Listing["structured"]>["ethiopia_access"]): string {
  if (value === "ethiopia-based") return "Ethiopia-based";
  if (value === "remote") return "Remote-accessible";
  if (value === "sponsored-abroad") return "Abroad with support";
  if (value === "open-but-self-funded-abroad") return "Abroad, likely self-funded";
  if (value === "not-realistic") return "Not realistic from Ethiopia";
  return "Access unclear";
}
