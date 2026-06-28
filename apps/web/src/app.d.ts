// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { auth } from '$lib/auth';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			session?: typeof auth.$Infer.Session.session;
			user?: typeof auth.$Infer.Session.user;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
