import { createAuthClient } from 'better-auth/svelte';

export const client = createAuthClient();
export const { signIn, signUp, useSession, signOut } = client;
