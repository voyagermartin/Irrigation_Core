const CACHE_NAME = 'irrigation-core-shell-v1.0.1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

// 安裝階段：逐一預快取 App Shell 資源，單一資源失敗不阻斷整體安裝
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of SHELL_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Pre-caching asset failed, skipping:', asset, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

// 啟用階段：清除舊版快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 網路請求攔截
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 只攔截 GET 請求
  if (event.request.method !== 'GET') {
    return;
  }

  // 跨域請求（如 Google Apps Script API）直接連網，不予快取，確保帳務數據即時性
  if (requestUrl.origin !== location.origin || requestUrl.hostname.includes('google.com') || requestUrl.hostname.includes('googleapis.com')) {
    return;
  }

  // 同源靜態檔案採 Stale-While-Revalidate 策略
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
