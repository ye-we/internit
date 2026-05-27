import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

config({ path: resolve(import.meta.dirname, "../../.env") });

// `generate` only reads the schema and doesn't need a live URL. push/migrate/studio do.
const url = process.env.DATABASE_URL ?? "postgres://unset:unset@localhost:5432/unset";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
