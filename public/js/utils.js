// ===== UTILITY FUNCTIONS =====

export function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function fmtPrice(num) {
  return num != null ? `Rp${Number(num).toLocaleString("id-ID")}` : "–";
}

export function fmtPriceNoRp(num) {
  return num != null ? Number(num).toLocaleString("id-ID") : "–";
}

export function getTodayWIB() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

export function formatFullDateTime(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return dateStr;
  }
}

export function getColorFromCode(code) {
  const colors = [
    "#10b981",
    "#3b82f6",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
    "#f97316",
    "#6366f1",
    "#06b6d4",
  ];
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = code.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function isNewNews(publishedAt) {
  if (!publishedAt) return false;
  const pubDate = new Date(publishedAt);
  const now = new Date();
  const diffInHours = (now - pubDate) / (1000 * 60 * 60);
  return diffInHours <= 48;
}

export function getSessionFromDate(signalDate) {
  if (!signalDate) return null;
  const date = new Date(signalDate);
  const hour = date.getHours();
  const minute = date.getMinutes();
  const time = hour + minute / 60;
  if (time >= 4 && time < 12) return 1;
  if (time >= 12 && time <= 16) return 2;
  return null;
}

export function formatReportText(text) {
  if (!text) return "";
  return text
    .replace(/\n/g, "<br>")
    .replace(/\*([^*]+)\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

export function triggerHaptic() {
  if (navigator.vibrate) navigator.vibrate(30);
}

export function showLoading(containerId) {
  const c = document.getElementById(containerId);
  if (c) {
    c.innerHTML = `
      <div class="loading-state">
        <div class="loader">
          <div class="loader-ring"></div>
          <div class="loader-ring"></div>
          <div class="loader-ring"></div>
        </div>
        <p>Loading...</p>
      </div>
    `;
  }
}

export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function getCategoryIconHtml(category) {
  if (!category) return `<i class="fas fa-tag" style="font-size:0.6rem;"></i>`;
  const c = category.trim().toUpperCase();

  if (c.includes("BUY BACK") || c.includes("BUYBACK") || c.includes("BACKDOOR")) {
    return `<i class="fas fa-rotate-left" style="color:#3b82f6; font-size:0.65rem;"></i>`;
  }
  if (c.includes("AKUISISI") || c.includes("MERGER")) {
    return `<i class="fas fa-handshake" style="color:#ec4899; font-size:0.65rem;"></i>`;
  }
  if (c.includes("PRIVATE") || c.includes("PLACEMENT")) {
    return `<i class="fas fa-user-plus" style="color:#6366f1; font-size:0.65rem;"></i>`;
  }
  if (c.includes("RIGHT") || c.includes("RIGHTS")) {
    return `<img src="https://assets.stockbit.com/images/corp_action_event_icon.svg" class="cat-icon-img" alt="Right Issue">`;
  }
  if (c.includes("DIVIDEN") || c.includes("DIVIDEND")) {
    return `<i class="fas fa-coins" style="color:#f59e0b; font-size:0.65rem;"></i>`;
  }
  if (c.includes("LABA") || c.includes("RUGI") || c.includes("FINANCIAL")) {
    return `<i class="fas fa-chart-pie" style="color:#10b981; font-size:0.65rem;"></i>`;
  }
  if (c.includes("TENDER") || c.includes("OFFER")) {
    return `<i class="fas fa-gavel" style="color:#eab308; font-size:0.65rem;"></i>`;
  }
  if (c.includes("ASING") || c.includes("NET SELL") || c.includes("NET BUY")) {
    return `<i class="fas fa-chart-line" style="color:#06b6d4; font-size:0.65rem;"></i>`;
  }
  if (c.includes("KONGLOMERASI") || c.includes("GROUP")) {
    return `<i class="fas fa-building" style="color:#8b5cf6; font-size:0.65rem;"></i>`;
  }
  if (c.includes("SENTIMEN") || c.includes("LAINNYA")) {
    return `<i class="fas fa-comment-dots" style="color:#9ca3af; font-size:0.65rem;"></i>`;
  }
  return `<i class="fas fa-tag" style="font-size:0.6rem; color:#a78bfa;"></i>`;
}

export function renderStockTagsHtml(stockCodes) {
  if (!stockCodes || !Array.isArray(stockCodes)) return "";
  return stockCodes
    .filter((code) => code && code.trim())
    .map((code) => {
      const c = code.trim().toUpperCase();
      const logoUrl = `https://assets.stockbit.com/logos/companies/${c}.png`;
      const fallbackUrl = `https://assets.parqet.com/logos/symbol/${c}.png`;
      return `
        <span class="news-stock-tag">
          <img 
            src="${logoUrl}" 
            alt="${c}" 
            class="news-stock-logo" 
            onerror="this.onerror=null; this.src='${fallbackUrl}'; this.onerror=function(){ this.style.display='none'; }"
          >
          <span>${escapeHtml(c)}</span>
        </span>
      `;
    })
    .join("");
}

export function getDateRangeText(filterType, customStart, customEnd) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);
  switch (filterType) {
    case "today":
      return `Today, ${now.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`;
    case "7days":
      start.setDate(now.getDate() - 7);
      return `${start.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} - ${end.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`;
    case "1month":
      start.setMonth(now.getMonth() - 1);
      return `${start.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} - ${end.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`;
    case "custom":
      if (customStart && customEnd) {
        const s = new Date(customStart);
        const e = new Date(customEnd);
        return `${s.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })} - ${e.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`;
      }
      return "Custom Range";
    default:
      return "All Time";
  }
}
