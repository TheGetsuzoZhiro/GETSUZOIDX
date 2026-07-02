// ============ KONFIGURASI CACHE ============
const CACHE_NAME = 'getsuzo-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js'
  // Kamu bisa menambahkan file aset lain di sini seperti gambar logo jika perlu
];

// ============ INSTALL & CACHE ============
self.addEventListener("install", (event) => {
  console.log("[SW] Installed");
  
  // Memaksa Service Worker baru untuk langsung aktif tanpa menunggu
  self.skipWaiting();

  // Menyimpan file dasar ke dalam cache
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Caching app shell");
        return cache.addAll(urlsToCache);
      })
  );
});

// ============ ACTIVATE ============
self.addEventListener("activate", (event) => {
  console.log("[SW] Activated");
  event.waitUntil(self.clients.claim());
});

// ============ FETCH EVENT (WAJIB UNTUK PWA) ============
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Mengembalikan file dari cache jika tersedia
        if (response) {
          return response;
        }
        // Jika tidak ada di cache, ambil langsung dari jaringan (internet)
        return fetch(event.request);
      })
  );
});

// ============ TERIMA PUSH NOTIFICATION ============
self.addEventListener("push", (event) => {
  let data = { title: "Notifikasi Baru", body: "Ada update." };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    // Jika data bukan JSON, gunakan text
    data.body = event.data ? event.data.text() : "Ada update.";
  }

  const options = {
    body: data.body,
    icon: "/assets/favicon/favicon-48x48.png", 
    badge: "/assets/favicon/favicon-32x32.png",
    vibrate: [200, 100, 200],
    data: {
      url: "/", // URL yang akan dibuka saat notifikasi diklik
    },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ============ KLIK NOTIFIKASI ============
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Jika sudah ada tab yang terbuka, fokuskan
        for (const client of windowClients) {
          if (client.url === urlToOpen && "focus" in client) {
            return client.focus();
          }
        }
        // Jika tidak, buka tab baru
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});
