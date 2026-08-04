import { triggerHaptic } from "./utils.js";
import { selectSignalFilter, selectTechnicalFilter, fetchSignals } from "./signals.js";
import { selectNewsCategory } from "./news.js";
import { fetchReports } from "./main.js";

// ===== UI =====

export function createParticles() {
  const container = document.getElementById("particles");
  if (!container) return;
  for (let i = 0; i < 30; i++) {
    const p = document.createElement("div");
    const size = Math.random() * 2 + 1;
    p.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:rgba(255,255,255,0.06);border-radius:50%;left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation:float ${15 + Math.random() * 20}s infinite linear;animation-delay:${Math.random() * 5}s;`;
    container.appendChild(p);
  }
  const style = document.createElement("style");
  style.textContent = `@keyframes float { 0% { transform: translateY(0) translateX(0); opacity:0; } 10% { opacity:0.5; } 90% { opacity:0.5; } 100% { transform: translateY(-100vh) translateX(${Math.random() * 100 - 50}px); opacity:0; } }`;
  document.head.appendChild(style);
}

export function updateClock() {
  const clockEl = document.getElementById("clockDisplay");
  if (clockEl) {
    clockEl.innerText = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  const marketStatus = document.getElementById("marketStatus");
  if (marketStatus) {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    const isOpen = day >= 1 && day <= 5 && hour >= 9 && hour < 16;
    marketStatus.classList.toggle("open", isOpen);
    marketStatus.innerHTML = `<span class="dot"></span><span class="market-text">${isOpen ? "Market Open" : "Market Closed"}</span>`;
  }
}

export function updateLastUpdate() {
  const el = document.getElementById("last-update");
  if (el) {
    el.innerText = new Date().toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

export function closeAllDropdowns() {
  const signalSub = document.getElementById("signalSubMenu");
  const signalParent = document.getElementById("signalsParent");
  if (signalSub) {
    signalSub.classList.remove("open");
    signalSub.style.display = "none";
  }
  if (signalParent) {
    signalParent.classList.remove("open");
    const arrow = signalParent.querySelector(".nav-arrow");
    if (arrow) arrow.classList.remove("open");
  }

  const techSub = document.getElementById("technicalSubMenu");
  const techParent = document.getElementById("technicalParent");
  if (techSub) {
    techSub.classList.remove("open");
    techSub.style.display = "none";
  }
  if (techParent) {
    techParent.classList.remove("open");
    const arrow = techParent.querySelector(".nav-arrow");
    if (arrow) arrow.classList.remove("open");
  }

  const newsSub = document.getElementById("newsSubMenu");
  const newsParent = document.getElementById("newsParent");
  if (newsSub) {
    newsSub.classList.remove("open");
    newsSub.style.display = "none";
  }
  if (newsParent) {
    newsParent.classList.remove("open");
    const arrow = newsParent.querySelector(".nav-arrow");
    if (arrow) arrow.classList.remove("open");
  }
}

export function initTabs() {
  const btns = document.querySelectorAll(".nav-link, .nav-sub-link");
  const views = document.querySelectorAll(".view");
  const pageTitle = document.querySelector(".page-title");
  const pageSubtitle = document.querySelector(".page-subtitle");

  const titles = {
    home: { t: "Dashboard Overview", s: "Real-time monitoring & analysis" },
    daily: { t: "Laporan Harian", s: "Daily reports" },
    weekly: { t: "Laporan Mingguan", s: "Weekly summary" },
    monthly: { t: "Laporan Bulanan", s: "Monthly analytics" },
    signals: { t: "Sinyal Aktif", s: "All signals" },
    "signals-today": { t: "Sinyal Hari Ini", s: "Today's signals" },
    "signals-running": { t: "All Running", s: "Active positions" },
    "technical-today": { t: "Technical: Hari Ini", s: "Today's technical signals" },
    "technical-running": { t: "Technical: Running", s: "Active technical positions" },
    "technical-waiting": { t: "Technical: Waiting", s: "Pending execution setups" },
    news: { t: "Berita", s: "Kategori berita" },
    "news-buyback": { t: "Buy Back & Backdoor", s: "Berita buy back dan backdoor" },
    "news-akuisisi": { t: "Akuisisi & Merger", s: "Berita akuisisi dan merger" },
    "news-private": { t: "Private Placement", s: "Berita private placement" },
    "news-rightissue": { t: "Right Issue", s: "Berita right issue" },
    "news-dividen": { t: "Dividen", s: "Berita dividen" },
    "news-labarugi": { t: "Laba Rugi", s: "Berita laba rugi" },
    "news-tender": { t: "Tender Offer", s: "Berita tender offer" },
    "news-net": { t: "Net Sell / Buy Asing", s: "Berita net asing" },
    "news-konglomerasi": { t: "Konglomerasi", s: "Berita konglomerasi" },
    "news-sentimen": { t: "Sentimen Lainnya", s: "Berita sentimen" },
  };

  btns.forEach((btn) => {
    if (btn.id === "signalsParent" || btn.id === "technicalParent" || btn.id === "newsParent") return;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      triggerHaptic();
      closeAllDropdowns();

      const tabId = this.getAttribute("data-tab");
      const isSub = this.classList.contains("nav-sub-link");

      if (isSub) {
        if (tabId.startsWith("technical-")) {
          const subFilter = tabId.split("-")[1];
          selectTechnicalFilter(subFilter);
          btns.forEach((b) => b.classList.remove("active"));
          document.querySelector('.nav-link[data-tab="technical-signals"]')?.classList.add("active");
          this.classList.add("active");
          document.querySelector(".sidebar")?.classList.remove("open");
          document.querySelector(".overlay")?.classList.remove("active");
          return;
        } else if (tabId.startsWith("news-")) {
          const category = tabId.replace("news-", "");
          selectNewsCategory(category);
          btns.forEach((b) => b.classList.remove("active"));
          this.classList.add("active");
          document.querySelector('.nav-link[data-tab="news"]')?.classList.add("active");
          document.querySelector(".sidebar")?.classList.remove("open");
          document.querySelector(".overlay")?.classList.remove("active");
          return;
        } else {
          if (tabId === "signals-today") selectSignalFilter("today");
          else if (tabId === "signals-running") selectSignalFilter("running");
          else selectSignalFilter("all");
          btns.forEach((b) => b.classList.remove("active"));
          document.querySelector('.nav-link[data-tab="signals"]')?.classList.add("active");
          this.classList.add("active");
          document.querySelector(".sidebar")?.classList.remove("open");
          document.querySelector(".overlay")?.classList.remove("active");
          return;
        }
      }

      // Main tabs
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      document.getElementById(tabId).classList.add("active");
      btns.forEach((b) => b.classList.remove("active"));
      this.classList.add("active");

      if (titles[tabId]) {
        pageTitle.innerText = titles[tabId].t;
        pageSubtitle.innerText = titles[tabId].s;
      }

      if (tabId === "daily") {
        fetchReports();
      }
      if (tabId === "signals") {
        fetchSignals(true);
      }
      if (tabId === "technical-signals") {
        fetchSignals(true);
      }
      if (tabId === "news") {
        const container = document.getElementById("news");
        if (container) {
          container.innerHTML = `
            <div class="loading-state" style="text-align:center; padding:2rem;">
              <p style="color:var(--text-secondary);">📰 Pilih kategori berita dari menu.</p>
            </div>
          `;
        }
      }
      if (tabId === "home") {
        fetchReports();
        fetchSignals(false);
        setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 100);
      }

      document.querySelector(".sidebar")?.classList.remove("open");
      document.querySelector(".overlay")?.classList.remove("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

export function initMobileMenu() {
  const toggle = document.getElementById("menuToggle");
  const sidebar = document.querySelector(".sidebar");
  if (toggle) {
    toggle.addEventListener("click", () => {
      triggerHaptic();
      sidebar.classList.toggle("open");
      let overlay = document.querySelector(".overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "overlay";
        document.body.appendChild(overlay);
      }
      overlay.classList.toggle("active");
      overlay.onclick = () => {
        sidebar.classList.remove("open");
        overlay.classList.remove("active");
      };
    });
  }
}

export function initPullToRefresh() {
  const wrapper = document.getElementById("pullToRefresh");
  const indicator = document.querySelector(".pull-indicator");
  let startY = 0, endY = 0;

  wrapper.addEventListener("touchstart", (e) => {
    if (window.scrollY === 0) startY = e.touches[0].clientY;
  }, { passive: true });

  wrapper.addEventListener("touchmove", (e) => {
    if (window.scrollY === 0 && startY > 0) {
      endY = e.touches[0].clientY;
      const diff = endY - startY;
      if (diff > 0 && diff < 200) {
        indicator.classList.add("visible");
        indicator.style.transform = `translateX(-50%) translateY(${diff * 0.5}px)`;
      }
    }
  }, { passive: true });

  wrapper.addEventListener("touchend", () => {
    if (startY > 0 && endY > 0 && endY - startY > 100 && window.scrollY === 0) {
      triggerHaptic();
      // Refresh logic from main.js
      import("./main.js").then(({ fetchReports }) => {
        fetchReports();
        fetchSignals(true);
      });
      setTimeout(() => {
        indicator.classList.remove("visible");
        indicator.style.transform = "translateX(-50%) translateY(0)";
      }, 1000);
    } else {
      indicator.classList.remove("visible");
      indicator.style.transform = "translateX(-50%) translateY(0)";
    }
    startY = 0;
    endY = 0;
  });
}
