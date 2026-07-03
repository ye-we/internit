// Private, admin-only analytics: first-party traffic (page_events) + product
// metrics (listings, subscribers, saves, channel posts, scrape runs). Gated on
// the user table's role column — promote yourself once with:
//   UPDATE "user" SET role='admin' WHERE email='<you>';

import { db } from "$lib/server/db";
import { auth } from "$lib/auth";
import { readProcessLogs } from "$lib/server/ops";
import { error, redirect } from "@sveltejs/kit";
import { sql } from "drizzle-orm";
import type { PageServerLoad } from "./$types";

const DAY = 86_400_000;

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(q);
  return (res as unknown as { rows: T[] }).rows;
}

export const load: PageServerLoad = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) redirect(307, "/sign-in");
  const [me] = await rows<{ role: string }>(
    sql`SELECT role FROM "user" WHERE id = ${session.user.id}`,
  );
  if (me?.role !== "admin") error(404, "Not found"); // hide the page's existence

  // --- traffic ---------------------------------------------------------------
  const daily = await rows<{ day: string; views: number; visitors: number }>(sql`
    SELECT (ts AT TIME ZONE 'Africa/Addis_Ababa')::date::text AS day,
           count(*)::int AS views,
           count(DISTINCT visitor_hash)::int AS visitors
    FROM page_events
    WHERE type = 'pageview' AND ts > now() - interval '30 days'
    GROUP BY 1 ORDER BY 1`);

  // Zero-fill the 30-day window so the chart has a bar per day.
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.now() - (29 - i) * DAY).toISOString().slice(0, 10);
    return byDay.get(day) ?? { day, views: 0, visitors: 0 };
  });

  const [totals] = await rows<{
    views30: number; visitors30: number; views7: number; visitors7: number;
    tg30: number; applies30: number;
  }>(sql`
    SELECT
      count(*) FILTER (WHERE type='pageview' AND ts > now() - interval '30 days')::int AS views30,
      count(DISTINCT visitor_hash) FILTER (WHERE type='pageview' AND ts > now() - interval '30 days')::int AS visitors30,
      count(*) FILTER (WHERE type='pageview' AND ts > now() - interval '7 days')::int AS views7,
      count(DISTINCT visitor_hash) FILTER (WHERE type='pageview' AND ts > now() - interval '7 days')::int AS visitors7,
      count(DISTINCT visitor_hash) FILTER (WHERE type='pageview' AND ref='tg' AND ts > now() - interval '30 days')::int AS tg30,
      count(*) FILTER (WHERE type='apply_click' AND ts > now() - interval '30 days')::int AS applies30
    FROM page_events`);

  const topViewed = await rows<{ title: string; org: string; views: number }>(sql`
    SELECT l.title, l.org_name AS org, count(*)::int AS views
    FROM page_events e JOIN listings l ON l.id = e.listing_id
    WHERE e.type IN ('listing_view','pageview') AND e.listing_id IS NOT NULL
      AND e.ts > now() - interval '30 days'
    GROUP BY 1, 2 ORDER BY views DESC LIMIT 8`);

  const topApplied = await rows<{ title: string; org: string; clicks: number }>(sql`
    SELECT l.title, l.org_name AS org, count(*)::int AS clicks
    FROM page_events e JOIN listings l ON l.id = e.listing_id
    WHERE e.type = 'apply_click' AND e.ts > now() - interval '30 days'
    GROUP BY 1, 2 ORDER BY clicks DESC LIMIT 8`);

  const referrers = await rows<{ ref: string; visitors: number }>(sql`
    SELECT coalesce(ref, 'direct') AS ref, count(DISTINCT visitor_hash)::int AS visitors
    FROM page_events
    WHERE type='pageview' AND ts > now() - interval '30 days'
    GROUP BY 1 ORDER BY visitors DESC LIMIT 8`);

  const devices = await rows<{ device: string; visitors: number }>(sql`
    SELECT coalesce(device, 'unknown') AS device, count(DISTINCT visitor_hash)::int AS visitors
    FROM page_events
    WHERE type='pageview' AND ts > now() - interval '30 days'
    GROUP BY 1 ORDER BY visitors DESC`);

  const countries = await rows<{ country: string; visitors: number }>(sql`
    SELECT country, count(DISTINCT visitor_hash)::int AS visitors
    FROM page_events
    WHERE type='pageview' AND country IS NOT NULL AND ts > now() - interval '30 days'
    GROUP BY 1 ORDER BY visitors DESC`);

  // Hour × weekday activity (EAT) — when students actually browse, i.e. when
  // the channel should post. isodow: 1=Mon … 7=Sun.
  const heat = await rows<{ dow: number; hr: number; n: number }>(sql`
    SELECT extract(isodow FROM ts AT TIME ZONE 'Africa/Addis_Ababa')::int AS dow,
           extract(hour FROM ts AT TIME ZONE 'Africa/Addis_Ababa')::int AS hr,
           count(*)::int AS n
    FROM page_events
    WHERE type IN ('pageview','listing_view','apply_click')
      AND ts > now() - interval '30 days'
    GROUP BY 1, 2`);

  // Funnel (30d, unique visitors): arrived → opened a listing → clicked apply.
  // Deep-link arrivals count as "opened" (their pageview carries a listing_id).
  const [funnel] = await rows<{ visited: number; opened: number; applied: number }>(sql`
    SELECT
      count(DISTINCT visitor_hash) FILTER (WHERE type='pageview')::int AS visited,
      count(DISTINCT visitor_hash) FILTER (
        WHERE type='listing_view' OR (type='pageview' AND listing_id IS NOT NULL))::int AS opened,
      count(DISTINCT visitor_hash) FILTER (WHERE type='apply_click')::int AS applied
    FROM page_events WHERE ts > now() - interval '30 days'`);

  // Telegram-side events, written by the bot.
  const [tg] = await rows<{ subs30: number; saves30: number; savesDeeplink: number }>(sql`
    SELECT
      count(*) FILTER (WHERE type='tg_subscribe')::int AS subs30,
      count(*) FILTER (WHERE type='tg_save')::int AS saves30,
      count(*) FILTER (WHERE type='tg_save' AND ref='deeplink')::int AS "savesDeeplink"
    FROM page_events WHERE ts > now() - interval '30 days'`);

  // Channel-post performance proxy: per listing, reads via the channel's
  // ref=tg links + saves via the bot.
  const topChannel = await rows<{ title: string; org: string; reads: number; saves: number }>(sql`
    SELECT l.title, l.org_name AS org,
           count(*) FILTER (WHERE e.type='pageview' AND e.ref='tg')::int AS reads,
           count(*) FILTER (WHERE e.type='tg_save')::int AS saves
    FROM page_events e JOIN listings l ON l.id = e.listing_id
    WHERE e.ts > now() - interval '30 days'
      AND (e.type='tg_save' OR (e.type='pageview' AND e.ref='tg'))
    GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 8`);

  // Subscriber growth: cumulative curve over the same 30-day window.
  const [subBase] = await rows<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM subscribers WHERE joined_at <= now() - interval '30 days'`,
  );
  const subDaily = await rows<{ day: string; n: number }>(sql`
    SELECT (joined_at AT TIME ZONE 'Africa/Addis_Ababa')::date::text AS day, count(*)::int AS n
    FROM subscribers WHERE joined_at > now() - interval '30 days' GROUP BY 1`);
  const subByDay = new Map(subDaily.map((d) => [d.day, d.n]));
  let running = subBase?.n ?? 0;
  const subscriberGrowth = days.map(({ day }) => {
    running += subByDay.get(day) ?? 0;
    return { day, total: running };
  });

  const [live] = await rows<{ n: number }>(sql`
    SELECT count(DISTINCT visitor_hash)::int AS n FROM page_events
    WHERE ts > now() - interval '5 minutes'
      AND type IN ('pageview','listing_view','apply_click')`);

  // --- product ---------------------------------------------------------------
  const bySource = await rows<{ source: string; active: number }>(sql`
    SELECT source, count(*)::int AS active FROM listings
    WHERE status='active' GROUP BY 1 ORDER BY active DESC`);

  const [product] = await rows<{
    active: number; posted: number; subscribers: number; bookmarks: number; reminders: number;
  }>(sql`
    SELECT
      (SELECT count(*) FROM listings WHERE status='active')::int AS active,
      (SELECT count(*) FROM listings WHERE posted_to_channel)::int AS posted,
      (SELECT count(*) FROM subscribers)::int AS subscribers,
      (SELECT count(*) FROM bookmarks)::int AS bookmarks,
      (SELECT count(*) FROM reminders)::int AS reminders`);

  // --- system / ops ------------------------------------------------------------
  const runs = await rows<{
    source: string; started: string; secs: number | null;
    new_count: number; updated_count: number; error_count: number;
  }>(sql`
    SELECT source, started_at::text AS started,
           extract(epoch FROM (finished_at - started_at))::int AS secs,
           new_count, updated_count, error_count
    FROM scrape_runs ORDER BY started_at DESC LIMIT 15`);

  // Per-org breakdown from the latest orgs run's log jsonb: slowest + failing.
  const orgStats = await rows<{
    slug: string; adapter: string; errors: number; kept: number; ms: number;
  }>(sql`
    SELECT o->>'slug' AS slug, o->>'adapter' AS adapter,
           (o->>'errors')::int AS errors, (o->>'kept')::int AS kept,
           (o->>'durationMs')::int AS ms
    FROM (SELECT log FROM scrape_runs WHERE source='orgs' AND log ? 'orgs'
          ORDER BY started_at DESC LIMIT 1) latest,
         jsonb_array_elements(latest.log->'orgs') AS o
    ORDER BY (o->>'errors')::int DESC, (o->>'durationMs')::int DESC
    LIMIT 10`);

  // Health / coverage across the catalog + pipeline backlog.
  const [health] = await rows<{
    active: number; expired: number; hidden: number;
    structured: number; withApply: number; backlog: number; events: number;
  }>(sql`
    SELECT
      count(*) FILTER (WHERE status='active')::int AS active,
      count(*) FILTER (WHERE status='expired')::int AS expired,
      count(*) FILTER (WHERE status='hidden')::int AS hidden,
      count(*) FILTER (WHERE status='active' AND raw ? 'structured')::int AS structured,
      count(*) FILTER (WHERE status='active' AND apply_url IS NOT NULL)::int AS "withApply",
      count(*) FILTER (WHERE status='active' AND fit_score>=70 AND NOT posted_to_channel)::int AS backlog,
      (SELECT count(*) FROM page_events)::int AS events
    FROM listings`);

  const processLogs = await readProcessLogs();

  return {
    days,
    totals,
    topViewed,
    topApplied,
    referrers,
    devices,
    countries,
    heat,
    funnel,
    tg,
    topChannel,
    subscriberGrowth,
    liveNow: live?.n ?? 0,
    bySource,
    product,
    runs,
    orgStats,
    health,
    processLogs,
  };
};
