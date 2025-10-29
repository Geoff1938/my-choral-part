// Service Worker for caching soundfont instruments
const CACHE_VERSION = 'v1';
const CACHE_NAME = `choral-practice-soundfonts-${CACHE_VERSION}`;

// Top 6 most commonly used instruments based on MIDI file analysis
const INSTRUMENTS_TO_CACHE = [
    'acoustic_grand_piano',  // Most common
    'piccolo',               // Soprano part
    'clarinet',              // Alto part
    'bassoon',               // Bass part
    'french_horn',           // Tenor part
    'string_ensemble_1'      // Next most common
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

// Install event - pre-cache the soundfonts
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing and caching soundfonts...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                const urls = getSoundfontUrls();
                console.log(`[Service Worker] Caching ${urls.length} soundfont files...`);

                // Cache all in parallel - faster!
                return cache.addAll(urls)
                    .then(() => {
                        console.log('[Service Worker] All soundfonts cached successfully');
                    })
                    .catch((error) => {
                        console.warn('[Service Worker] Some soundfonts failed to cache:', error);
                        // Don't fail installation if some files fail
                        // They'll be cached on-demand instead
                    });
            })
            .then(() => {
                // Activate immediately, don't wait for page reload
                return self.skipWaiting();
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');

    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName.startsWith('choral-practice-soundfonts-') && cacheName !== CACHE_NAME) {
                            console.log('[Service Worker] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                // Take control of all pages immediately
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache when possible
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Only intercept requests to the soundfont CDN
    if (url.includes('gleitz.github.io/midi-js-soundfonts')) {
        event.respondWith(
            caches.match(event.request)
                .then((cachedResponse) => {
                    if (cachedResponse) {
                        console.log('[Service Worker] Serving from cache:', url);
                        return cachedResponse;
                    }

                    // Not in cache, fetch from network and cache it
                    console.log('[Service Worker] Fetching and caching:', url);
                    return fetch(event.request)
                        .then((response) => {
                            // Only cache successful responses
                            if (response.status === 200) {
                                const responseToCache = response.clone();
                                caches.open(CACHE_NAME)
                                    .then((cache) => {
                                        cache.put(event.request, responseToCache);
                                    });
                            }
                            return response;
                        })
                        .catch((error) => {
                            console.error('[Service Worker] Fetch failed:', error);
                            throw error;
                        });
                })
        );
    }
    // For non-soundfont requests, just pass through to network
});

// Message handler for communication with main app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
