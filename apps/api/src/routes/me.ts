import { Hono } from "hono";
import { and, asc, desc, eq, getDb, bookmarks, reminders, listings } from "@rue/db";
import type { Context } from "hono";
import { auth } from "../lib/auth.js";
import { toListingResponse } from "../lib/format.js";

const me = new Hono();

async function getUserId(c: Context): Promise<string | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user.id ?? null;
}

me.get("/api/me/bookmarks", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const rows = await getDb()
    .select({ listing: listings })
    .from(bookmarks)
    .innerJoin(listings, eq(bookmarks.listingId, listings.id))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt));
  return c.json(rows.map(({ listing }) => toListingResponse(listing)));
});

me.get("/api/me/reminders", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const rows = await getDb()
    .select({ listing: listings, reminder: reminders })
    .from(reminders)
    .innerJoin(listings, eq(reminders.listingId, listings.id))
    .where(eq(reminders.userId, userId))
    .orderBy(asc(reminders.remindAt));
  return c.json(
    rows.map(({ listing, reminder }) => ({
      ...toListingResponse(listing),
      reminder: {
        id: reminder.id,
        remind_at: reminder.remindAt.toISOString(),
        note: reminder.note,
      },
    })),
  );
});

me.post("/api/listings/:id/bookmark", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const listingId = c.req.param("id");
  await getDb().insert(bookmarks).values({ userId, listingId }).onConflictDoNothing();
  return c.json({ ok: true });
});

me.delete("/api/listings/:id/bookmark", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const listingId = c.req.param("id");
  await getDb()
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.listingId, listingId)));
  return c.json({ ok: true });
});

me.post("/api/listings/:id/reminder", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const listingId = c.req.param("id");
  const body = await c.req.json<{ remind_at: string; note?: string }>();
  const remindAt = new Date(body.remind_at);
  if (isNaN(remindAt.getTime())) return c.json({ error: "Invalid remind_at" }, 400);
  await getDb()
    .insert(reminders)
    .values({ userId, listingId, remindAt, note: body.note ?? null })
    .onConflictDoUpdate({
      target: [reminders.userId, reminders.listingId],
      set: { remindAt, note: body.note ?? null },
    });
  return c.json({ ok: true });
});

me.delete("/api/listings/:id/reminder", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const listingId = c.req.param("id");
  await getDb()
    .delete(reminders)
    .where(and(eq(reminders.userId, userId), eq(reminders.listingId, listingId)));
  return c.json({ ok: true });
});

export { me };
