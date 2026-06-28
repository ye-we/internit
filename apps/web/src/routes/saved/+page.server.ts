import type { Actions, PageServerLoad } from "./$types";
import { db } from "$lib/server/db";
import { auth } from "$lib/auth";
import { redirect } from "@sveltejs/kit";
import {
  listingColumns,
  mapListing,
  toggleBookmark,
} from "$lib/server/listings";

export const load: PageServerLoad = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) redirect(302, "/sign-in");

  const rows = await db.query.bookmarks.findMany({
    where: (b, { eq }) => eq(b.userId, session.user.id),
    orderBy: (b, { desc }) => [desc(b.createdAt)],
    columns: {},
    with: { listing: { columns: listingColumns } },
  });

  const listings = rows.map((r) => mapListing(r.listing));

  return {
    listings,
    bookmarkedIds: listings.map((l) => l.id),
  };
};

export const actions: Actions = {
  toggleBookmark,
};
