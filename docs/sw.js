const SW_VERSION = "1.1.0";
const CACHE_NAME = `battery-pwa-cache-${SW_VERSION}`;

const ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json'
];

let isDraining = false;

// Intensive non-blocking CPU calculation worker loop
function cpuDrainCycle() {
    if (!isDraining) return;

    const startTime = performance.now();
    // Execute intense floating point, matrix, and trigonometric operations for 40ms bursts
    while (performance.now() - startTime < 40) {
        const val = Math.random();
        Math.sqrt(val * 1000000);
        Math.sin(val);
        Math.cos(val);
        Math.atan2(val, Math.PI);
    }

    // Yield back to event loop immediately so Service Worker remains responsive
    setTimeout(cpuDrainCycle, 0);
}

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.all(
                ASSETS.map(url => {
                    return fetch(new Request(url, { cache: 'reload' }))
                        .then(response => {
                            if (response.ok) return cache.put(url, response);
                        })
                        .catch(err => console.log('Caching failed for:', url, err));
                })
            );
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        clients.claim().then(() => {
            return caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(name => {
                        if (name !== CACHE_NAME) {
                            return caches.delete(name);
                        }
                    })
                );
            });
        })
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        const cacheUrl = new URL(event.request.url);
                        cacheUrl.search = '';
                        cache.put(cacheUrl.toString(), responseToCache);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                const cacheUrl = new URL(event.request.url);
                cacheUrl.search = '';
                return caches.match(cacheUrl.toString());
            })
    );
});

self.addEventListener('message', event => {
    if (!event.data) return;

    if (event.data.type === 'START_DRAIN') {
        if (!isDraining) {
            isDraining = true;
            cpuDrainCycle();
        }
    } else if (event.data.type === 'STOP_DRAIN') {
        isDraining = false;
    } else if (event.data.type === 'GET_VERSION') {
        event.source.postMessage({
            type: 'VERSION_CHECK',
            version: SW_VERSION
        });
    }
});
