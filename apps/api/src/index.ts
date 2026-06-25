import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import {
  and,
  asc,
  desc,
  eq,
  getDb,
  gte,
  ilike,
  listings,
  orgs,
  sql,
} from "@rue/db";
import { ListingsQuerySchema } from "@rue/shared";
import { auth, trustedOrigins } from "./lib/auth.js";
import { toListingResponse, toOrgResponse } from "./lib/format.js";
import { me } from "./routes/me.js";
import { admin } from "./routes/admin.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return null;
      return trustedOrigins.includes(origin) ? origin : null;
    },
    credentials: true,
  }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/", me);
app.route("/", admin);

app.get("/api/health", (c) =>
  c.json({ ok: true, ts: new Date().toISOString() }),
);

app.get("/api/listings", async (c) => {
  const parsed = ListingsQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
  }

  const query = parsed.data;
  const filters = [];
  if (query.status !== "all") {
    filters.push(eq(listings.status, query.status));
  }
  if (query.field) {
    filters.push(sql`${query.field} = any(${listings.fieldTags})`);
  }
  if (query.paid === "true") filters.push(eq(listings.isPaid, true));
  if (query.paid === "false") filters.push(eq(listings.isPaid, false));
  if (query.remote === "true") filters.push(eq(listings.isRemote, true));
  if (query.remote === "false") filters.push(eq(listings.isRemote, false));
  if (query.deadline_within) {
    filters.push(gte(listings.deadline, new Date()));
    filters.push(
      sql`${listings.deadline} <= now() + (${query.deadline_within} || ' days')::interval`,
    );
  }

  const rows = await getDb()
    .select()
    .from(listings)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(listings.fitScore), asc(listings.deadline), desc(listings.scrapedAt))
    .limit(query.limit)
    .offset(query.offset);

  return c.json(rows.map(toListingResponse));
});

app.get("/api/listings/:id", async (c) => {
  const id = c.req.param("id");
  const rows = await getDb().select().from(listings).where(eq(listings.id, id)).limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "Listing not found" }, 404);
  return c.json(toListingResponse(row));
});

app.get("/api/orgs", async (c) => {
  const search = c.req.query("q")?.trim();
  const category = c.req.query("category")?.trim();
  const priority = c.req.query("priority")?.trim();

  const filters = [];
  if (search) filters.push(ilike(orgs.name, `%${search}%`));
  if (category) filters.push(eq(orgs.category, category));
  if (priority) filters.push(eq(orgs.scrapePriority, priority));

  const rows = await getDb()
    .select()
    .from(orgs)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(orgs.name))
    .limit(250);

  return c.json(rows.map(toOrgResponse));
});

app.get("/api/orgs/:slug", async (c) => {
  const slug = c.req.param("slug");
  const rows = await getDb().select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "Org not found" }, 404);
  return c.json(toOrgResponse(row));
});

app.post("/api/scrape/trigger", async (c) => {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: "ADMIN_TOKEN not configured" }, 503);

  const authHeader = c.req.header("authorization") ?? "";
  if (authHeader !== `Bearer ${expected}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { EthioNGOJobsSource, PoliteFetcher, UndpSource, UnCareersSource, persistListings } =
    await import("@rue/scraper");
  const max = Number(c.req.query("max") ?? 20);
  const sourceName = c.req.query("source") ?? "ethiongojobs";
  const ignoreRobots = c.req.query("ignore_robots") === "true";
  const fetcher = new PoliteFetcher({ respectRobots: !ignoreRobots });
  const source =
    sourceName === "un-careers"
      ? new UnCareersSource()
      : sourceName === "undp"
        ? new UndpSource(fetcher)
        : sourceName === "ethiongojobs"
          ? new EthioNGOJobsSource(fetcher)
          : null;
  if (!source) return c.json({ error: `Unknown source: ${sourceName}` }, 400);
  const scraped = await source.scrape({ max: Math.min(Math.max(max, 1), 100) });
  const result = await persistListings(source.name, scraped);
  return c.json(result);
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

export type AppType = typeof app;
