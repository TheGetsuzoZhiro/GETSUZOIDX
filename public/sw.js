const CACHE_NAME = "getsuzo-cache-v2"; // versi baru agar cache lama dihapus

const urlsToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/js/main.js",
  "/js/config.js",
  "/js/utils.js",
  "/js/api.js",
  "/js/sse.js",
  "/js/notifications.js",
  "/js/charts.js",
  "/js/signals.js",
  "/js/news.js",
  "/js/ui.js",
];

self.addEventListener("install", (event) => {
  console.log("[SW] Installed");
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Caching app shell");
      return cache.addAll(urlsToCache);
    }),
  );
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activated");
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              console.log("[SW] Menghapus cache usang:", cacheName);
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Tangani navigasi, CSS, dan semua file JS (termasuk di folder js/)
  if (
    event.request.mode === "navigate" ||
    url.pathname.match(/\.(css|js)$/) ||
    url.pathname.startsWith("/js/")
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request);
        }),
    );
  } else {
    // Asset lain: cache-first
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      }),
    );
  }
});

// Push dan notificationclick tetap sama (tidak perlu diubah)
self.addEventListener("push", (event) => {
  let data = { title: "Notifikasi Baru", body: "Ada update." };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    data.body = event.data ? event.data.text() : "Ada update.";
  }
  const options = {
    body: data.body,
    icon: "/assets/favicon/web-app-manifest-192x192.png",
    badge: "/assets/favicon/favicon-96x96.png",
    vibrate: [200, 100, 200],
    tag: data.title || "getsuzo-notification",
    renotify: true,
    data: {
      url: "/",
    },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const relativeUrl = event.notification.data?.url || "/";
  const urlToOpen = new URL(relativeUrl, self.location.origin).href;
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url === urlToOpen && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});
