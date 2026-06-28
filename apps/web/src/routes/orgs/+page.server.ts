import type { PageServerLoad } from "./$types";
import { db } from "$lib/server/db";
import { daysLabel } from "$lib/utils";

const shortDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export const load: PageServerLoad = async () => {
  const rows = await db.query.orgs.findMany({
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

  const orgs = rows.map((o) => ({
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
    listings: o.listings.map((l) => ({
      id: l.id,
      title: l.title,
      date: shortDate(l.deadline),
      status: daysLabel(l.deadline),
      location: l.location ?? "—",
      pay: l.isPaid === false ? "Unpaid" : (l.stipendText ?? "Pay unclear"),
      fit: l.fitScore,
      sourceUrl: l.sourceUrl,
    })),
  }));

  return { orgs };
};
