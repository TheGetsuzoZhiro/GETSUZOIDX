import { NOTIF_KEY, VAPID_PUBLIC_KEY } from "./config.js";
import { urlBase64ToUint8Array } from "./utils.js";
import { saveSubscription } from "./api.js";

// ===== NOTIFICATIONS =====

let notificationHistory = [];

export function loadNotifications() {
  try {
    const data = localStorage.getItem(NOTIF_KEY);
    notificationHistory = data ? JSON.parse(data) : [];
  } catch (e) {
    notificationHistory = [];
  }
}

export function saveNotifications() {
  try {
    localStorage.setItem(NOTIF_KEY, JSON.stringify(notificationHistory));
  } catch (e) {}
}

export function addNotification(title, body, type = "signal") {
  const now = new Date();
  const timestamp = now.toLocaleString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  notificationHistory.unshift({
    id: Date.now(),
    title,
    body,
    type,
    timestamp,
    read: false,
  });
  if (notificationHistory.length > 100) notificationHistory.pop();
  saveNotifications();
  updateNotifBadge();
}

export function getUnreadCount() {
  return notificationHistory.filter((n) => !n.read).length;
}

export function updateNotifBadge() {
  const badge = document.querySelector(".notif-badge");
  if (!badge) return;
  badge.style.display = "none";
}

export function markAllAsRead() {
  notificationHistory.forEach((n) => (n.read = true));
  saveNotifications();
  updateNotifBadge();
}

export function clearAllNotifications() {
  notificationHistory = [];
  saveNotifications();
  updateNotifBadge();
}

export function getNotificationHistory() {
  return notificationHistory;
}

export async function subscribeToPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("⚠️ Push not supported in this browser.");
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn("⚠️ Notifikasi ditolak pengguna.");
        return false;
      }
    }

    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      console.log("🔁 Unsubscribe subscription lama.");
      subscription = null;
    }

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const ok = await saveSubscription(subscription);
    if (ok) {
      console.log("✅ Berhasil sinkronisasi token push ke server!");
      localStorage.setItem("pushActive", "true");
      return true;
    } else {
      console.error("❌ Gagal simpan subscription ke server");
      localStorage.removeItem("pushActive");
      return false;
    }
  } catch (err) {
    console.error("❌ Error subscribe push:", err);
    localStorage.removeItem("pushActive");
    return false;
  }
}
