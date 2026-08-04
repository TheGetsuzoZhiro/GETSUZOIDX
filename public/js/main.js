import {
  API_BASE,
  CATEGORY_MAP,
  VAPID_PUBLIC_KEY,
  NOTIF_KEY,
} from "./config.js";
import {
  escapeHtml,
  fmtPrice,
  fmtPriceNoRp,
  getTodayWIB,
  formatFullDateTime,
  getColorFromCode,
  getSessionFromDate,
  getDateRangeText,
  triggerHaptic,
  showLoading,
} from "./utils.js";
import {
  fetchSignalsFromAPI,
  fetchStockPrice,
  fetchStockInfo,
  fetchNews,
  fetchNewsByStock,
} from "./api.js";
import {
  connectPriceSSE,
  disconnectSSE,
  localPrices,
  onPriceUpdate,
} from "./sse.js";
import {
  loadNotifications,
  saveNotifications,
  addNotification,
  getUnreadCount,
  updateNotifBadge,
  markAllAsRead,
  clearAllNotifications,
  getNotificationHistory,
  subscribeToPush,
} from "./notifications.js";
import {
  destroyAllCharts,
  updateChartsFromSignals,
  renderDailyReturnChart,
  renderDailyWinRateChart,
  renderDailySignalChart,
  renderDetailCharts,
} from "./charts.js";
import {
  _allRunning,
  _allClosed,
  currentSignalFilter,
  currentTechnicalFilter,
  signalListRendered,
  technicalListRendered,
  isDetailView,
  currentDetailIndex,
  bsjpRefreshInterval,
  dailyRendered,
  currentFilterState,
  currentDateRange,
  getSortedSignals,
  buildTagItems,
  renderTagHtml,
  createStatCard,
  filterSignalsByDate,
  aggregateSignals,
  getDateRangeFromFilterState,
  renderSignalRows,
  fetchSignals,
  showSignalList,
  updateSignalList,
  selectSignalFilter,
  selectTechnicalFilter,
  showTechnicalSignalList,
  updateTechnicalSignalList,
  renderTechnicalSignalDetail,
  renderBsjpDetail,
  renderDaily,
  renderPerformanceSignalList,
  showDailySignalDetail,
} from "./signals.js";
import {
  loadNews,
  mountStockNewsCarousel,
  selectNewsCategory,
  renderNewsCard,
  handleImageError,
} from "./news.js";
import {
  createParticles,
  updateClock,
  updateLastUpdate,
  closeAllDropdowns,
  initTabs,
  initMobileMenu,
  initPullToRefresh,
} from "./ui.js";

// ===== POLLING =====

let pollingInterval = null;
let homeLoaded = false;

export function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    const activeTab = document.querySelector(".view.active")?.id;
    if (activeTab === "home") {
      fetchReports();
    }
    if (activeTab === "signals" || activeTab === "technical-signals" || activeTab === "home" || activeTab === "daily") {
      fetchSignals(false);
    }
    updateLastUpdate();
  }, 10000);
}

export function fetchReports() {
  const activeTab = document.querySelector(".view.active")?.id;

  if (activeTab === "daily") {
    if (dailyRendered) {
      fetchSignals(false);
      // updateDailyContent - simplified, full implementation in signals.js
    } else {
      renderDaily();
    }
  } else if (activeTab === "home") {
    if (!homeLoaded) {
      fetchSignals(false).then(() => {
        updateChartsFromSignals({ running: _allRunning, closed: _allClosed });
        homeLoaded = true;
      });
    }
  }
}

// ===== NOTIFICATION UI =====

function renderNotificationModal() {
  const modal = document.getElementById("notificationModal");
  if (!modal) return;

  const history = getNotificationHistory();
  if (!history.length) {
    modal.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; padding:2rem 1rem; gap:0.5rem;">
        <i class="fa-regular fa-bell" style="font-size:2rem; opacity:0.2;"></i>
        <span style="color:var(--text-secondary); opacity:0.6;">Belum ada notifikasi</span>
      </div>
    `;
    return;
  }

  modal.innerHTML = history.map(n => `
    <div style="padding:0.6rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.04); ${n.read ? 'opacity:0.5;' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:600; font-size:0.8rem; color:var(--text-primary);">${escapeHtml(n.title)}</span>
        <span style="font-size:0.55rem; color:var(--text-secondary); opacity:0.4;">${n.timestamp}</span>
      </div>
      <div style="font-size:0.7rem; color:var(--text-secondary); margin-top:0.1rem;">${escapeHtml(n.body)}</div>
    </div>
  `).join('');
}

// ===== DOM READY =====

document.addEventListener("DOMContentLoaded", () => {
  loadNotifications();
  updateNotifBadge();
  createParticles();
  initTabs();

  // Enable push button
  const pushBtn = document.getElementById("enablePushBtn");
  if (pushBtn) {
    pushBtn.addEventListener("click", async () => {
      const success = await subscribeToPush();
      if (success) {
        alert("✅ Notifikasi aktif! Token baru tersimpan.");
      } else {
        alert("❌ Gagal mengaktifkan notifikasi. Pastikan browser mendukung dan izin diberikan.");
      }
    });
  }

  // Signal menu parent click (dropdown toggle)
  const signalsParent = document.getElementById("signalsParent");
  const subMenu = document.getElementById("signalSubMenu");
  if (signalsParent && subMenu) {
    signalsParent.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = subMenu.classList.toggle("open");
      subMenu.style.display = isOpen ? "block" : "none";
      this.classList.toggle("open");
      const arrow = this.querySelector(".nav-arrow");
      if (arrow) arrow.classList.toggle("open");
    });
  }

  // Technical menu parent
  const technicalParent = document.getElementById("technicalParent");
  const technicalSubMenu = document.getElementById("technicalSubMenu");
  if (technicalParent && technicalSubMenu) {
    technicalParent.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = technicalSubMenu.classList.toggle("open");
      technicalSubMenu.style.display = isOpen ? "block" : "none";
      this.classList.toggle("open");
      const arrow = this.querySelector(".nav-arrow");
      if (arrow) arrow.classList.toggle("open");
    });
  }

  // News menu parent
  const newsParent = document.getElementById("newsParent");
  const newsSubMenu = document.getElementById("newsSubMenu");
  if (newsParent && newsSubMenu) {
    newsSubMenu.classList.remove("open");
    newsSubMenu.style.display = "none";
    newsParent.classList.remove("open");
    const arrow = newsParent.querySelector(".nav-arrow");
    if (arrow) arrow.classList.remove("open");

    newsParent.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = newsSubMenu.classList.toggle("open");
      newsSubMenu.style.display = isOpen ? "block" : "none";
      this.classList.toggle("open");
      const arrow = this.querySelector(".nav-arrow");
      if (arrow) arrow.classList.toggle("open");
    });
  }

  // Technical signal row click
  document.getElementById("technical-signals")?.addEventListener("click", (e) => {
    const row = e.target.closest(".sig-list-row");
    if (!row) return;
    const { stock, date } = row.dataset;
    const matchSig = [..._allRunning, ..._allClosed].find(
      (s) => s.stockCode === stock && s.signalDate === date
    );
    if (matchSig) {
      isDetailView = true;
      renderTechnicalSignalDetail(matchSig, document.getElementById("technical-signals"));
    }
  });

  // Signal list row click
  document.getElementById("signals")?.addEventListener("click", (e) => {
    const row = e.target.closest(".sig-list-row");
    if (!row) return;
    const { stock, date } = row.dataset;
    if (stock && date) {
      // showSignalDetailByStock
      const allSignals = getSortedSignals();
      const match = allSignals.find((s) => s.stockCode === stock && s.signalDate === date);
      if (match) {
        isDetailView = true;
        // For BSJP
        if (match.signalType === "BSJP") {
          const container = document.getElementById("signals");
          container._scrolled = false;
          renderBsjpDetail(match, container, () => showSignalList());
        } else {
          // Use renderSignalDetailToContainer
          const container = document.getElementById("signals");
          import("./signals.js").then(({ renderSignalDetailToContainer }) => {
            renderSignalDetailToContainer(match, container, () => showSignalList());
          });
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  });

  // Notification button
  const notifBtn = document.getElementById("notifBtn");
  if (notifBtn) {
    notifBtn.addEventListener("click", () => {
      renderNotificationModal();
      markAllAsRead();
      updateNotifBadge();
    });
  }

  initMobileMenu();
  initPullToRefresh();

  // Hash change handler
  window.addEventListener("hashchange", () => {
    const hash = window.location.hash;
    if (hash !== "#home") homeLoaded = false;

    if (hash === "#signals-today") selectSignalFilter("today");
    else if (hash === "#signals-running") selectSignalFilter("running");
    else if (hash === "#signals" || hash === "") {
      currentSignalFilter = "none";
      signalListRendered = false;
      showSignalList();
    } else if (hash === "#technical-today") selectTechnicalFilter("today");
    else if (hash === "#technical-running") selectTechnicalFilter("running");
    else if (hash === "#technical-waiting") selectTechnicalFilter("waiting");
    else if (hash.startsWith("#news-")) {
      const category = hash.replace("#news-", "");
      selectNewsCategory(category);
    } else if (hash === "#home") {
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      document.getElementById("home").classList.add("active");
      document.querySelectorAll(".nav-link, .nav-sub-link").forEach((b) => b.classList.remove("active"));
      document.querySelector('.nav-link[data-tab="home"]')?.classList.add("active");
      fetchReports();
      fetchSignals(false);
      showSignalList();
      setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 100);
    } else {
      window.location.hash = "home";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Initial load
  const currentHash = window.location.hash;
  if (currentHash !== "#home" && !currentHash.startsWith("#detail-") &&
      !currentHash.startsWith("#technical-") && !currentHash.startsWith("#signals-") &&
      !currentHash.startsWith("#news-")) {
    window.location.hash = "home";
  }

  // Show loading states
  showLoading("daily");
  showLoading("signals");
  showLoading("technical-signals");

  // Initial fetches
  fetchReports();
  fetchSignals(false);
  homeLoaded = true;
  showSignalList();

  // Start polling & SSE
  startPolling();
  connectPriceSSE();

  // Clock
  setInterval(updateClock, 1000);
  updateClock();
  updateLastUpdate();

  // Price update handler
  onPriceUpdate((updates) => {
    updates.forEach(({ symbol, price }) => {
      if (price != null) {
        // Update signal list prices
        const allSignals = getSortedSignals();
        const runningSignals = allSignals.filter(
          (s) => s.stockCode === symbol && (s.status === "RUNNING" || s.status === "TRAILING")
        );
        runningSignals.forEach((signal) => {
          const rows = document.querySelectorAll(
            `.sig-list-row[data-stock="${symbol}"][data-date="${signal.signalDate}"]`
          );
          rows.forEach((row) => {
            const priceEl = row.querySelector(".stock-price");
            const gainEl = row.querySelector(".sig-right span:last-child");
            if (!priceEl) return;
            if (price != null) {
              let arrow = "";
              const gain = ((price - signal.entryPrice) / signal.entryPrice) * 100;
              if (Math.abs(gain) < 0.01) {
                if (gainEl) { gainEl.innerHTML = `0 (0.00%)`; gainEl.style.color = "var(--text-secondary)"; }
              } else if (gain > 0) {
                const absGain = Math.abs(gain).toFixed(2);
                if (gainEl) {
                  gainEl.innerHTML = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i> +${absGain}%`;
                  gainEl.style.color = "#10b981";
                }
                arrow = '<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.7rem; margin-right:0.1rem;"></i>';
              } else {
                const absGain = Math.abs(gain).toFixed(2);
                if (gainEl) {
                  gainEl.innerHTML = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i> -${absGain}%`;
                  gainEl.style.color = "#ef4444";
                }
                arrow = '<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.7rem; margin-right:0.1rem;"></i>';
              }
              priceEl.innerHTML = `${arrow} ${fmtPriceNoRp(price)}`;
            } else {
              priceEl.textContent = "—";
            }
          });
        });
      }
    });
  });

  // Service Worker registration
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js")
        .then((registration) => {
          console.log("ServiceWorker berhasil didaftarkan dengan scope: ", registration.scope);
        })
        .catch((error) => {
          console.log("ServiceWorker gagal didaftarkan: ", error);
        });
    });
  }

  // Auto-refresh daily when filter changes
  document.addEventListener("filterChanged", () => {
    if (document.querySelector(".view.active")?.id === "daily") {
      renderDaily();
    }
  });

  console.log("🚀 Aplikasi siap!");
});

// Export for global access (for inline onclick)
window.loadNews = loadNews;
window.handleImageError = handleImageError;
window.fetchSignals = fetchSignals;
window.showDailySignalDetail = showDailySignalDetail;
