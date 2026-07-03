import type { PageServerLoad } from "./$types";
import { db } from "$lib/server/db";
import { listings as listingsTable } from "@internit/db/schema";
import { and, desc, isNotNull, ne } from "drizzle-orm";
import { daysLabel } from "$lib/utils";

const shortDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

// Curated-priority tiebreaker for the actionability ranking.
const PRIORITY_BONUS: Record<string, number> = { critical: 8, high: 4, medium: 2 };

export const load: PageServerLoad = async () => {
  const rows = await db.query.orgs.findMany({
    // Aggregators (ethiongojobs etc.) are scrape sources, not outreach targets —
    // they don't belong in a directory of employers to contact.
    where: (o, { ne }) => ne(o.category, "aggregator"),
    orderBy: (o, { asc }) => [asc(o.name)],
    columns: {
      slug: true,
      name: true,
      category: true,
      region: true,
      addisOffice: true,
      website: true,
      careersUrl: true,
      internshipUrl: true,
      applicationEmail: true,
      twitter: true,
      linkedin: true,
      telegram: true,
      hasRemote: true,
      hasPaid: true,
      scrapePriority: true,
      notes: true,
    },
    with: {
      listings: {
        where: (l, { eq }) => eq(l.status, "active"),
        orderBy: (l, { asc, desc }) => [desc(l.fitScore), asc(l.deadline)],
        limit: 25,
        columns: {
          id: true,
          title: true,
          deadline: true,
          location: true,
          isPaid: true,
          stipendText: true,
          fitScore: true,
          sourceUrl: true,
        },
      },
    },
  });

  // Posting history: past (non-active) listings per org — evidence of whether
  // and when an org actually takes interns, which is exactly what a student
  // weighing cold outreach needs. Small table, grouped in JS, capped per org.
  const past = await db
    .select({
      orgSlug: listingsTable.orgSlug,
      title: listingsTable.title,
      deadline: listingsTable.deadline,
      scrapedAt: listingsTable.scrapedAt,
    })
    .from(listingsTable)
    .where(and(isNotNull(listingsTable.orgSlug), ne(listingsTable.status, "active")))
    .orderBy(desc(listingsTable.scrapedAt));
  const pastByOrg = new Map<string, { title: string; when: string }[]>();
  for (const p of past) {
    const list = pastByOrg.get(p.orgSlug!) ?? [];
    if (list.length < 4) {
      list.push({ title: p.title, when: shortDate(p.deadline ?? p.scrapedAt) });
      pastByOrg.set(p.orgSlug!, list);
    }
  }

  const orgs = rows
    .map((o) => ({
      slug: o.slug,
      name: o.name,
      category: o.category,
      region: o.region ?? "—",
      addisOffice: o.addisOffice ?? false,
      website: o.website,
      careersUrl: o.careersUrl,
      internshipUrl: o.internshipUrl,
      applicationEmail: o.applicationEmail,
      twitter: o.twitter,
      linkedin: o.linkedin,
      telegram: o.telegram,
      hasRemote: o.hasRemote ?? "—",
      hasPaid: o.hasPaid ?? "—",
      notes: o.notes,
      activeCount: o.listings.length,
      pastListings: pastByOrg.get(o.slug) ?? [],
      // Actionability: what can a student DO with this org right now? Hiring
      // beats a direct email beats an internship page beats an Addis office
      // beats a careers page; curated scrape_priority breaks ties.
      reach:
        (o.listings.length > 0 ? 100 : 0) +
        (o.applicationEmail ? 40 : 0) +
        (o.internshipUrl ? 30 : 0) +
        (o.addisOffice ? 15 : 0) +
        (o.careersUrl ? 10 : 0) +
        (PRIORITY_BONUS[o.scrapePriority ?? ""] ?? 0) +
        (o.notes ? 2 : 0),
      listings: o.listings.map((l) => ({
        id: l.id,
        title: l.title,
        date: l.deadline ? shortDate(l.deadline) : "Rolling",
        status: daysLabel(l.deadline),
        location: l.location ?? "—",
        pay: l.isPaid === false ? "Unpaid" : (l.stipendText ?? "Pay unclear"),
        fit: l.fitScore,
        sourceUrl: l.sourceUrl,
      })),
    }))
    // Best-first is the default order; the page offers A–Z as a secondary sort.
    .sort((a, b) => b.reach - a.reach || a.name.localeCompare(b.name));

  return { orgs };
};
