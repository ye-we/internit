import { betterAuth } from "better-auth";
import { env } from "$env/dynamic/private";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./server/db";
import { user, session, account, verification } from "./server/schema";

export const auth = betterAuth({
	// Read through $env/dynamic/private so the secret/baseURL come from the
	// shared monorepo .env (via vite envDir) and the deploy's process.env at
	// runtime — not better-auth's implicit default, which throws on build.
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: { user, session, account, verification },
	}),
	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID || "",
			clientSecret: env.GOOGLE_CLIENT_SECRET || "",
		},
	},
	emailAndPassword: {
		enabled: true,
	},
});
