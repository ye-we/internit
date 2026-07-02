// Fast, frequent deactivation of listings whose deadline has passed. One indexed
// UPDATE — no row scan, no Gemini — so it's cheap to run every few hours and the
// site never shows a closed listing for long. The heavier reconciliation (stale
// feeds, recovered deadlines, purging long-dead rows) stays in the nightly
// prune:expired. Deactivating (not deleting) keeps history and users' saves.

import { and, closeDb, eq, getDb, isNotNull, listings, lt } from "@internit/db";

const updated = await getDb()
  .update(listings)
  .set({ status: "expired" })
  .where(
    and(
      eq(listings.status, "active"),
      isNotNull(listings.deadline),
      lt(listings.deadline, new Date()),
    ),
  )
  .returning({ id: listings.id });

console.error(`[deactivate-expired] deactivated ${updated.length} past-deadline listing(s)`);

await closeDb();
