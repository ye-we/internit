import { auth } from "$lib/auth";
import { redirect, type Handle, type RequestEvent } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { building, dev } from "$app/environment";
import { recordEvent, UUID_RE } from "$lib/server/track";

// Server-side pageview tracking: real page navigations only (GET + html accept,
// a matched route, not the api or the analytics dashboard itself). Fire-and-
// forget inside recordEvent, so it can never slow a response.
function trackPageview(event: RequestEvent): void {
	const { url, request, route } = event;
	if (request.method !== "GET" || !route.id) return;
	if (url.pathname.startsWith("/api") || url.pathname.startsWith("/analytics")) return;
	if (!request.headers.get("accept")?.includes("text/html")) return;
	const listing = url.searchParams.get("listing");
	recordEvent(event, {
		type: "pageview",
		path: url.pathname,
		// Channel "Read" links carry ref=tg; a bare listing deep link marks the
		// visit as a shared listing URL; otherwise fall back to the Referer host
		// (organic: university sites, Facebook groups, search).
		ref:
			url.searchParams.get("ref") ??
			(listing ? "listing-link" : refererHost(event.request, url)),
		listingId: listing && UUID_RE.test(listing) ? listing : null,
	});
}

// External referring host, or null for direct visits / own-site navigation.
function refererHost(request: Request, url: URL): string | null {
	const referer = request.headers.get("referer");
	if (!referer) return null;
	try {
		const host = new URL(referer).hostname.replace(/^www\./, "");
		return host && host !== url.hostname.replace(/^www\./, "") ? host : null;
	} catch {
		return null;
	}
}

// The app renders sanitized-but-scraped HTML, so ship defense-in-depth headers.
// CSP here only pins the directives that can't break SvelteKit hydration
// (no script-src — inline hydration scripts would need nonces); script policy
// can be tightened at the reverse proxy later.
function withSecurityHeaders(response: Response): Response {
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	response.headers.set(
		"Content-Security-Policy",
		"frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
	);
	if (!dev) {
		response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}
	return response;
}

export const handle: Handle = async ({ event, resolve }) => {
	if (!building) trackPageview(event);
	if (event.route.id?.startsWith("/(protected)/")) {
		const session = await auth.api.getSession({
			headers: event.request.headers,
		});

		if (session) {
			event.locals.session = session?.session;
			event.locals.user = session?.user;

			return withSecurityHeaders(await svelteKitHandler({ event, resolve, auth, building }));
		} else {
			redirect(307, "/sign-in");
		}
	} else {
		return withSecurityHeaders(await svelteKitHandler({ event, resolve, auth, building }));
	}
};
