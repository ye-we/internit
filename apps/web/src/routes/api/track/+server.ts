// Beacon for client-side events the server can't see: in-board listing
// selections and apply-button clicks (the board is one page — selecting a
// listing doesn't navigate). Accepts only known event types, validates the id,
// and always 204s — analytics must never surface an error to the client.

import { recordEvent, UUID_RE, type TrackType } from "$lib/server/track";
import type { RequestHandler } from "./$types";

const ALLOWED = new Set<TrackType>(["listing_view", "apply_click"]);

// Rate limiting lives inside recordEvent (shared with server-side pageviews).
export const POST: RequestHandler = async (event) => {
  try {
    const body = (await event.request.json()) as { type?: string; listingId?: string };
    const type = body.type as TrackType;
    if (ALLOWED.has(type) && typeof body.listingId === "string" && UUID_RE.test(body.listingId)) {
      recordEvent(event, { type, listingId: body.listingId });
    }
  } catch {
    // malformed beacon — ignore
  }
  return new Response(null, { status: 204 });
};
