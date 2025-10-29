/**
 * Service Worker for caching soundfont instruments
 *
 * Caching Strategy:
 * - Pre-cache the 6 most commonly used instruments based on analysis of 272 composers
 * - Cache other instruments on-demand as they are requested
 * - Version-based cache invalidation (increment VERSION to clear old cache)
 *
 * Version History:
 * - v1: Initial cache with basic instruments
 * - v2: Updated to use usage statistics from MIDI analysis (272 composers, 2000+ works)
 */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `choral-practice-soundfonts-${CACHE_VERSION}`;

/**
 * Top 6 most commonly used instruments based on MIDI file analysis
 * Source: analyze-cached-works.js on 272 composers
 *
 * Usage statistics:
 * - acoustic_grand_piano: 890 uses (most common)
 * - piccolo: 3139 uses (soprano voice part)
 * - clarinet: 3184 uses (alto voice part)
 * - bassoon: 3347 uses (bass voice part)
 * - french_horn: 3561 uses (tenor voice part)
 * - string_ensemble_1: 5666 uses (orchestral arrangements)
 */
const INSTRUMENTS_TO_CACHE = [
    'acoustic_grand_piano',
    'piccolo',
    'clarinet',
    'bassoon',
    'french_horn',
    'string_ensemble_1'
];

// Generate soundfont URLs for the instruments
const SOUNDFONT_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';
const getSoundfontUrls = () => {
    const urls = [];
    INSTRUMENTS_TO_CACHE.forEach(instrument => {
        // Both mp3 and ogg formats
        urls.push(`${SOUNDFONT_BASE}/${instrument}-mp3.js`);
        urls.push(`${SOUNDFONT_BASE}/${instrument}-ogg.js`);
    });
    return urls;
};

/**
 * Install event - pre-cache the most common soundfonts
 * Fails gracefully if caching fails (instruments will be cached on-demand)
 */
self.addEventListener('install', (event) => {
    console.log(`[Service Worker ${CACHE_VERSION}] Installing and caching soundfonts...`);

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                const urls = getSoundfontUrls();
                console.log(`[Service Worker] Pre-caching ${urls.length} soundfont files for ${INSTRUMENTS_TO_CACHE.length} instruments...`);

                // Cache all in parallel for faster installation
                return cache.addAll(urls)
                    .then(() => {
                        console.log('[Service Worker] All common soundfonts cached successfully');
                    })
                    .catch((error) => {
                        console.warn('[Service Worker] Some soundfonts failed to pre-cache:', error);
                        console.warn('[Service Worker] Continuing anyway - will cache on-demand');
                        // Don't fail installation if pre-caching fails
                        // Instruments will be cached on first use instead
                    });
            })
            .then(() => {
                // Activate immediately without waiting for page reload
                return self.skipWaiting();
            })
    );
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

    // Only intercept requests to the soundfont CDN
    if (url.includes('gleitz.github.io/midi-js-soundfonts')) {
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
