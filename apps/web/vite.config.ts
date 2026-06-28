import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// envDir points at the monorepo root so SvelteKit's $env/* reads the single
// shared .env (DATABASE_URL + auth secrets) used by every workspace package.
export default defineConfig({ envDir: '../../', plugins: [tailwindcss(), sveltekit()] });
