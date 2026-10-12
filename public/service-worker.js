/**
 * Service Worker for caching soundfonts
 *
 * Caching Strategy:
 * - Soundfont files (GeneralUser GS and FluidR3_GM instruments) are cached
 *   the first time they are used, then served from the cache on every later
 *   visit. Nothing is pre-cached, so visitors only download what they play.
 * - Version-based cache invalidation (increment VERSION to clear old cache)
 * - Navigation requests always fetch fresh from the network (cache: 'reload'),
 *   so a device can never get stuck serving a stale index.html from a prior
 *   build. The version-busted asset URLs in the fresh HTML then pull fresh
 *   JS/CSS. This is what heals a phone whose HTTP cache went stale.
 *
 * Version History:
 * - v1: Initial cache with basic instruments
 * - v2: Updated to use usage statistics from MIDI analysis (272 composers, 2000+ works)
 * - v2 (2026-05-22): Added cache-bypassing navigation handler (soundfont cache unchanged)
 * - v3 (2026-10-12): Soundfonts served from Cloudflare R2; cache GeneralUser GS;
 *   stopped pre-caching FluidR3_GM instruments on install
 */

const CACHE_VERSION = 'v3';
const CACHE_NAME = `choral-practice-soundfonts-${CACHE_VERSION}`;

// Soundfont URLs to cache: our R2 bucket, the original gleitz site (fallback
// for FluidR3_GM) and our own server (fallback for GeneralUser GS)
const SOUNDFONT_URL_PATTERNS = [
    'pub-8f69698b476240b0b34d5e8a46b69a65.r2.dev/',
    'gleitz.github.io/midi-js-soundfonts/',
    '/soundfonts/GeneralUserGS.sf3'
];

/**
 * Install event - activate immediately without waiting for page reload
 */
self.addEventListener('install', (event) => {
    console.log(`[Service Worker ${CACHE_VERSION}] Installing...`);
    event.waitUntil(self.skipWaiting());
});

/**
 * Activate event - clean up old cache versions
 * Automatically removes caches from previous versions
 */
self.addEventListener('activate', (event) => {
    console.log(`[Service Worker ${CACHE_VERSION}] Activating...`);

    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                // Find and delete all old soundfont caches
                const oldCaches = cacheNames.filter(cacheName =>
                    cacheName.startsWith('choral-practice-soundfonts-') &&
                    cacheName !== CACHE_NAME
                );

                if (oldCaches.length > 0) {
                    console.log(`[Service Worker] Deleting ${oldCaches.length} old cache(s):`, oldCaches);
                }

                return Promise.all(
                    oldCaches.map(cacheName => caches.delete(cacheName))
                );
            })
            .then(() => {
                console.log(`[Service Worker ${CACHE_VERSION}] Activated and taking control of all pages`);
                // Take control of all pages immediately (no need to reload)
                return self.clients.claim();
            })
    );
});

/**
 * Fetch event - cache-first strategy for soundfonts
 *
 * Strategy:
 * 1. Check cache first (fast!)
 * 2. If not cached, fetch from network
 * 3. Cache the response for future use
 * 4. Only cache successful responses (status 200)
 */
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Navigation requests (the top-level HTML document): always fetch fresh
    // from the network, bypassing the browser's HTTP cache. index.html is
    // already served no-store, so for a healthy browser this is a no-op; the
    // value is healing a device that is wrongly serving a cached old page.
    // Fresh HTML carries version-busted asset URLs, so the rest follows.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request, { cache: 'reload' })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Only intercept soundfont requests
    if (event.request.method === 'GET' && SOUNDFONT_URL_PATTERNS.some(pattern => url.includes(pattern))) {
        event.respondWith(
            caches.match(event.request)
                .then((cachedResponse) => {
                    if (cachedResponse) {
                        // Cache hit! Serve from cache
                        console.log('[Service Worker] ✓ Cache hit:', url.split('/').pop());
                        return cachedResponse;
                    }

                    // Cache miss - fetch from network and cache for next time
                    console.log('[Service Worker] ✗ Cache miss, fetching:', url.split('/').pop());
                    return fetch(event.request)
                        .then((response) => {
                            // Only cache successful responses
                            if (response && response.status === 200) {
                                const responseToCache = response.clone();
                                caches.open(CACHE_NAME)
                                    .then((cache) => {
                                        cache.put(event.request, responseToCache);
                                        console.log('[Service Worker] ✓ Cached for next time:', url.split('/').pop());
                                    });
                            }
                            return response;
                        })
                        .catch((error) => {
                            console.error('[Service Worker] ✗ Fetch failed:', error);
                            throw error;
                        });
                })
        );
    }
    // For non-soundfont requests, pass through to network (no caching)
});

// Message handler for communication with main app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
