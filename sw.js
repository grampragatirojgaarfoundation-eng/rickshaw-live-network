const CACHE_NAME = 'rickshaw-cache-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting(); // नया सर्विस वर्कर तुरंत एक्टिवेट करें
});

self.addEventListener('activate', (e) => {
  // पुरानी कैशे (Cache) को डिलीट करें ताकि ऐप में फंसा हुआ पुराना डेटा हट जाए
  e.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Network-First Strategy: हमेशा इंटरनेट से ताज़ा फाइल लाएं, इंटरनेट न होने पर ही कैशे दिखाएं
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});