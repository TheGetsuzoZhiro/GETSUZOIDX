const CACHE_NAME = 'getsuzo-cache-v12'; 

const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js'
];

// ============ INSTALL & CACHE ============
self.addEventListener("install", (event) => {
  console.log("[SW] Installed");
  
  // Memaksa Service Worker baru untuk langsung aktif tanpa menunggu tab ditutup
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Caching app shell");
        return cache.addAll(urlsToCache);
      })
  );
});

// ============ ACTIVATE (TAMBAHAN: AUTO DELETE CACHE LAMA) ============
self.addEventListener("activate", (event) => {
  console.log("[SW] Activated");
  
  // Fitur Tambahan: Otomatis menghapus cache versi lama (misal v1) di HP client
  // ketika Anda mengubah CACHE_NAME menjadi v2
  const cacheWhitelist = [CACHE_NAME];
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log("[SW] Menghapus cache usang:", cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ============ FETCH EVENT (DIUBAH MENJADI NETWORK-FIRST) ============
self.addEventListener('fetch', (event) => {
  // Hanya intercept request dokumen/aset internal saja
  if (event.request.mode === 'navigate' || 
      event.request.url.includes('style.css') || 
      event.request.url.includes('script.js') || 
      event.request.url.match(/\.(html|css|js)$/)) {
      
    event.respondWith(
      // STRATEGI: Paksa browser mengambil kode teranyar langsung dari internet (Render)
      fetch(event.request)
        .then((networkResponse) => {
          // Jika internet aman dan responnya valid, perbarui file di dalam cache
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // JIKA OFFLINE / INTERNET MATI: Baru ambil file cadangan dari cache lokal HP
          return caches.match(event.request);
        })
    );
  } else {
    // Untuk request luar seperti API, Chart.js, atau FontAwesome, biarkan berjalan normal
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  }
});

// ============ TERIMA PUSH NOTIFICATION (TETAP AMAN) ============
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
    icon: "/assets/favicon/favicon-48x48.png", 
    badge: "/assets/favicon/favicon-32x32.png",
    vibrate: [200, 100, 200],
    data: {
      url: "/", 
    },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ============ KLIK NOTIFIKASI (TETAP AMAN) ============
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";

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
