import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// adapter-node: builds a standalone Node server at build/ for the PM2/VPS
		// deploy alongside the bot + worker. Run with `node build` (the server
		// reads PORT, ORIGIN, and $env/dynamic/* from process.env at runtime).
		adapter: adapter()
	}
};

export default config;
