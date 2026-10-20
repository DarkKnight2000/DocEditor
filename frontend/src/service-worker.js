// Makes Raya an installable app (with static/manifest.webmanifest). SvelteKit registers this file itself.
//  - The app's code, styles and static files are cached when a version is installed, so the app window
//    opens quickly; each deploy has a new version, which replaces the old cache.
//  - Pages and the API always come from the server: they depend on who is signed in and documents change
//    live, so nothing of theirs is cached. Without a connection, a page shows the offline notice instead.
/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = `raya-${version}`;
// the link-preview image is only for other sites, so it isn't worth keeping
const ASSETS = [...build, ...files.filter((file) => file !== '/og-image.png')];
const ASSET_SET = new Set(ASSETS);

sw.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
        .then(() => sw.clients.claim()));
});

sw.addEventListener('fetch', (event) => {
    const request = event.request;
    if(request.method !== 'GET') return;
    const url = new URL(request.url);
    if(url.origin !== sw.location.origin) return;

    if(ASSET_SET.has(url.pathname))
    {
        event.respondWith(caches.match(url.pathname).then((cached) => cached ?? fetch(request)));
    }
    else if(request.mode === 'navigate')
    {
        event.respondWith(fetch(request).catch(async () => (await caches.match('/offline.html')) ?? Response.error()));
    }
    // everything else (the API, page data) goes to the server as usual
});
