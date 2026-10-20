import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The editor itself (Quill setup, text styles, tables, page breaks, outline, Word export and its
// styles) is shared with the web app and imported from its source as $lib. Only those files are used:
// nothing of the web app's server, sync or sign-in code, configs or dependencies.
const shared_lib = fileURLToPath(new URL('../../frontend/src/lib', import.meta.url));
const web_static = fileURLToPath(new URL('../../frontend/static', import.meta.url));

export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	resolve: {
		alias: { $lib: shared_lib, $web_static: web_static },
		// the shared files would otherwise find packages in the web app's node_modules; these must come
		// from here, and Quill only once (its formats are registered on the one copy)
		dedupe: ['quill', 'quill-delta', 'docx', 'tailwindcss'],
	},
	// relative asset paths, as the app serves the build from its own embedded files
	base: './',
	build: { target: 'es2022' },
	server: {
		// wails dev expects the dev server here (wails.json)
		port: 5174,
		strictPort: true,
		fs: { allow: ['.', shared_lib, web_static] },
	},
});
