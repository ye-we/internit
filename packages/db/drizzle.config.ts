import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// dotenv resolves a relative path against process.cwd(), and drizzle-kit runs
// this config from packages/db — so this reaches the repo-root .env. Avoid
// import.meta here: drizzle-kit bundles the config as CJS, where
// import.meta.dirname is empty (breaks generate/migrate).
config({ path: "../../.env" });

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
