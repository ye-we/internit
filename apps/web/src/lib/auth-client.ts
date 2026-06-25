import { createAuthClient } from "better-auth/react";

const apiBaseUrl = import.meta.env.VITE_API_URL || window.location.origin;

export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  basePath: "/api/auth",
});

export type AuthSession = typeof authClient.$Infer.Session;
export type AuthUser = AuthSession["user"];

export function useAuthSession() {
  const session = authClient.useSession();

  return {
    ...session,
    session: session.data?.session ?? null,
    user: session.data?.user ?? null,
    isAuthenticated: Boolean(session.data?.user),
  };
}
