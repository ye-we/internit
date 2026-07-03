// First-party, cookieless event tracking. Pageviews are recorded server-side in
// hooks.server.ts (ad-blocker-proof, no client JS); listing views and apply
// clicks arrive via the /api/track beacon. Visitors are identified by a
// daily-rotating sha256 of ip+ua — never stored raw, unlinkable across days —
// so no cookies and no consent banner (same scheme Plausible/Umami use).

import { createHash } from "node:crypto";
import geoip from "geoip-lite";
import { db } from "$lib/server/db";
import { pageEvents } from "@internit/db/schema";
import type { RequestEvent } from "@sveltejs/kit";

const BOT_UA =
  /bot|crawl|spider|slurp|preview|scan|fetch|monitor|curl|wget|python-requests|axios|headless|lighthouse|facebookexternalhit|telegrambot|whatsapp|slackbot|discordbot|linkedinbot|twitterbot/i;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TrackType = "pageview" | "listing_view" | "apply_click";

export function isBot(ua: string): boolean {
  return ua === "" || BOT_UA.test(ua);
}

// getClientAddress() only honors proxy headers when the operator opts in
// (adapter-node's ADDRESS_HEADER env) — never read x-forwarded-for directly,
// it's client-spoofable and would let anyone fabricate visitor identities.
export function clientIp(event: RequestEvent): string {
  try {
    return event.getClientAddress();
  } catch {
    return "unknown";
  }
}

export function visitorOf(event: RequestEvent): {
  visitorHash: string;
  device: string;
  country: string | null;
} {
  const ua = event.request.headers.get("user-agent") ?? "";
  const ip = clientIp(event);
  const day = new Date().toISOString().slice(0, 10); // daily rotation
  const visitorHash = createHash("sha256").update(`${day}:${ip}:${ua}`).digest("hex");
  const device = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
  // Offline GeoIP → ISO2 country; the ip itself is hashed away, never stored.
  const country = geoip.lookup(ip)?.country ?? null;
  return { visitorHash, device, country };
}

// Every event is an unauthenticated DB write (pageviews via hooks, beacons via
// /api/track) — without a per-IP cap one client can flood page_events. Sliding
// window in memory; fine for a single PM2 process.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, { count: number; reset: number }>();

function allow(ip: string, now: number): boolean {
  const h = hits.get(ip);
  if (!h || now >= h.reset) {
    // Piggyback cleanup on writes so the map can't grow unbounded.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now >= v.reset) hits.delete(k);
    }
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  h.count += 1;
  return h.count <= MAX_PER_WINDOW;
}

// Fire-and-forget: analytics must never delay or fail a response.
export function recordEvent(
  event: RequestEvent,
  data: { type: TrackType; path?: string | null; ref?: string | null; listingId?: string | null },
): void {
  const ua = event.request.headers.get("user-agent") ?? "";
  if (isBot(ua)) return;
  if (!allow(clientIp(event), Date.now())) return;
  const { visitorHash, device, country } = visitorOf(event);
  void db
    .insert(pageEvents)
    .values({
      type: data.type,
      // path/ref are request-derived (URL, ?ref=, Referer host) — cap them so
      // junk input can't bloat rows; they render as text in the dashboard.
      path: data.path?.slice(0, 200) ?? null,
      ref: data.ref?.slice(0, 80) ?? null,
      listingId: data.listingId && UUID_RE.test(data.listingId) ? data.listingId : null,
      visitorHash,
      device,
      country,
    })
    .catch(() => {});
}
