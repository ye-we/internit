// ---------------------------------------------------------------------------
// format.ts — shaping DB rows into MCP tool results.
//
// Two concerns live here:
//   1. The MCP result envelope (ok/fail) — same idea as the toy server.
//   2. TOKEN BUDGET. listings.descriptionHtml / descriptionText are large. If
//      search returned them for every row, a single call could blow the model's
//      context. So list-style tools return trimmed summaries via toSummary();
//      only get_listing returns the full body. This split is the main reason a
//      real MCP server needs a formatting layer the toy didn't.
// ---------------------------------------------------------------------------

import type { Listing } from "@internit/db";

export function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data },
  };
}

export function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

// A compact listing view for lists/search — everything the model needs to
// decide relevance, minus the heavy HTML/text bodies and the debug `raw` blob.
export function toSummary(l: Listing) {
  return {
    id: l.id,
    title: l.title,
    orgName: l.orgName,
    orgSlug: l.orgSlug,
    source: l.source,
    sourceUrl: l.sourceUrl,
    location: l.location,
    isRemote: l.isRemote,
    isPaid: l.isPaid, // null = unclear; never coerce to false
    stipendText: l.stipendText,
    deadline: l.deadline,
    postedAt: l.postedAt,
    fieldTags: l.fieldTags,
    fitScore: l.fitScore,
    status: l.status,
  };
}
