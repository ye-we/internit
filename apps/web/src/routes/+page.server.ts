import type { Actions, PageServerLoad } from "./$types";
import { db } from "$lib/server/db";
import { auth } from "$lib/auth";
import {
  listingColumns,
  mapListing,
  getBookmarkedIds,
  toggleBookmark,
} from "$lib/server/listings";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ request, url }) => {
  // Active AND not past its deadline — the deadline guard means a freshly-closed
  // listing drops off immediately, even between cleanup-cron ticks.
  const rows = await db.query.listings.findMany({
    where: (l, { and, eq, or, isNull, gte }) =>
      and(eq(l.status, "active"), or(isNull(l.deadline), gte(l.deadline, new Date()))),
    orderBy: (l, { asc, desc }) => [desc(l.fitScore), asc(l.deadline)],
    limit: 50,
    columns: listingColumns,
  });

  // Channel "Read" deep links (/?listing=<id>) can target a listing outside the
  // top 50 — or one that has since expired — so fetch it explicitly and surface
  // it at the top, letting the board focus it.
  const focusId = url.searchParams.get("listing");
  if (focusId && UUID_RE.test(focusId) && !rows.some((r) => r.id === focusId)) {
    // Expired listings stay reachable (old channel links), but hidden ones are
    // pulled deliberately (e.g. CSO safety) and must not resolve by UUID.
    const focus = await db.query.listings.findFirst({
      where: (l, { eq, ne, and }) => and(eq(l.id, focusId), ne(l.status, "hidden")),
      columns: listingColumns,
    });
    if (focus) rows.unshift(focus);
  }

  const session = await auth.api.getSession({ headers: request.headers });

  return {
    listings: rows.map(mapListing),
    bookmarkedIds: await getBookmarkedIds(session?.user?.id),
  };
};

export const actions: Actions = {
  toggleBookmark,
};
