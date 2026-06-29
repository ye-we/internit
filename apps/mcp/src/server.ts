#!/usr/bin/env -S npx tsx
// ===========================================================================
// server.ts — the internit MCP server (read-only, stdio).
//
// ⭐ SAME MENTAL MODEL AS THE TOY: this process does NOT call an AI model. It
//    ADVERTISES tool definitions and EXECUTES the JSON the client sends. The
//    model lives on the client side (Claude Code). The only thing that changed
//    from the toy is what backs the tools: the fake in-memory store became the
//    real Postgres DB, reached through the existing @internit/db package.
//
// It's a peer of apps/bot and apps/worker — a standalone process. The DB
// connection string comes from the monorepo-root .env, which @internit/db's
// env.js loads automatically, so there's no env wiring here.
//
// READ-ONLY by design: every registered tool only SELECTs. Nothing here writes.
// (See README for how to safely add write tools later, and why a read-only DB
//  role is the right guardrail.)
// ===========================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeDb } from "@internit/db";

import { registerListingTools } from "./tools/listings.js";
import { registerOrgTools } from "./tools/orgs.js";
import { registerStatsTools } from "./tools/stats.js";

const server = new McpServer({
  name: "internit",
  version: "0.0.0",
});

// Each module registers its tools onto the shared server instance.
registerListingTools(server);
registerOrgTools(server);
registerStatsTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the JSON-RPC protocol on stdio — log to stderr only.
  console.error("internit MCP server running on stdio (read-only).");
}

// Close the DB pool cleanly when the client disconnects (stdin closes).
process.stdin.on("close", () => {
  void closeDb().finally(() => process.exit(0));
});

main().catch((err) => {
  console.error("Fatal error starting internit MCP server:", err);
  process.exit(1);
});
