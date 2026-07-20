const apiBase = "/api";

let sseConnection = null;
const localPrices = new Map();

function connectPriceSSE() {
  if (sseConnection) {
    sseConnection.close();
    sseConnection = null;
  }

  sseConnection = new EventSource("/api/sse/prices");

  sseConnection.onmessage = function (event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "price" && data.updates) {
        data.updates.forEach(({ symbol, price }) => {
          if (price != null) {
            localPrices.set(symbol, price);
            updatePriceElement(symbol, price);
          }
        });
      }
    } catch (e) {
      console.warn("SSE parse error:", e);
    }
  };

  sseConnection.onerror = function () {
    console.warn("SSE connection lost, reconnecting in 3s...");
    sseConnection.close();
    sseConnection = null;
    setTimeout(connectPriceSSE, 3000);
  };

  console.log("✅ SSE price stream connected");
}
let refreshInterval = null;
let lastSignalCount = 0;
let equityChart = null,
  winRateChart = null,
  signalChart = null;
let pollingInterval = null;
let currentTab = "home";
let detailCharts = { rsi: null, macd: null, bandar: null };
let _allRunning = [];
let _allClosed = [];
let currentSignalFilter = "none";

let currentTechnicalFilter = "none";
let technicalListRendered = false;

let isDetailView = false;
let currentDetailIndex = null;
let bsjpRefreshInterval = null;

let dailyRendered = false;
let signalListRendered = false;
let currentFilterState = {
  type: "today",
  customStart: null,
  customEnd: null,
  isOpen: false,
};
let currentDateRange = null;

let notificationHistory = [];
const NOTIF_KEY = "notificationHistory";

function loadNotifications() {
  try {
    const data = localStorage.getItem(NOTIF_KEY);
    if (data) notificationHistory = JSON.parse(data);
    else notificationHistory = [];
  } catch (e) {
    notificationHistory = [];
  }
}

function saveNotifications() {
  try {
    localStorage.setItem(NOTIF_KEY, JSON.stringify(notificationHistory));
  } catch (e) {}
}

function addNotification(title, body, type = "signal") {
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

function getUnreadCount() {
  return notificationHistory.filter((n) => !n.read).length;
}

function updateNotifBadge() {
  const badge = document.querySelector(".notif-badge");
  if (!badge) return;
  badge.style.display = "none";
}

function markAllAsRead() {
  notificationHistory.forEach((n) => (n.read = true));
  saveNotifications();
  updateNotifBadge();
}

function clearAllNotifications() {
  notificationHistory = [];
  saveNotifications();
  updateNotifBadge();
  renderNotificationModal();
}

function getTodayWIB() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

function triggerHaptic() {
  if (navigator.vibrate) navigator.vibrate(30);
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(
    /[&<>]/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[m] || m,
  );
}

function buildTagItems(s) {
  const items = [];
  const chart = (s.patternChart || "").toLowerCase();
  const candle = (s.patternCandle || "").toLowerCase();
  const signalType = (s.signalType || "").toUpperCase();
  const isBuy = signalType.includes("BUY");
  const isSell = signalType.includes("SELL");

  if (chart.includes("breakout")) {
    items.push({ label: "Breakout", icon: "fa-arrow-right-to-bracket" });
  } else if (chart.includes("pullback")) {
    items.push({ label: "Pullback", icon: "fa-arrow-turn-down" });
  } else if (chart.includes("consolidation") || chart.includes("base")) {
    items.push({ label: "Consolidation", icon: "fa-arrows-left-right" });
  } else if (chart.includes("reversal")) {
    items.push({ label: "Reversal", icon: "fa-rotate-right" });
  } else if (chart.includes("trend")) {
    items.push({ label: "Trend", icon: "fa-chart-line" });
  }

  if (chart.includes("support") || candle.includes("support")) {
    items.push({ label: "Support Test", icon: "fa-angles-up" });
  }
  if (chart.includes("resistance") || candle.includes("resistance")) {
    items.push({ label: "Resistance Test", icon: "fa-angles-down" });
  }

  const candlePatterns = [
    { keywords: ["doji"], label: "Doji", icon: "fa-plus" },
    { keywords: ["harami"], label: "Harami", icon: "fa-circle-half-stroke" },
    {
      keywords: ["engulfing"],
      label: "Engulfing",
      icon: "fa-up-right-and-down-left-from-center",
    },
    { keywords: ["hammer"], label: "Hammer", icon: "fa-gavel" },
    { keywords: ["shooting star"], label: "Shooting Star", icon: "fa-star" },
    { keywords: ["marubozu"], label: "Marubozu", icon: "fa-battery-full" },
    { keywords: ["spinning top"], label: "Spinning Top", icon: "fa-circle" },
    { keywords: ["inside bar"], label: "Inside Bar", icon: "fa-minimize" },
  ];

  for (const pattern of candlePatterns) {
    if (pattern.keywords.some((kw) => candle.includes(kw))) {
      items.push({ label: pattern.label, icon: pattern.icon });
      break;
    }
  }

  const hasChartDirection =
    chart.includes("uptrend") || chart.includes("downtrend");
  const hasCandleDirection =
    candle.includes("bullish") || candle.includes("bearish");

  if (hasChartDirection) {
    if (chart.includes("uptrend")) {
      items.push({ label: "Uptrend", icon: "fa-arrow-trend-up" });
    } else if (chart.includes("downtrend")) {
      items.push({ label: "Downtrend", icon: "fa-arrow-trend-down" });
    }
  } else if (
    hasCandleDirection &&
    !items.some((i) => i.label === "Pullback" || i.label === "Support Test")
  ) {
    if (candle.includes("bullish")) {
      items.push({ label: "Bullish Candle", icon: "fa-arrow-trend-up" });
    } else if (candle.includes("bearish")) {
      items.push({ label: "Bearish Candle", icon: "fa-arrow-trend-down" });
    }
  }

  if (items.length === 0) {
    items.push({ label: "Monitor", icon: "fa-eye" });
  }

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    if (!seen.has(item.label)) {
      seen.add(item.label);
      unique.push(item);
    }
  }

  return unique;
}

function renderTagHtml(s, inline = false) {
  const items = buildTagItems(s);
  const cls = inline ? "emit-tag-group inline" : "emit-tag-group";
  return items.length
    ? `<div class="${cls}">${items
        .map(
          (t) =>
            `<span class="emit-tag"><i class="fa-solid ${t.icon}" style="margin-right:3px; font-size:0.65rem;"></i>${t.label}</span>`,
        )
        .join("")}</div>`
    : "";
}

function formatReportText(text) {
  if (!text) return "";
  return text
    .replace(/\n/g, "<br>")
    .replace(/\*([^*]+)\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function fmtPrice(num) {
  return num != null ? `Rp${Number(num).toLocaleString("id-ID")}` : "–";
}

function fmtPriceNoRp(num) {
  return num != null ? Number(num).toLocaleString("id-ID") : "–";
}

const infoCache = new Map();

async function fetchStockPrice(symbol) {
  if (localPrices.has(symbol)) {
    return localPrices.get(symbol);
  }
  return null;
}

async function fetchStockInfo(symbol) {
  if (infoCache.has(symbol)) {
    const cached = infoCache.get(symbol);
    if (Date.now() - cached.timestamp < 3600000) {
      return cached.data;
    }
  }
  try {
    const response = await fetch(`/api/stock-info/${symbol}`);
    if (!response.ok) throw new Error("Network error");
    const data = await response.json();
    infoCache.set(symbol, { data, timestamp: Date.now() });
    return data;
  } catch (e) {
    console.warn(`Gagal fetch info ${symbol}:`, e);
    return { symbol, longName: symbol, logoUrl: null };
  }
}

function showLoading(containerId) {
  const c = document.getElementById(containerId);
  if (c)
    c.innerHTML = `<div class="loading-state"><div class="loader"><div class="loader-ring"></div><div class="loader-ring"></div><div class="loader-ring"></div></div><p>Loading...</p></div>`;
}

function filterSignalsByDate(signals, startDate, endDate) {
  if (!signals || !signals.length) return [];
  return signals.filter((s) => {
    let dateToCheck = null;
    if (s.status === "TP" || s.status === "SL" || s.status === "STOP LOSS") {
      dateToCheck = s.closeDate ? s.closeDate.split(" ")[0] : null;
    } else if (s.status === "RUNNING" || s.status === "TRAILING") {
      dateToCheck = s.signalDate ? s.signalDate.split(" ")[0] : null;
    } else if (s.status === "WAITING_ENTRY") {
      dateToCheck = s.signalDate ? s.signalDate.split(" ")[0] : null;
    } else {
      dateToCheck = s.signalDate ? s.signalDate.split(" ")[0] : null;
    }
    if (!dateToCheck) return false;
    return dateToCheck >= startDate && dateToCheck <= endDate;
  });
}

function aggregateSignals(signals) {
  const result = {
    totalSignals: 0,
    tp: 0,
    sl: 0,
    running: 0,
    winRate: 0,
    totalReturn: 0,
    bestTrade: null,
    worstTrade: null,
    positions: [],
  };

  const closed = signals.filter(
    (s) => s.status === "TP" || s.status === "SL" || s.status === "STOP LOSS",
  );
  const runningSignals = signals.filter(
    (s) => s.status === "RUNNING" || s.status === "TRAILING",
  );

  result.tp = closed.filter((s) => s.status === "TP").length;
  result.sl = closed.filter(
    (s) => s.status === "SL" || s.status === "STOP LOSS",
  ).length;
  result.totalSignals = closed.length + runningSignals.length;
  result.running = runningSignals.length;

  const totalClosed = result.tp + result.sl;
  result.winRate =
    totalClosed > 0 ? Math.round((result.tp / totalClosed) * 100 * 10) / 10 : 0;

  let totalRet = 0;
  closed.forEach((s) => {
    totalRet += s.returnPercent || 0;
  });
  result.totalReturn = Math.round(totalRet * 100) / 100;

  if (closed.length) {
    const sorted = [...closed].sort(
      (a, b) => (b.returnPercent || 0) - (a.returnPercent || 0),
    );
    const best = sorted[0];
    if (best && best.returnPercent > 0) {
      result.bestTrade = { stock: best.stockCode, return: best.returnPercent };
    }
    const worst = sorted[sorted.length - 1];
    if (worst && worst.returnPercent < 0) {
      result.worstTrade = {
        stock: worst.stockCode,
        return: worst.returnPercent,
      };
    }
  }

  result.positions = runningSignals.map((s) => ({
    stock: s.stockCode,
    entry: s.entryPrice,
    current: null,
    return: 0,
    hold: s.holdingDays || 0,
  }));

  return result;
}

function getDateRangeText(filterType, customStart, customEnd) {
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

function createStatCard(label, value, color, icon) {
  return `
    <div style="background:rgba(255,255,255,0.02); border-radius:12px; padding:1rem; border:1px solid rgba(255,255,255,0.06); transition:all 0.2s; backdrop-filter:blur(4px);">
      <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.3rem;">
        <i class="${icon}" style="color:${color}; font-size:1rem;"></i>
        <span style="font-size:0.65rem; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">${label}</span>
      </div>
      <div style="font-family:'JetBrains Mono'; font-size:1.5rem; font-weight:700; color:${color};">${value}</div>
    </div>
  `;
}

function getDateRangeFromFilterState() {
  const todayStr = getTodayWIB();
  const now = new Date();
  let startStr, endStr;

  switch (currentFilterState.type) {
    case "today":
      startStr = todayStr;
      endStr = todayStr;
      break;
    case "7days": {
      const d7 = new Date(now);
      d7.setDate(d7.getDate() - 7);
      startStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
      }).format(d7);
      endStr = todayStr;
      break;
    }
    case "1month": {
      const dm = new Date(now);
      dm.setMonth(dm.getMonth() - 1);
      startStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
      }).format(dm);
      endStr = todayStr;
      break;
    }
    case "custom":
      startStr = currentFilterState.customStart || todayStr;
      endStr = currentFilterState.customEnd || todayStr;
      break;
    default:
      startStr = "1970-01-01";
      endStr = todayStr;
  }
  return { start: startStr, end: endStr };
}

let returnChartInstance = null;

function renderDailyReturnChartFromSignals(signals) {
  const wrapper = document.getElementById("dailyReturnChartWrapper");
  if (!wrapper) return;

  if (returnChartInstance) {
    returnChartInstance.destroy();
    returnChartInstance = null;
  }

  const closed = signals
    .filter(
      (s) => s.status === "TP" || s.status === "SL" || s.status === "STOP LOSS",
    )
    .sort((a, b) => (a.closeDate || "").localeCompare(b.closeDate || ""));

  if (!closed.length) {
    wrapper.innerHTML =
      '<div style="text-align:center;color:var(--text-secondary);padding:4rem 1.5rem;font-size:0.9rem;">Tidak ada data untuk ditampilkan.</div>';
    return;
  }

  wrapper.innerHTML = '<canvas id="dailyReturnChart"></canvas>';
  const ctx = document.getElementById("dailyReturnChart");

  const labels = closed.map((s, idx) => `T${idx + 1}`);
  let cumulative = 0;
  const dataPoints = closed.map((s) => {
    cumulative += s.returnPercent || 0;
    return cumulative;
  });

  const labelsWithStart = ["Start", ...labels];
  const dataWithStart = [0, ...dataPoints];

  const finalValue = cumulative;
  const isPositive = finalValue >= 0;
  const chartColor = isPositive ? "#10b981" : "#ef4444";
  const chartBg = isPositive ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)";

  returnChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labelsWithStart,
      datasets: [
        {
          label: "Cumulative Return %",
          data: dataWithStart,
          borderColor: chartColor,
          backgroundColor: chartBg,
          borderWidth: 2.5,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: "#ffffff",
          pointHoverBorderColor: chartColor,
          pointHoverBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index",
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(0,0,0,0.9)",
          titleColor: "#ffffff",
          bodyColor: chartColor,
          borderColor: chartColor + "44",
          borderWidth: 1,
          cornerRadius: 10,
          padding: 12,
          callbacks: {
            label: function (context) {
              const val = context.parsed.y;
              return "Return: " + (val >= 0 ? "+" : "") + val.toFixed(2) + "%";
            },
          },
        },
      },
      scales: {
        y: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: {
            color: "#71717a",
            callback: function (value) {
              return (value >= 0 ? "+" : "") + value.toFixed(2) + "%";
            },
          },
        },
        x: {
          grid: { display: false },
          ticks: { color: "#71717a", maxRotation: 45, autoSkip: true },
        },
      },
    },
  });
}

async function updateDailyContent() {
  await fetchSignals(false);

  const allSignals = [..._allRunning, ..._allClosed].filter(
    (s) => s.status !== "WAITING_ENTRY" && s.status !== "EXPIRED",
  );

  const { start, end } = getDateRangeFromFilterState();
  const filtered = filterSignalsByDate(allSignals, start, end);
  const agg = aggregateSignals(filtered);

  const dateRange = getDateRangeText(
    currentFilterState.type,
    currentFilterState.customStart,
    currentFilterState.customEnd,
  );

  const dateRangeEl = document.getElementById("reportDateRange");
  if (dateRangeEl) dateRangeEl.textContent = dateRange;

  const statsContainer = document.getElementById("statsGridContainer");
  if (statsContainer) {
    statsContainer.innerHTML = `
      ${createStatCard("Sinyal Baru", agg.totalSignals, "#3b82f6", "fa-solid fa-bell")}
      ${createStatCard("TP", agg.tp, "#10b981", "fa-solid fa-check-circle")}
      ${createStatCard("SL", agg.sl, "#ef4444", "fa-solid fa-times-circle")}
      ${createStatCard("Running", agg.running, "#f59e0b", "fa-solid fa-play-circle")}
      ${createStatCard("Win Rate", agg.winRate.toFixed(1) + "%", "#8b5cf6", "fa-solid fa-trophy")}
      ${createStatCard("Total Return", agg.totalReturn.toFixed(2) + "%", agg.totalReturn >= 0 ? "#10b981" : "#ef4444", "fa-solid fa-arrow-trend-up")}
    `;
  }

  const bestWorstContainer = document.getElementById("bestWorstContainer");
  if (bestWorstContainer) {
    bestWorstContainer.innerHTML = `
      <div class="pro-card" style="border-left: 3px solid #10b981;">
        <div class="pro-card-title"><i class="fa-solid fa-crown" style="color:#fbbf24; margin-right:0.3rem;"></i> Best Trade</div>
        ${agg.bestTrade ? `<div style="font-size:1.2rem; font-weight:700; color:#10b981;">${agg.bestTrade.stock} <span style="font-size:0.9rem; font-weight:400; color:var(--text-secondary);">+${agg.bestTrade.return.toFixed(2)}%</span></div>` : '<div style="color:var(--text-secondary); opacity:0.5;">Belum ada</div>'}
      </div>
      <div class="pro-card" style="border-left: 3px solid #ef4444;">
        <div class="pro-card-title"><i class="fa-solid fa-skull" style="color:#ef4444; margin-right:0.3rem;"></i> Worst Trade</div>
        ${agg.worstTrade ? `<div style="font-size:1.2rem; font-weight:700; color:#ef4444;">${agg.worstTrade.stock} <span style="font-size:0.9rem; font-weight:400; color:var(--text-secondary);">${agg.worstTrade.return.toFixed(2)}%</span></div>` : '<div style="color:var(--text-secondary); opacity:0.5;">Belum ada</div>'}
      </div>
    `;
  }

  const positionsContainer = document.getElementById("positionsContainer");
  if (positionsContainer) {
    if (agg.positions.length) {
      const posWithPrice = await Promise.all(
        agg.positions.map(async (p) => {
          const price = await fetchStockPrice(p.stock);
          let currentReturn = 0;
          if (price && p.entry) {
            currentReturn = ((price - p.entry) / p.entry) * 100;
          }
          return { ...p, current: price, return: currentReturn };
        }),
      );

      positionsContainer.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:1rem;">
          <i class="fa-solid fa-list" style="color:var(--text-secondary);"></i>
          <span style="font-weight:600; font-size:1rem; color:var(--text-primary);">Posisi Berjalan</span>
          <span style="font-size:0.7rem; color:var(--text-secondary); opacity:0.6;">(${posWithPrice.length})</span>
        </div>
        <div class="sig-list" style="gap:0.4rem;">
          ${posWithPrice
            .map(
              (p) => `
            <div class="sig-list-row" style="cursor:default; min-height:64px;">
              <div class="sig-list-logo">
                <div class="stock-logo-wrapper" style="width:32px; height:32px;">
                  <img src="https://assets.stockbit.com/logos/companies/${p.stock}.png" 
                    alt="${p.stock}" class="stock-logo"
                    onerror="this.onerror=null; this.src='https://assets.parqet.com/logos/symbol/${p.stock}.png'; this.onerror=function(){ this.style.display='none'; }">
                  <div class="stock-logo-fallback" style="display:none; width:32px; height:32px; background:${getColorFromCode(p.stock)}; border-radius:4px; font-size:0.6rem; align-items:center; justify-content:center; color:#fff; font-weight:700;">${p.stock.substring(0, 2)}</div>
                </div>
              </div>
              <div class="sig-list-name">
                <div class="sig-name-row">
                  <div class="sig-stock-info">
                    <div class="sig-stock-top">
                      <span class="sig-stock-code" style="font-size:0.85rem;">${p.stock}</span>
                      <span class="conf-score-badge" style="font-size:0.55rem;"><i class="far fa-clock" style="margin-right:0.2rem;"></i>${p.hold} hari</span>
                    </div>
                    <div class="sig-stock-longname" style="font-size:0.6rem;">Entry ${fmtPrice(p.entry)}</div>
                  </div>
                  <div class="sig-right" style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0; margin-left:auto;">
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.05rem;">
                      <span class="stock-price" style="font-size:0.8rem; font-weight:600; color:var(--text-primary);">${p.current ? fmtPriceNoRp(p.current) : "—"}</span>
                      <span style="font-family:'JetBrains Mono'; font-size:0.6rem; color:${p.return >= 0 ? "#10b981" : "#ef4444"}; font-weight:600; display:flex; align-items:center; gap:0.2rem;">
                        ${p.return >= 0 ? '<i class="fa-solid fa-arrow-trend-up" style="font-size:0.6rem; color:#10b981;"></i>' : '<i class="fa-solid fa-arrow-trend-down" style="font-size:0.6rem; color:#ef4444;"></i>'}
                        ${p.return.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      `;
    } else {
      positionsContainer.innerHTML = "";
    }
  }

  renderDailyReturnChartFromSignals(filtered);
  renderDailyCharts(agg);

  currentDateRange = { start, end };
  const listBody = document.getElementById("signalListBody");
  if (listBody && listBody.style.display !== "none") {
    const activeBtn = document.querySelector(".perf-filter-btn.active");
    if (activeBtn) {
      renderPerformanceSignalList(activeBtn.dataset.status);
    } else {
      renderPerformanceSignalList("TP");
    }
  }
}

async function renderDaily() {
  const c = document.getElementById("daily");
  if (!c) return;

  c.innerHTML = `<div class="loading-state"><div class="loader"><div class="loader-ring"></div><div class="loader-ring"></div><div class="loader-ring"></div></div><p>Loading...</p></div>`;
  dailyRendered = false;

  await fetchSignals(false);

  const allSignals = [..._allRunning, ..._allClosed].filter(
    (s) => s.status !== "WAITING_ENTRY" && s.status !== "EXPIRED",
  );

  if (!allSignals.length) {
    c.innerHTML = `<div class="loading-state"><p>Belum ada data sinyal (exclude waiting & expired).</p></div>`;
    dailyRendered = false;
    return;
  }

  const { start, end } = getDateRangeFromFilterState();
  currentDateRange = { start, end };
  const filtered = filterSignalsByDate(allSignals, start, end);
  const agg = aggregateSignals(filtered);
  const dateRange = getDateRangeText(
    currentFilterState.type,
    currentFilterState.customStart,
    currentFilterState.customEnd,
  );

  let html = `
    <div id="dailyContentWrapper">
      <div class="pro-detail-container">
        <div id="tradeSummaryContainer" style="margin-bottom:0.5rem;"></div>

        <div id="reportHeader" style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; margin-bottom:1.5rem; padding-bottom:0.5rem; border-bottom:1px solid rgba(255,255,255,0.06);">
          <div class="emit-left">
            <span class="emit-ticker" style="font-size:1.5rem;">
              <i class="fas fa-chart-line" style="color:#3b82f6; margin-right:0.5rem;"></i> Trade Summary
            </span>
            <span id="reportDateRange" style="font-size:0.8rem; color:var(--text-secondary); font-family:'JetBrains Mono',monospace;">${dateRange}</span>
          </div>
          <div class="emit-right">
            <span class="emit-date"><i class="far fa-calendar-alt" style="margin-right:0.3rem;"></i> ${new Date().toLocaleString("id-ID")}</span>
          </div>
        </div>

        <div id="statsGridContainer" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:1rem; margin-bottom:1.5rem;">
          ${createStatCard("Sinyal Baru", agg.totalSignals, "#3b82f6", "fa-solid fa-bell")}
          ${createStatCard("TP", agg.tp, "#10b981", "fa-solid fa-check-circle")}
          ${createStatCard("SL", agg.sl, "#ef4444", "fa-solid fa-times-circle")}
          ${createStatCard("Running", agg.running, "#f59e0b", "fa-solid fa-play-circle")}
          ${createStatCard("Win Rate", agg.winRate.toFixed(1) + "%", "#8b5cf6", "fa-solid fa-trophy")}
          ${createStatCard("Total Return", agg.totalReturn.toFixed(2) + "%", agg.totalReturn >= 0 ? "#10b981" : "#ef4444", "fa-solid fa-arrow-trend-up")}
        </div>

        <div id="bestWorstContainer" style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom:1.5rem;">
          <div class="pro-card" style="border-left: 3px solid #10b981;">
            <div class="pro-card-title"><i class="fa-solid fa-crown" style="color:#fbbf24; margin-right:0.3rem;"></i> Best Trade</div>
            ${agg.bestTrade ? `<div style="font-size:1.2rem; font-weight:700; color:#10b981;">${agg.bestTrade.stock} <span style="font-size:0.9rem; font-weight:400; color:var(--text-secondary);">+${agg.bestTrade.return.toFixed(2)}%</span></div>` : '<div style="color:var(--text-secondary); opacity:0.5;">Belum ada</div>'}
          </div>
          <div class="pro-card" style="border-left: 3px solid #ef4444;">
            <div class="pro-card-title"><i class="fa-solid fa-skull" style="color:#ef4444; margin-right:0.3rem;"></i> Worst Trade</div>
            ${agg.worstTrade ? `<div style="font-size:1.2rem; font-weight:700; color:#ef4444;">${agg.worstTrade.stock} <span style="font-size:0.9rem; font-weight:400; color:var(--text-secondary);">${agg.worstTrade.return.toFixed(2)}%</span></div>` : '<div style="color:var(--text-secondary); opacity:0.5;">Belum ada</div>'}
          </div>
        </div>

        <div class="pro-card" style="margin-bottom:1.5rem;">
          <div class="pro-card-title"><i class="fa-solid fa-chart-line" style="margin-right:0.3rem;"></i> Cumulative Return Gain</div>
          <div style="height:180px;" id="dailyReturnChartWrapper">
            <canvas id="dailyReturnChart"></canvas>
          </div>
        </div>

        <div class="pro-grid-2" style="margin-bottom:1.5rem;">
          <div class="pro-card">
            <div class="pro-card-title"><i class="fa-solid fa-chart-pie" style="margin-right:0.3rem;"></i> Win Rate</div>
            <div style="height:140px; position:relative;">
              <canvas id="dailyWinRateChart"></canvas>
            </div>
          </div>
        </div>

        <div style="margin-top:2rem; border-top:1px solid rgba(255,255,255,0.06); padding-top:1.5rem;">
          <div style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; padding:0.4rem 0.6rem; background:rgba(255,255,255,0.02); border-radius:8px; border:1px solid rgba(255,255,255,0.06); transition:0.2s;" id="signalListToggle">
            <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary); display:flex; align-items:center; gap:0.5rem;">
              <i class="fas fa-list-ul" style="color:#8b5cf6;"></i> Daftar Saham
              <span id="signalTotalCount" style="font-size:0.7rem; color:var(--text-secondary); background:rgba(255,255,255,0.05); padding:0.1rem 0.5rem; border-radius:12px;">0</span>
            </span>
            <i class="fas fa-chevron-up" id="signalListChevron" style="font-size:0.7rem; opacity:0.5; transition:transform 0.2s; margin-left:auto;"></i>
          </div>
          <div id="signalListBody" style="display:block; margin-top:0.75rem;">
            <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap; margin-bottom:0.75rem; padding:0.2rem 0;">
              <button class="perf-filter-btn active" data-status="TP" style="padding:0.25rem 0.7rem; cursor:pointer; font-size:0.7rem; transition:0.2s; display:flex; align-items:center; gap:0.3rem;">
                <i class="fa-solid fa-arrow-trend-up" style="font-size:0.6rem;"></i> TP
              </button>
              <button class="perf-filter-btn" data-status="SL" style="padding:0.25rem 0.7rem; cursor:pointer; font-size:0.7rem; transition:0.2s; display:flex; align-items:center; gap:0.3rem;">
                <i class="fa-solid fa-arrow-trend-down" style="font-size:0.6rem;"></i> SL
              </button>
              <button class="perf-filter-btn" data-status="RUNNING" style="padding:0.25rem 0.7rem; cursor:pointer; font-size:0.7rem; transition:0.2s; display:flex; align-items:center; gap:0.3rem;">
                <i class="fa-solid fa-play" style="font-size:0.6rem;"></i> Running
              </button>
              <button class="perf-filter-btn" data-status="ALL" style="padding:0.25rem 0.7rem; cursor:pointer; font-size:0.7rem; transition:0.2s; display:flex; align-items:center; gap:0.3rem;">
                <i class="fa-solid fa-table-cells-large" style="font-size:0.6rem;"></i> All
              </button>
            </div>
            <div id="signalListContainer"></div>
          </div>
        </div>
      </div>
    </div>
    <div id="dailyDetailContainer" style="display:none; margin-top:1.5rem;"></div>
  `;

  c.innerHTML = html;
  dailyRendered = true;

  renderTradeSummary();

  const summaryContainer = document.getElementById("tradeSummaryContainer");
  if (summaryContainer) {
    summaryContainer.addEventListener("click", function (e) {
      const toggle = e.target.closest("#tradeSummaryToggle");
      if (toggle) {
        e.stopPropagation();
        currentFilterState.isOpen = !currentFilterState.isOpen;
        renderTradeSummary();
        return;
      }
      const filterBtn = e.target.closest(".filter-btn");
      if (filterBtn) {
        e.stopPropagation();
        const filter = filterBtn.dataset.filter;
        if (filter === "custom") {
          currentFilterState.type = "custom";
          currentFilterState.isOpen = false;
          renderTradeSummary();
          updateDailyContent();
          return;
        }
        currentFilterState.type = filter;
        currentFilterState.customStart = null;
        currentFilterState.customEnd = null;
        currentFilterState.isOpen = false;
        renderTradeSummary();
        updateDailyContent();
        return;
      }
      const applyBtn = e.target.closest("#applyCustomFilter");
      if (applyBtn) {
        e.stopPropagation();
        const start = document.getElementById("customStartDate")?.value;
        const end = document.getElementById("customEndDate")?.value;
        if (start && end) {
          currentFilterState.type = "custom";
          currentFilterState.customStart = start;
          currentFilterState.customEnd = end;
          currentFilterState.isOpen = false;
          renderTradeSummary();
          updateDailyContent();
        } else {
          alert("Pilih tanggal mulai dan akhir");
        }
      }
    });
  }

  setTimeout(() => {
    renderDailyReturnChartFromSignals(filtered);
    renderDailyCharts(agg);
  }, 150);

  const listToggle = document.getElementById("signalListToggle");
  const listBody = document.getElementById("signalListBody");
  const chevron = document.getElementById("signalListChevron");
  if (listToggle && listBody && chevron) {
    listToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      const isOpen = listBody.style.display !== "none";
      listBody.style.display = isOpen ? "none" : "block";
      chevron.style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";
      if (!isOpen) {
        const activeBtn = document.querySelector(".perf-filter-btn.active");
        if (activeBtn) {
          renderPerformanceSignalList(activeBtn.dataset.status);
        } else {
          renderPerformanceSignalList("TP");
        }
      }
    });
  }

  c.querySelectorAll(".perf-filter-btn").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const status = this.dataset.status;
      c.querySelectorAll(".perf-filter-btn").forEach((b) =>
        b.classList.remove("active"),
      );
      this.classList.add("active");
      renderPerformanceSignalList(status);
    });
  });

  setTimeout(() => {
    const activeBtn = document.querySelector(".perf-filter-btn.active");
    if (activeBtn && listBody && listBody.style.display !== "none") {
      renderPerformanceSignalList(activeBtn.dataset.status);
    }
  }, 300);
}

function renderTradeSummary() {
  const container = document.getElementById("tradeSummaryContainer");
  if (!container) return;

  const isOpen = currentFilterState.isOpen;
  const filterLabel =
    currentFilterState.type === "today"
      ? "Today"
      : currentFilterState.type === "7days"
        ? "7 Hari"
        : currentFilterState.type === "1month"
          ? "1 Bulan"
          : "Custom";

  const dateRange = getDateRangeText(
    currentFilterState.type,
    currentFilterState.customStart,
    currentFilterState.customEnd,
  );

  let html = `
    <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; cursor:pointer; padding:0.4rem 0.6rem; background:rgba(255,255,255,0.02); border-radius:8px; border:1px solid rgba(255,255,255,0.06);" id="tradeSummaryToggle">
      <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary); display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
        <i class="fas fa-chart-simple" style="color:#8b5cf6;"></i> Trade Summary
        <span id="filterLabel" style="font-size:0.6rem; color:var(--text-secondary); background:rgba(255,255,255,0.05); padding:0.1rem 0.4rem; border-radius:6px;">
          ${filterLabel}
        </span>
        <span id="filterDateRange" style="font-size:0.55rem; color:var(--text-secondary); opacity:0.5;">
          ${dateRange}
        </span>
        <i class="fas fa-chevron-${isOpen ? "up" : "down"}" style="font-size:0.6rem; opacity:0.5; transition:transform 0.2s;"></i>
      </span>
    </div>
  `;

  if (isOpen) {
    html += `
      <div style="display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap; margin-top:0.3rem; padding:0.3rem 0.4rem; background:rgba(255,255,255,0.02); border-radius:6px;">
        <button class="filter-btn" data-filter="today" style="padding:0.15rem 0.4rem; border-radius:4px; border:1px solid var(--glass-border); background:${
          currentFilterState.type === "today"
            ? "rgba(255,255,255,0.1)"
            : "transparent"
        }; color:var(--text-primary); cursor:pointer; font-size:0.6rem; transition:0.2s;">Today</button>
        <button class="filter-btn" data-filter="7days" style="padding:0.15rem 0.4rem; border-radius:4px; border:1px solid var(--glass-border); background:${
          currentFilterState.type === "7days"
            ? "rgba(255,255,255,0.1)"
            : "transparent"
        }; color:var(--text-primary); cursor:pointer; font-size:0.6rem; transition:0.2s;">7 Hari</button>
        <button class="filter-btn" data-filter="1month" style="padding:0.15rem 0.4rem; border-radius:4px; border:1px solid var(--glass-border); background:${
          currentFilterState.type === "1month"
            ? "rgba(255,255,255,0.1)"
            : "transparent"
        }; color:var(--text-primary); cursor:pointer; font-size:0.6rem; transition:0.2s;">1 Bulan</button>
        <button class="filter-btn" data-filter="custom" style="padding:0.15rem 0.4rem; border-radius:4px; border:1px solid var(--glass-border); background:${
          currentFilterState.type === "custom"
            ? "rgba(255,255,255,0.1)"
            : "transparent"
        }; color:var(--text-primary); cursor:pointer; font-size:0.6rem; transition:0.2s;">Custom</button>
    `;
    if (currentFilterState.type === "custom") {
      html += `
        <div style="display:flex; gap:0.2rem; align-items:center; flex-wrap:wrap;">
          <input type="date" id="customStartDate" value="${
            currentFilterState.customStart || ""
          }" style="background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:4px; padding:0.15rem 0.3rem; color:var(--text-primary); font-size:0.55rem; max-width:100px;">
          <span style="color:var(--text-secondary); font-size:0.55rem;">s/d</span>
          <input type="date" id="customEndDate" value="${
            currentFilterState.customEnd || ""
          }" style="background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:4px; padding:0.15rem 0.3rem; color:var(--text-primary); font-size:0.55rem; max-width:100px;">
          <button id="applyCustomFilter" style="padding:0.15rem 0.4rem; border-radius:4px; background:rgba(59,130,246,0.2); border:1px solid #3b82f6; color:#3b82f6; cursor:pointer; font-size:0.55rem;">Terapkan</button>
        </div>
      `;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
}

function renderDailyCharts(parsed) {
  const ctxWin = document.getElementById("dailyWinRateChart");
  if (ctxWin) {
    let win = parseFloat((parsed.winRate || 0).toFixed(1));
    let loss = parseFloat((100 - win).toFixed(1));

    let displayData = [win, loss];
    let displayColors = ["#10b981", "#ef4444"];
    let centerText = win + "%";

    if (parsed.tp === 0 && parsed.sl === 0) {
      displayData = [100, 0];
      displayColors = ["#10b981", "#ef4444"];
      centerText = "100%";
    }

    let existingChart = Chart.getChart(ctxWin);
    if (existingChart) {
      existingChart.destroy();
    }

    new Chart(ctxWin, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: displayData,
            backgroundColor: displayColors,
            borderWidth: 0,
            cutout: "70%",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.parsed + "%";
              },
            },
          },
        },
      },
      plugins: [
        {
          id: "winRateText",
          beforeDraw: function (chart) {
            const {
              ctx,
              chartArea: { width, height, top, left },
            } = chart;
            ctx.save();
            ctx.font = 'bold 1.2rem "JetBrains Mono"';
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(centerText, left + width / 2, top + height / 2);
            ctx.restore();
          },
        },
      ],
    });
  }

  const ctxSignal = document.getElementById("dailySignalChart");
  if (ctxSignal) {
    let existingSignalChart = Chart.getChart(ctxSignal);
    if (existingSignalChart) {
      existingSignalChart.destroy();
    }

    new Chart(ctxSignal, {
      type: "bar",
      data: {
        labels: ["New", "TP", "SL", "Running"],
        datasets: [
          {
            data: [parsed.totalSignals, parsed.tp, parsed.sl, parsed.running],
            backgroundColor: ["#3b82f6", "#10b981", "#ef4444", "#f59e0b"],
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: "rgba(255,255,255,0.05)" },
            ticks: { color: "#71717a" },
          },
          x: {
            grid: { display: false },
            ticks: { color: "#71717a" },
          },
        },
      },
    });
  }
}

async function showDailySignalDetail(stockCode, signalDate) {
  let signal = null;
  const allCached = [..._allRunning, ..._allClosed];
  signal = allCached.find(
    (s) => s.stockCode === stockCode && s.signalDate === signalDate,
  );
  if (!signal) {
    try {
      const res = await fetch("/api/signals");
      if (!res.ok) throw new Error("Gagal fetch");
      const data = await res.json();
      const all = [...(data.running || []), ...(data.closed || [])];
      signal = all.find(
        (s) => s.stockCode === stockCode && s.signalDate === signalDate,
      );
    } catch (e) {
      console.warn("Gagal fetch sinyal:", e);
    }
  }
  if (!signal) {
    alert("Data sinyal tidak ditemukan.");
    return;
  }

  const wrapper = document.getElementById("dailyContentWrapper");
  const listBody = document.getElementById("signalListBody");
  const detailContainer = document.getElementById("dailyDetailContainer");
  const activeFilterBtn = document.querySelector(".perf-filter-btn.active");
  const activeStatus = activeFilterBtn ? activeFilterBtn.dataset.status : "TP";

  if (wrapper) wrapper.style.display = "none";
  if (listBody) listBody.style.display = "none";

  if (detailContainer) {
    detailContainer.style.display = "block";

    if (signal.signalType === "TECHNICAL") {
      renderTechnicalSignalDetail(signal, detailContainer);
      const backBtn = detailContainer.querySelector("#techBackBtn");
      if (backBtn) {
        backBtn.addEventListener("click", () => {
          detailContainer.style.display = "none";
          if (wrapper) wrapper.style.display = "block";
          if (listBody) listBody.style.display = "";
          renderPerformanceSignalList(activeStatus);
        });
      }
    } else {
      await renderSignalDetailToContainer(signal, detailContainer, () => {
        if (detailContainer) detailContainer.style.display = "none";
        if (wrapper) wrapper.style.display = "block";
        if (listBody) listBody.style.display = "";
        renderPerformanceSignalList(activeStatus);
      });
    }
    // FIX: scroll ke atas saat detail ditampilkan
    detailContainer.scrollIntoView({ behavior: "smooth", block: "start" });
    window.scrollTo({ top: 0, behavior: "smooth" }); // tambahan untuk memastikan posisi top
  }
}

function renderStrategyFlowForSignal(s) {
  const entry = s.entryPrice || 0;
  const sl = s.sl || 0;
  const tp = s.tp1 || 0;
  let slPercent = 0,
    tpPercent = 0;
  if (entry > 0 && sl > 0) {
    slPercent = ((sl - entry) / entry) * 100;
  }
  if (entry > 0 && tp > 0) {
    tpPercent = ((tp - entry) / entry) * 100;
  }
  const slLabel =
    slPercent < 0 ? `${slPercent.toFixed(1)}%` : `-${slPercent.toFixed(1)}%`;
  const tpLabel =
    tpPercent > 0 ? `+${tpPercent.toFixed(1)}%` : `${tpPercent.toFixed(1)}%`;

  const step1Active = true;
  let step1State = "default";
  if (s.status === "SL" && !s.breakEven) step1State = "failed";

  const step2Active =
    s.breakEven === true || s.status === "TRAILING" || s.status === "TP";
  const step2State =
    s.status === "SL" && s.breakEven
      ? "warning"
      : s.status === "TP"
        ? "success"
        : "default";

  const step3Active = s.status === "TRAILING" || s.status === "TP";
  let step3State = "default";
  if (s.status === "SL" && s.breakEven) step3State = "warning";
  else if (s.status === "TP") step3State = "success";

  function stepCircle(active, label, desc, icon, state = "default") {
    let bg, border, color, shadow;
    if (state === "failed") {
      bg = "#ef4444";
      border = "#ef4444";
      color = "#fff";
      shadow = "0 0 0 4px rgba(239,68,68,0.2)";
    } else if (state === "warning") {
      bg = "#f59e0b";
      border = "#f59e0b";
      color = "#fff";
      shadow = "0 0 0 4px rgba(245,158,11,0.2)";
    } else if (state === "success" || active) {
      bg = "#10b981";
      border = "#10b981";
      color = "#fff";
      shadow = "0 0 0 4px rgba(16,185,129,0.2)";
    } else {
      bg = "#2a2a2a";
      border = "rgba(255,255,255,0.1)";
      color = "var(--text-secondary)";
      shadow = "0 0 0 4px #121212";
    }
    let descColor = "var(--text-secondary)";
    if (state === "failed") descColor = "#ef4444";
    else if (state === "warning") descColor = "#f59e0b";
    else if (state === "success" || active) descColor = "#10b981";

    return `
      <div style="flex:1; text-align:center; z-index:2; position:relative;">
        <div style="width:34px; height:34px; background:${bg}; border:2px solid ${border}; color:${color}; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto; font-size:0.8rem; font-weight:700; box-shadow: ${shadow}; transition:all 0.3s ease;">
          ${icon}
        </div>
        <div style="font-size:0.7rem; font-weight:600; color:${active || state !== "default" ? "var(--text-primary)" : "var(--text-secondary)"}; margin-top:0.4rem;">${label}</div>
        <div style="font-size:0.5rem; color:${descColor}; margin-top:0.1rem; opacity:0.8;">${desc}</div>
      </div>
    `;
  }

  let progressWidth = "0%";
  let progressGradient = "linear-gradient(90deg, #10b981, #10b981)";
  if (step3Active && step3State !== "warning") {
    progressWidth = "100%";
  } else if (step2Active) {
    progressWidth = "50%";
  } else if (step1State === "failed") {
    progressWidth = "10%";
    progressGradient = "linear-gradient(90deg, #ef4444, #ef4444)";
  }
  if (step3State === "warning") {
    progressWidth = "100%";
    progressGradient = "linear-gradient(90deg, #10b981 50%, #f59e0b 50%)";
  }

  return `
    <div style="background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:0.65rem 0.75rem; margin-top:0.5rem;">
      <div style="display:flex; align-items:center; gap:0.4rem; margin-bottom:0.1rem;">
        <i class="fa-solid fa-layer-group" style="color:var(--text-primary); font-size:1rem;"></i>
        <span style="font-weight:600; font-size:0.85rem; color:var(--text-primary); letter-spacing: 0.3px;">Strategy Flow</span>
        ${
          s.status === "RUNNING"
            ? `<span style="font-size:0.55rem; background:rgba(16,185,129,0.15); color:#10b981; padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">Active</span>`
            : s.status === "TRAILING"
              ? `<span style="font-size:0.55rem; background:rgba(245,158,11,0.15); color:#f59e0b; padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">Trailing</span>`
              : s.status === "WAITING_ENTRY"
                ? `<span style="font-size:0.55rem; background:rgba(59,130,246,0.15); color:#3b82f6; padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">Waiting</span>`
                : `<span style="font-size:0.55rem; background:rgba(255,255,255,0.05); color:var(--text-secondary); padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">${s.status}</span>`
        }
      </div>
      
      <div style="display:flex; align-items:center; justify-content:space-between; margin:0.8rem 0; position:relative; padding:0 0.5rem;">
        <div style="position:absolute; top:17px; left:10%; right:10%; height:2px; background:rgba(255,255,255,0.08); z-index:1;">
          <div style="height:100%; width:${progressWidth}; background:${progressGradient}; border-radius:2px; transition:width 0.8s ease;"></div>
        </div>
        ${stepCircle(step1Active, "Entry", `SL ${slLabel}`, "1", step1State)}
        ${stepCircle(step2Active, "Take Profit", `TP ${tpLabel}`, "2", step2State)}
        ${stepCircle(step3Active, "Trailing Stop", "TS 3%", "3", step3State)}
      </div>
      
      <div style="display:flex; justify-content:center; gap:0.5rem; font-size:0.55rem; color:var(--text-secondary); margin-top:0.2rem;">
        <span style="display:flex; align-items:center; gap:0.2rem;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981;"></span> Active
        </span>
        <span style="display:flex; align-items:center; gap:0.2rem;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444;"></span> Stop Loss
        </span>
        <span style="display:flex; align-items:center; gap:0.2rem;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#f59e0b;"></span> Trailing Hit
        </span>
      </div>
    </div>
  `;
}

function renderBsjpDetail(s, container, onBack) {
  let stockInfo = { longName: s.stockCode, logoUrl: null };
  let currentPrice = null;

  fetchStockInfo(s.stockCode)
    .then((info) => {
      if (info) stockInfo = info;
    })
    .catch(() => {});

  fetchStockPrice(s.stockCode)
    .then((price) => {
      currentPrice = price;
      renderBsjpDetailContent(s, container, onBack, currentPrice, stockInfo);
    })
    .catch(() => {
      renderBsjpDetailContent(s, container, onBack, null, stockInfo);
    });
}

function renderBsjpDetailContent(
  s,
  container,
  onBack,
  currentPrice,
  stockInfo,
) {
  let gainAbs = 0,
    gainPct = 0,
    gainStr = "",
    gainColor = "",
    arrowIcon = "";

  const isRunningNow = s.status === "RUNNING" || s.status === "TRAILING";
  const isClosed = s.status === "TP" || s.status === "SL";
  const hasCurrentPrice = currentPrice != null;

  if (isRunningNow && s.entryPrice && hasCurrentPrice) {
    gainAbs = currentPrice - s.entryPrice;
    gainPct = (gainAbs / s.entryPrice) * 100;
  } else if (isClosed && s.entryPrice && s.exitPrice) {
    gainAbs = s.exitPrice - s.entryPrice;
    gainPct = (gainAbs / s.entryPrice) * 100;
  } else if (isClosed && s.returnPercent != null) {
    gainPct = s.returnPercent;
    gainAbs = (s.returnPercent / 100) * s.entryPrice;
  }

  if (isRunningNow && !hasCurrentPrice) {
    gainStr = "—";
    gainColor = "var(--text-secondary)";
  } else {
    const absGain = Math.abs(gainAbs).toFixed(0);
    const absPct = Math.abs(gainPct).toFixed(2);

    if (Math.abs(gainAbs) < 0.01) {
      gainColor = "var(--text-secondary)";
      gainStr = "0 (0.00%)";
      arrowIcon = "";
    } else if (gainAbs > 0) {
      gainColor = "#10b981";
      arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
      gainStr = `${arrowIcon} ${absGain} (+${absPct}%)`;
    } else {
      gainColor = "#ef4444";
      arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
      gainStr = `${arrowIcon} ${absGain} (-${absPct}%)`;
    }
  }

  let displayPrice = "—",
    priceArrow = "";

  if (isClosed && s.exitPrice) {
    displayPrice = Number(s.exitPrice).toLocaleString("id-ID");
  } else if (isRunningNow && hasCurrentPrice) {
    displayPrice = Number(currentPrice).toLocaleString("id-ID");
  }

  if (gainAbs > 0) {
    priceArrow = `<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.8rem; margin-right:0.2rem;"></i>`;
  } else if (gainAbs < 0) {
    priceArrow = `<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.8rem; margin-right:0.2rem;"></i>`;
  }

  let statusStamp = "";
  if (s.status === "TP")
    statusStamp = `<span class="sig-status-stamp" style="width:36px; height:36px; display:inline-block; flex-shrink:0;">${hitSvg}</span>`;
  else if (s.status === "SL" || s.status === "STOP LOSS")
    statusStamp = `<span class="sig-status-stamp" style="width:36px; height:36px; display:inline-block; flex-shrink:0;">${missedSvg}</span>`;

  const logoUrl = `https://assets.stockbit.com/logos/companies/${s.stockCode}.png`;
  const parqetUrl = `https://assets.parqet.com/logos/symbol/${s.stockCode}.png`;
  const bgColor = getColorFromCode(s.stockCode);
  const logoHtml = `<span class="detail-logo-text"><img src="${logoUrl}" alt="${s.stockCode}" style="width:50px; height:64px; object-fit:contain; border:none; background:transparent; display:block;" onerror="this.onerror=null; this.src='${parqetUrl}'; this.onerror=function(){ this.style.display='none'; this.nextElementSibling.style.display='inline-block'; }"><span style="display:none; width:64px; height:64px; line-height:64px; text-align:center; background:${bgColor}; color:#fff; font-size:1.1rem; font-weight:700; font-family:'JetBrains Mono',monospace;">${s.stockCode.substring(0, 2)}</span></span>`;

  const breakEvenStatus = s.breakEven ? "Locked" : "Belum";
  const breakEvenIcon = s.breakEven ? "fa-check-circle" : "fa-xmark-circle";
  const breakEvenColor = s.breakEven ? "#10b981" : "#f59e0b";

  const isTP = s.status === "TP";
  const isHardSL = s.status === "SL" && !s.breakEven;
  const isTrailingHit = s.status === "SL" && s.breakEven;

  const isStep1Active = true;
  const step1State = isHardSL ? "failed" : "default";

  const isStep2Active = s.breakEven === true;
  const isStep3Active = s.breakEven === true;
  const step3State = isTrailingHit ? "warning" : "default";

  function stepCircle(active, label, desc, icon, state = "default") {
    let bg, border, color, shadow;
    if (state === "failed") {
      bg = "#ef4444";
      border = "#ef4444";
      color = "#ffffff";
      shadow = "0 0 0 4px rgba(239,68,68,0.2)";
    } else if (state === "warning") {
      bg = "#f59e0b";
      border = "#f59e0b";
      color = "#ffffff";
      shadow = "0 0 0 4px rgba(245,158,11,0.2)";
    } else if (active) {
      bg = "#10b981";
      border = "#10b981";
      color = "#ffffff";
      shadow = "0 0 0 4px rgba(16,185,129,0.2)";
    } else {
      bg = "#2a2a2a";
      border = "rgba(255,255,255,0.1)";
      color = "var(--text-secondary)";
      shadow = "0 0 0 4px #121212";
    }
    let descColor = "var(--text-secondary)";
    if (state === "failed") descColor = "#ef4444";
    else if (state === "warning") descColor = "#f59e0b";
    else if (active) descColor = "#10b981";

    return `
      <div style="flex:1; text-align:center; z-index:2; position:relative;">
        <div style="width:34px; height:34px; background:${bg}; border:2px solid ${border}; color:${color}; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto; font-size:0.8rem; font-weight:700; box-shadow: ${shadow}; transition:all 0.3s ease;">
          ${icon}
        </div>
        <div style="font-size:0.7rem; font-weight:600; color:${active || state !== "default" ? "var(--text-primary)" : "var(--text-secondary)"}; margin-top:0.4rem;">${label}</div>
        <div style="font-size:0.5rem; color:${descColor}; margin-top:0.1rem; opacity:0.8;">${desc}</div>
      </div>
    `;
  }

  let progressWidth = "0%";
  let progressGradient = "linear-gradient(90deg, #10b981, #10b981)";

  if (isStep3Active) {
    progressWidth = "100%";
    if (step3State === "warning") {
      progressGradient = "linear-gradient(90deg, #10b981 50%, #f59e0b 50%)";
    } else {
      progressGradient = "linear-gradient(90deg, #10b981, #10b981)";
    }
  } else if (isStep2Active) {
    progressWidth = "50%";
    progressGradient = "linear-gradient(90deg, #10b981, #10b981)";
  } else if (isHardSL) {
    progressWidth = "10%";
    progressGradient = "linear-gradient(90deg, #ef4444, #ef4444)";
  }

  const strategyVisual = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin:0.8rem 0; position:relative; padding:0 0.5rem;">
      <div style="position:absolute; top:17px; left:10%; right:10%; height:2px; background:rgba(255,255,255,0.08); z-index:1;">
        <div style="height:100%; width:${progressWidth}; background:${progressGradient}; border-radius:2px; transition:width 0.8s ease;"></div>
      </div>
      
      ${stepCircle(isStep1Active, "Entry", "SL -2%", "1", step1State)}
      ${stepCircle(isStep2Active, "Take Profit", "Lock 2%", "2")}
      ${stepCircle(isStep3Active, "Trailing Stop", "Trailing Stop 2%", "3", step3State)}
    </div>
    <div style="display:flex; justify-content:center; gap:0.5rem; font-size:0.55rem; color:var(--text-secondary); margin-top:0.2rem;">
      <span style="display:flex; align-items:center; gap:0.2rem;">
        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981;"></span> Active
      </span>
      <span style="display:flex; align-items:center; gap:0.2rem;">
        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444;"></span> Stop Loss
      </span>
    </div>
    <div style="background:rgba(255,255,255,0.02); border-radius:6px; padding:0.5rem 0.6rem; margin-top:0.5rem; border:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; gap:0.35rem; font-size:0.65rem; color:var(--text-secondary); line-height:1.3;">
      <div style="display:flex; align-items:start;"><i class="fa-regular fa-circle" style="color:#8b5cf6; font-size:0.5rem; margin-right:0.4rem; margin-top:0.15rem;"></i> <span>Stop Loss awal <strong>-2%</strong> dari Entry.</span></div>
      <div style="display:flex; align-items:start;"><i class="fa-regular fa-circle-check" style="color:#10b981; font-size:0.5rem; margin-right:0.4rem; margin-top:0.15rem;"></i> <span>Jika TP 2% tercapai, SL pindah ke <strong>Lock 2%</strong> (minimal profit 2%).</span></div>
      <div style="display:flex; align-items:start;"><i class="fa-regular fa-circle-check" style="color:#10b981; font-size:0.5rem; margin-right:0.4rem; margin-top:0.15rem;"></i> <span>Setelah Lock, trailing 2% dengan <strong>minimum 2% profit</strong>.</span></div>
    </div>
  `;

  const breakEvenDisplay = `
    <div style="display:flex; align-items:center; gap:0.35rem; font-weight:600; color:${breakEvenColor};">
      <i class="fa-solid ${breakEvenIcon}" style="font-size:0.95rem;"></i>
      <span style="font-size:0.85rem;">${breakEvenStatus}</span>
    </div>
  `;

  let trailingDisplay = "";
  if (isClosed) {
    let exitLabel, exitIcon, exitColor;

    if (isTP) {
      exitLabel = "Take Profit";
      exitIcon = "fa-check-circle";
      exitColor = "var(--success)";
    } else if (isTrailingHit) {
      exitLabel = "Trailing Hit (Locked)";
      exitIcon = "fa-shield-halved";
      exitColor = "#f59e0b";
    } else {
      exitLabel = "Stop Loss";
      exitIcon = "fa-xmark-circle";
      exitColor = "var(--danger)";
    }

    trailingDisplay = `
      <div style="background:rgba(255,255,255,0.02); border-radius:6px; padding:0.65rem 0.6rem; border:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; justify-content:center;">
        <div style="color:var(--text-secondary); font-size:0.6rem; margin-bottom:0.3rem;"><i class="fa-solid fa-flag-checkered" style="margin-right:0.2rem;"></i>${exitLabel}</div>
        <div style="font-weight:600; color:${exitColor}; font-size:0.85rem; display:flex; align-items:center; gap:0.3rem;">
          <i class="fa-solid ${exitIcon}" style="font-size:0.8rem;"></i>
          ${fmtPrice(s.exitPrice)}
        </div>
      </div>
    `;
  } else if (s.breakEven) {
    trailingDisplay = `
      <div style="background:rgba(255,255,255,0.02); border-radius:6px; padding:0.65rem 0.6rem; border:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; justify-content:center;">
        <div style="color:var(--text-secondary); font-size:0.6rem; margin-bottom:0.3rem;"><i class="fa-solid fa-chart-line" style="margin-right:0.2rem;"></i>Trailing Stop (2%)</div>
        <div style="font-weight:600; color:var(--success); font-size:0.85rem;">${fmtPrice(s.sl)}</div>
      </div>
    `;
  } else {
    trailingDisplay = `
      <div style="background:rgba(255,255,255,0.02); border-radius:6px; padding:0.65rem 0.6rem; border:1px solid rgba(255,255,255,0.06); opacity:0.5; display:flex; flex-direction:column; justify-content:center;">
        <div style="color:var(--text-secondary); font-size:0.6rem; margin-bottom:0.3rem;"><i class="fa-solid fa-chart-line" style="margin-right:0.2rem;"></i>Trailing Stop</div>
        <div style="font-weight:600; color:var(--text-secondary); font-size:0.85rem;">—</div>
      </div>
    `;
  }

  const html = `
    <div class="pro-detail-container">
      <button class="sig-back-btn" id="bsjpBackBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg> Kembali
      </button>
      <div style="background:rgba(255,255,255,0.02); border-radius:10px; border:1px solid rgba(255,255,255,0.08); overflow:hidden; margin-bottom:0.5rem;">

        <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="display:grid; grid-template-columns: 1fr auto; gap:0.2rem 0.5rem; align-items:center;">
            <div style="grid-column:1; grid-row:1; display:flex; flex-direction:column; gap:0.1rem;">
              <span style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:1.2rem; color:var(--text-primary);">${escapeHtml(s.stockCode)}</span>
              <span style="font-size:0.8rem; color:var(--text-secondary); opacity:0.7;">${escapeHtml(stockInfo.longName)}</span>
            </div>
            <div style="grid-column:1; grid-row:2; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <span style="font-family:'JetBrains Mono'; font-weight:600; font-size:1rem; color:var(--text-primary); display:flex; align-items:center;">
                ${priceArrow} ${displayPrice}
              </span>
              <span style="font-family:'JetBrains Mono'; font-size:0.75rem; color:${gainColor}; font-weight:600; display:flex; align-items:center; gap:0.2rem;">${gainStr}</span>
              ${statusStamp}
            </div>
            <div style="grid-column:2; grid-row:1 / 3; display:flex; align-items:center; justify-content:center;">${logoHtml}</div>
            <div style="grid-column:1 / 3; grid-row:3; margin-top:0.1rem;">
              <span class="emit-tag"><i class="fa-solid fa-chart-simple" style="margin-right:3px; font-size:0.65rem;"></i>BSJP</span>
            </div>
            <div style="grid-column:1 / 3; grid-row:4; font-size:0.7rem; color:var(--text-secondary); opacity:0.6; margin-top:0.1rem;">${s.signalDate ? formatFullDateTime(s.signalDate) : ""}</div>
          </div>
        </div>

        <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
          <div class="price-ladder" style="display:flex; justify-content:space-around; align-items:center; gap:0.5rem; padding:0.2rem 0; margin:0;">
            <div class="price-item" style="display:flex; align-items:center; gap:0.3rem; flex:1; justify-content:center;">
              <span class="label" style="font-size:0.6rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.2rem;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Entry
              </span>
              <span class="value" style="font-family:'JetBrains Mono'; font-weight:600; font-size:0.9rem; color:var(--text-primary);">${fmtPrice(s.entryPrice)}</span>
              <span class="change neutral" style="font-size:0.6rem; color:var(--text-secondary);">—</span>
            </div>
            <div class="price-item" style="display:flex; align-items:center; gap:0.3rem; flex:1; justify-content:center;">
              <span class="label" style="font-size:0.6rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.2rem;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> TAKE PROFIT
              </span>
              <span class="value" style="font-family:'JetBrains Mono'; font-weight:600; font-size:0.9rem; color:var(--success);">${fmtPrice(s.tp1)}</span>
              <span class="change positive" style="font-size:0.6rem; color:var(--success);">+2.00%</span>
            </div>
            <div class="price-item" style="display:flex; align-items:center; gap:0.3rem; flex:1; justify-content:center;">
              <span class="label" style="font-size:0.6rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.2rem;">
                <i class="fa-solid fa-triangle-exclamation"></i> STOP LOSS
              </span>
              <span class="value" style="font-family:'JetBrains Mono'; font-weight:600; font-size:0.9rem; color:var(--danger);">${fmtPrice(s.sl)}</span>
              <span class="change negative" style="font-size:0.6rem; color:var(--danger);">-2.00%</span>
            </div>
          </div>
        </div>

        <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:0.65rem 0.75rem;">
            <div style="display:flex; align-items:center; gap:0.4rem; margin-bottom:0.1rem;">
              <i class="fa-solid fa-layer-group" style="color:var(--text-primary); font-size:1rem;"></i>
              <span style="font-weight:600; font-size:0.85rem; color:var(--text-primary); letter-spacing: 0.3px;">BSJP Strategy Flow</span>
              ${
                s.status === "RUNNING"
                  ? `<span style="font-size:0.55rem; background:rgba(16,185,129,0.15); color:#10b981; padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">Active</span>`
                  : s.status === "TRAILING"
                    ? `<span style="font-size:0.55rem; background:rgba(245,158,11,0.15); color:#f59e0b; padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">Trailing</span>`
                    : `<span style="font-size:0.55rem; background:rgba(255,255,255,0.05); color:var(--text-secondary); padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">${s.status}</span>`
              }
            </div>
            ${strategyVisual}
          </div>
        </div>

        <div style="padding:0.5rem 0.75rem;">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; font-size:0.7rem;">
            <div style="background:rgba(255,255,255,0.02); border-radius:6px; padding:0.65rem 0.6rem; border:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; justify-content:center;">
              <div style="color:var(--text-secondary); font-size:0.6rem; margin-bottom:0.3rem;"><i class="fa-solid fa-scale-balanced" style="margin-right:0.2rem;"></i>Lock Profit</div>
              ${breakEvenDisplay}
            </div>
            ${trailingDisplay}
          </div>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  if (bsjpRefreshInterval) {
    clearInterval(bsjpRefreshInterval);
    bsjpRefreshInterval = null;
  }

  const backBtn = container.querySelector("#bsjpBackBtn");
  if (backBtn && onBack) {
    backBtn.addEventListener("click", () => {
      if (bsjpRefreshInterval) {
        clearInterval(bsjpRefreshInterval);
        bsjpRefreshInterval = null;
      }
      onBack();
    });
  }

  bsjpRefreshInterval = setInterval(async () => {
    try {
      const res = await fetch("/api/signals");
      if (!res.ok) return;
      const data = await res.json();
      const all = [...(data.running || []), ...(data.closed || [])];
      const updated = all.find(
        (sig) =>
          sig.stockCode === s.stockCode && sig.signalDate === s.signalDate,
      );
      if (updated) {
        const changed =
          updated.status !== s.status ||
          updated.sl !== s.sl ||
          updated.exitPrice !== s.exitPrice ||
          updated.returnPercent !== s.returnPercent ||
          updated.breakEven !== s.breakEven;
        if (changed) {
          Object.assign(s, updated);
          renderBsjpDetailContent(
            s,
            container,
            onBack,
            currentPrice,
            stockInfo,
          );
        }
      }
    } catch (e) {
      console.warn("Refresh BSJP detail error:", e);
    }
  }, 10000);
}

async function renderSignalDetailToContainer(signal, container, onBack) {
  const s = signal;

  if (s.signalType === "BSJP") {
    renderBsjpDetail(s, container, onBack);
    return;
  }

  let stockInfo = { longName: s.stockCode, logoUrl: null };

  let currentPrice = null;
  try {
    currentPrice = await fetchStockPrice(s.stockCode);
  } catch (e) {
    console.warn(`Gagal fetch current price ${s.stockCode}:`, e);
  }

  try {
    const info = await fetchStockInfo(s.stockCode);
    if (info) stockInfo = info;
  } catch (e) {}

  let gainAbs = 0,
    gainPct = 0,
    gainStr = "",
    gainColor = "",
    arrowIcon = "";
  let isRunning =
    (s.status === "RUNNING" || s.status === "TRAILING") &&
    s.entryPrice &&
    currentPrice;
  if (isRunning) {
    gainAbs = currentPrice - s.entryPrice;
    gainPct = (gainAbs / s.entryPrice) * 100;
    const absGain = Math.abs(gainAbs).toFixed(0);
    const absPct = Math.abs(gainPct).toFixed(2);
    if (Math.abs(gainAbs) < 0.01) {
      gainColor = "var(--text-secondary)";
      gainStr = "0 (0.00%)";
      arrowIcon = "";
    } else if (gainAbs > 0) {
      arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
      gainColor = "#10b981";
      gainStr = `${arrowIcon} ${absGain} (+${absPct}%)`;
    } else {
      arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
      gainColor = "#ef4444";
      gainStr = `${arrowIcon} ${absGain} (-${absPct}%)`;
    }
  } else if (
    (s.status === "RUNNING" || s.status === "TRAILING") &&
    !currentPrice
  ) {
    gainStr = "—";
    gainColor = "var(--text-secondary)";
  } else {
    if (s.status === "TP" || s.status === "SL") {
      const ret = s.returnPercent || 0;
      const sign = ret >= 0 ? "+" : "";
      gainStr = `${sign}${ret.toFixed(2)}%`;
      gainColor = ret >= 0 ? "#10b981" : "#ef4444";
      if (ret > 0.01)
        arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
      else if (ret < -0.01)
        arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
    } else {
      gainStr = "—";
      gainColor = "var(--text-secondary)";
      arrowIcon = "";
    }
  }

  let displayPrice = "—",
    priceArrow = "";
  if (s.status === "TP" && s.exitPrice) {
    displayPrice = Number(s.exitPrice).toLocaleString("id-ID");
    const ret = s.returnPercent || 0;
    if (ret > 0)
      priceArrow = `<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.8rem; margin-right:0.2rem;"></i>`;
    else if (ret < 0)
      priceArrow = `<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.8rem; margin-right:0.2rem;"></i>`;
  } else if (s.status === "SL" && s.exitPrice) {
    displayPrice = Number(s.exitPrice).toLocaleString("id-ID");
    const ret = s.returnPercent || 0;
    if (ret > 0)
      priceArrow = `<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.8rem; margin-right:0.2rem;"></i>`;
    else if (ret < 0)
      priceArrow = `<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.8rem; margin-right:0.2rem;"></i>`;
  } else if (currentPrice != null) {
    displayPrice = Number(currentPrice).toLocaleString("id-ID");
    if (gainAbs > 0)
      priceArrow = `<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.8rem; margin-right:0.2rem;"></i>`;
    else if (gainAbs < 0)
      priceArrow = `<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.8rem; margin-right:0.2rem;"></i>`;
  }

  let statusStamp = "";
  if (s.status === "TP")
    statusStamp = `<span class="sig-status-stamp" style="width:36px; height:36px; display:inline-block; flex-shrink:0;">${hitSvg}</span>`;
  else if (s.status === "SL" || s.status === "STOP LOSS")
    statusStamp = `<span class="sig-status-stamp" style="width:36px; height:36px; display:inline-block; flex-shrink:0;">${missedSvg}</span>`;

  const logoUrl = `https://assets.stockbit.com/logos/companies/${s.stockCode}.png`;
  const parqetUrl = `https://assets.parqet.com/logos/symbol/${s.stockCode}.png`;
  const bgColor = getColorFromCode(s.stockCode);
  const logoHtml = `<span class="detail-logo-text"><img src="${logoUrl}" alt="${s.stockCode}" style="width:50px; height:64px; object-fit:contain; border:none; background:transparent; display:block;" onerror="this.onerror=null; this.src='${parqetUrl}'; this.onerror=function(){ this.style.display='none'; this.nextElementSibling.style.display='inline-block'; }"><span style="display:none; width:64px; height:64px; line-height:64px; text-align:center; background:${bgColor}; color:#fff; font-size:1.1rem; font-weight:700; font-family:'JetBrains Mono',monospace;">${s.stockCode.substring(0, 2)}</span></span>`;
  const tagHtml = renderTagHtml(s, false);

  const signalLabel = s.signalType || "WATCHLIST";
  const upperLabel = signalLabel.toUpperCase();
  const isStrongBuy = upperLabel.includes("STRONG BUY");
  const isStrongSell = upperLabel.includes("STRONG SELL");
  const isBuy = upperLabel.includes("BUY") && !isStrongBuy;
  const isSell = upperLabel.includes("SELL") && !isStrongSell;
  let signalIcon, signalBg, signalBorder, signalLabelText, signalDesc;
  if (isStrongBuy) {
    signalIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:28px; color:#fbbf24;"></i>`;
    signalBg = "linear-gradient(135deg, #fbbf2415, #fbbf2405)";
    signalBorder = "#fbbf24";
    signalLabelText = "STRONG BUY";
    signalDesc = "Strong Bullish";
  } else if (isStrongSell) {
    signalIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:28px; color:#dc2626;"></i>`;
    signalBg = "linear-gradient(135deg, #dc262615, #dc262605)";
    signalBorder = "#dc2626";
    signalLabelText = "STRONG SELL";
    signalDesc = "Strong Bearish";
  } else if (isBuy) {
    signalIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:28px;"></i>`;
    signalBg = "linear-gradient(135deg, #10b98115, #10b98105)";
    signalBorder = "#10b981";
    signalLabelText = "BUY";
    signalDesc = "Bullish";
  } else if (isSell) {
    signalIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:28px;"></i>`;
    signalBg = "linear-gradient(135deg, #ef444415, #ef444405)";
    signalBorder = "#ef4444";
    signalLabelText = "SELL";
    signalDesc = "Bearish";
  } else {
    signalIcon = `<i class="fa-regular fa-eye" style="font-size:26px;"></i>`;
    signalBg = "linear-gradient(135deg, #71717a15, #71717a05)";
    signalBorder = "#71717a";
    signalLabelText = "WATCH";
    signalDesc = "Monitor";
  }

  const signalVisual = `<div class="pro-card" style="margin-bottom:0.5rem; background:${signalBg}; border:1px solid ${signalBorder}33; transition:all 0.3s; padding:0.75rem 1rem;"><div style="display:flex; align-items:center; gap:1.25rem;"><div style="width:60px; height:60px; border-radius:50%; background:${signalBorder}15; border:2px solid ${signalBorder}; display:flex; align-items:center; justify-content:center; flex-shrink:0; color:${signalBorder};">${signalIcon}</div><div style="flex:1;"><div style="font-size:0.6rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-secondary);">Signal Type</div><div style="font-family:'JetBrains Mono'; font-weight:700; font-size:1.5rem; color:${signalBorder}; line-height:1.2;">${signalLabelText}<span style="font-size:0.8rem; font-weight:400; color:var(--text-secondary); margin-left:0.5rem;">${signalLabel}</span></div></div><div style="font-size:0.6rem; background:${signalBorder}15; color:${signalBorder}; padding:4px 14px; border-radius:20px; border:1px solid ${signalBorder}25; text-transform:uppercase; letter-spacing:0.05em; font-weight:600;">${signalDesc}</div></div></div>`;

  const score = s.confidenceScore || 0;
  const hasDetails = s.confidenceDetails && s.confidenceDetails.length > 0;
  const isNoData = score === 0 && !hasDetails;

  const maxScore = 10;
  const pct = (score / maxScore) * 100;
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (pct / 100) * circumference;

  let confColor, confLabel, confTier, confDesc, confIcon;
  if (isNoData) {
    confColor = "#71717a";
    confLabel = "N/A";
    confTier = "No Data";
    confDesc = "Data confidence tidak tersedia.";
    confIcon = `<i class="fa-regular fa-circle-question" style="color:#71717a; font-size:14px; margin-right:4px;"></i>`;
  } else if (score >= 8) {
    confColor = "#10b981";
    confLabel = "HIGH";
    confTier = "High Conviction";
    confDesc = "Setup sangat kuat. Teknikal solid + institusi aktif akumulasi.";
    confIcon = `<i class="fa-solid fa-star" style="color:#fbbf24; font-size:14px; margin-right:4px;"></i>`;
  } else if (score >= 5) {
    confColor = "#ffffff";
    confLabel = "NORMAL";
    confTier = "Normal";
    confDesc = "Setup cukup baik dengan beberapa faktor pendukung.";
    confIcon = `<i class="fa-regular fa-circle-check" style="color:#a1a1aa; font-size:14px; margin-right:4px;"></i>`;
  } else if (score >= 3) {
    confColor = "#f97316";
    confLabel = "LOW";
    confTier = "Low";
    confDesc = "Faktor pendukung minim. Butuh konfirmasi tambahan.";
    confIcon = `<i class="fa-regular fa-circle" style="color:#f97316; font-size:14px; margin-right:4px;"></i>`;
  } else {
    confColor = "#ef4444";
    confLabel = "RISK";
    confTier = "Risk";
    confDesc =
      "Tidak memenuhi standar minimum — difilter otomatis oleh engine.";
    confIcon = `<i class="fa-regular fa-circle-xmark" style="color:#ef4444; font-size:14px; margin-right:4px;"></i>`;
  }

  let breakdownList = "";
  if (s.confidenceDetails && s.confidenceDetails.length > 0) {
    breakdownList = `<div style="margin-top:0.75rem; border-top:1px solid rgba(255,255,255,0.06); padding-top:0.75rem;">`;
    s.confidenceDetails.forEach((d) => {
      const isPos = d.trim().startsWith("+");
      const icon = isPos
        ? `<i class="fa-solid fa-circle-check" style="color:#10b981; font-size:14px;"></i>`
        : `<i class="fa-solid fa-circle-xmark" style="color:#ef4444; font-size:14px;"></i>`;
      breakdownList += `<div style="display:flex; align-items:center; font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.35rem; gap:0.5rem;"><span style="opacity:0.8; flex-shrink:0; width:18px; text-align:center;">${icon}</span><span>${escapeHtml(d.trim())}</span></div>`;
    });
    breakdownList += `</div>`;
  }

  const confVisual = `<div class="pro-card" style="position:relative;"><div class="pro-card-title"><i class="fa-solid fa-gauge-high" style="font-size:16px; margin-right:6px;"></i> AI Confidence</div><div style="display:flex; align-items:center; gap:1.5rem; padding:0.25rem 0 0.25rem 0;"><div style="position:relative; width:110px; height:110px; flex-shrink:0;"><svg viewBox="0 0 100 100" style="transform:rotate(-90deg); width:100%; height:100%;"><circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/><defs><linearGradient id="confGrad_${Date.now()}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="${score >= 8 ? "#10b981" : score >= 5 ? "#a1a1aa" : score >= 3 ? "#f97316" : "#ef4444"}" /><stop offset="100%" stop-color="${score >= 8 ? "#34d399" : score >= 5 ? "#e4e4e7" : score >= 3 ? "#fb923c" : "#dc2626"}" /></linearGradient></defs><circle cx="50" cy="50" r="40" fill="none" stroke="url(#confGrad_${Date.now()})" stroke-width="8" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" style="transition: stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);" /></svg><div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-family:'JetBrains Mono'; font-weight:700; font-size:1.6rem; color:${confColor}; text-align:center; line-height:1;">${score}<span style="font-size:0.5rem; color:var(--text-secondary); font-weight:400;">/10</span></div></div><div style="flex:1; min-width:0;"><div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;"><span style="font-family:'JetBrains Mono'; font-weight:600; font-size:1rem; color:${confColor}; display:flex; align-items:center;">${confIcon} ${confLabel}</span><span style="font-size:0.5rem; background:${confColor}15; color:${confColor}; padding:1px 8px; border-radius:12px; border:1px solid ${confColor}20; font-weight:500;">${confTier}</span></div><div style="font-size:0.65rem; color:var(--text-secondary); margin-top:0.3rem; opacity:0.75; line-height:1.3;">${confDesc}</div>${!isNoData && score < 3 ? `<div style="font-size:0.55rem; color:#ef4444; margin-top:0.2rem; opacity:0.6;"><i class="fa-solid fa-triangle-exclamation"></i> Sinyal tidak dikirim — difilter otomatis</div>` : ""}</div></div>${breakdownList}</div>`;

  let betaVisual = "";
  if (s.beta != null) {
    const betaData = [
      { range: "< 0.5 (Defensif)", wr: "50.0%", ev: "-0.09%" },
      { range: "0.5-0.8 (Low)", wr: "73.6%", ev: "+2.02%" },
      { range: "0.8-1.2 (Market)", wr: "75.4%", ev: "+1.83%" },
      { range: "1.2-1.8 (High)", wr: "66.7%", ev: "+1.09%" },
      { range: "> 1.8 (Very High)", wr: "81.8%", ev: "+4.85%" },
    ];
    let rangeIndex = 0,
      betaLabel = "";
    if (s.beta < 0.5) {
      rangeIndex = 0;
      betaLabel = "Defensif";
    } else if (s.beta < 0.8) {
      rangeIndex = 1;
      betaLabel = "Low";
    } else if (s.beta < 1.2) {
      rangeIndex = 2;
      betaLabel = "Market";
    } else if (s.beta < 1.8) {
      rangeIndex = 3;
      betaLabel = "High";
    } else {
      rangeIndex = 4;
      betaLabel = "Very High";
    }
    const isHighVol = s.beta >= 1.8,
      isLowVol = s.beta < 0.5,
      isOptimal = s.beta >= 0.8 && s.beta <= 2.0;
    let barColor = "#f59e0b";
    if (isHighVol) barColor = "#10b981";
    else if (isLowVol) barColor = "#ef4444";
    else if (isOptimal) barColor = "#3b82f6";
    let recommendation = "";
    if (isHighVol)
      recommendation =
        "Beta > 1.8 → Volatilitas tinggi, pergerakan cepat ke target. Cocok untuk swing dengan partial take profit 50-70%.";
    else if (isOptimal)
      recommendation =
        "Beta 0.8–2.0 → Range optimal untuk swing trade. Prioritaskan jika Confidence Score ≥ 8.";
    else if (isLowVol)
      recommendation =
        "Beta < 0.5 → Terlalu lambat untuk swing. Lebih baik dijadikan watchlist jangka menengah atau skip.";
    else
      recommendation =
        "Beta di luar sweet spot. Pertimbangkan risk-reward dengan cermat, atau tunggu konfirmasi tambahan.";
    let tableRows = betaData
      .map(
        (row, idx) =>
          `<tr style="${idx === rangeIndex ? "background:rgba(16,185,129,0.08); border-left:2px solid #10b981;" : ""}"><td style="padding:2px 4px; font-size:0.6rem; color:var(--text-secondary);">${row.range}</td><td style="padding:2px 4px; font-size:0.6rem; text-align:center; font-weight:600; ${row.wr === "81.8%" ? "color:#10b981;" : ""}">${row.wr}</td><td style="padding:2px 4px; font-size:0.6rem; text-align:center; ${row.ev.includes("+") ? "color:#10b981;" : "color:#ef4444;"}">${row.ev}</td></tr>`,
      )
      .join("");
    betaVisual = `<div class="pro-card"><div class="pro-card-title"><i class="fa-solid fa-chart-line" style="margin-right:6px;"></i> Beta & Risk Profile</div><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.3rem;"><span style="font-size:0.7rem; color:var(--text-secondary);">Beta: <strong style="color:${barColor};">${s.beta}</strong> (${betaLabel})</span><span style="font-size:0.6rem; color:var(--text-secondary);">Volatilitas: ${s.volatilitas}%</span></div><div style="height:4px; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden; margin-bottom:0.5rem;"><div style="width:${Math.min(s.beta * 40, 100)}%; height:100%; background:${barColor};"></div></div><div style="font-size:0.65rem; color:var(--text-secondary); margin-bottom:0.2rem;">Detail per Beta Range:</div><div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.6rem;"><thead><tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><th style="text-align:left; padding:2px 4px; color:var(--text-secondary);">Range</th><th style="text-align:center; padding:2px 4px; color:var(--text-secondary);">Win Rate</th><th style="text-align:center; padding:2px 4px; color:var(--text-secondary);">EV/Trade</th></tr></thead><tbody>${tableRows}</tbody></table></div><div style="margin-top:0.5rem; padding:0.3rem 0.5rem; background:rgba(255,255,255,0.03); border-radius:4px; border-left:3px solid ${barColor};"><span style="font-size:0.6rem; font-weight:600; color:var(--text-secondary);">Rekomendasi:</span><span style="font-size:0.65rem; color:var(--text-primary);">${recommendation}</span></div></div>`;
  }

  const entry = s.entryPrice || 0;
  const tp = s.tp1 || entry * 1.1;
  const sl = s.sl || entry * 0.9;
  const pctTp =
    s.tp1 && s.entryPrice
      ? (((s.tp1 - s.entryPrice) / s.entryPrice) * 100).toFixed(2)
      : "–";
  const pctSl =
    s.sl && s.entryPrice
      ? (((s.sl - s.entryPrice) / s.entryPrice) * 100).toFixed(2)
      : "–";

  const foreignNet = s.foreignNet || 0;
  const foreignParticipation = s.foreignPartisipasi || 25;
  const isForeignBuy = foreignNet > 0;
  const foreignLabel = isForeignBuy ? "NET BUY ASING" : "NET SELL ASING";
  const foreignClass = isForeignBuy ? "buy" : "sell";
  const foreignAbs = Math.abs(foreignNet).toLocaleString();
  const foreignPct = Math.min((Math.abs(foreignNet) / 1000) * 100, 100);

  const headerResetStyle = `<style>.emit-header-simple { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; padding:0.25rem 0; margin-bottom:0.75rem; gap:0.5rem; }.emit-header-simple .left { display:flex; flex-wrap:wrap; align-items:center; gap:0.4rem; flex:1 1 auto; }.emit-header-simple .left .stock-group { display:flex; align-items:center; gap:0.4rem; flex-shrink:0; }.emit-header-simple .left .stock-group .ticker { font-family:'JetBrains Mono',monospace; font-weight:700; font-size:1.2rem; color:var(--text-primary); white-space:nowrap; }.emit-header-simple .left .emit-tag-group { display:flex; flex-wrap:wrap; align-items:center; gap:0.25rem 0.4rem; flex:0 1 auto; }.emit-header-simple .right { font-size:0.7rem; color:var(--text-secondary); opacity:0.6; flex-shrink:0; }.pro-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }.pro-grid-2 .col-left { border-right: 1px solid rgba(255,255,255,0.08); padding-right: 0.5rem; }.pro-grid-2 .col-right { padding-left: 0.5rem; }.price-ladder { display: flex; justify-content: space-around; align-items: center; gap: 0.5rem; padding: 0.2rem 0; margin: 0; }.price-item { display: flex; align-items: center; gap: 0.3rem; flex: 1; justify-content: center; }@media (max-width: 640px) { .pro-grid-2 { display: flex !important; flex-direction: column !important; gap: 0.75rem !important; } .pro-grid-2 .col-left { border-right: none !important; padding-right: 0 !important; } .pro-grid-2 .col-right { padding-left: 0 !important; } .pro-detail-container { padding: 0 !important; } .emit-header-simple .left .stock-group .ticker { font-size:1rem; } .emit-header-simple .left .emit-tag-group .emit-tag { font-size:0.55rem; } .emit-header-simple .left .emit-tag-group .emit-tag i { font-size:0.5rem; } .emit-header-simple .right { font-size:0.6rem; } .price-ladder { flex-wrap: nowrap !important; gap: 0.2rem !important; } .price-item { flex: 1 1 0 !important; justify-content: center !important; } }</style>`;

  let html = `${headerResetStyle}<div class="pro-detail-container"><button class="sig-back-btn" id="dailyBackBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg> Kembali</button><div style="background:rgba(255,255,255,0.02); border-radius:10px; border:1px solid rgba(255,255,255,0.08); overflow:hidden; margin-bottom:0.5rem;"><div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);"><div style="display:grid; grid-template-columns: 1fr auto; gap:0.2rem 0.5rem; align-items:center;"><div style="grid-column:1; grid-row:1; display:flex; flex-direction:column; gap:0.1rem;"><span style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:1.2rem; color:var(--text-primary);">${escapeHtml(s.stockCode)}</span><span style="font-size:0.8rem; color:var(--text-secondary); opacity:0.7;">${escapeHtml(stockInfo.longName)}</span></div><div style="grid-column:1; grid-row:2; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;"><span style="font-family:'JetBrains Mono'; font-weight:600; font-size:1rem; color:var(--text-primary); display:flex; align-items:center;">${priceArrow} ${displayPrice}</span><span style="font-family:'JetBrains Mono'; font-size:0.75rem; color:${gainColor}; font-weight:600; display:flex; align-items:center; gap:0.2rem;">${gainStr}</span>${statusStamp}</div><div style="grid-column:2; grid-row:1 / 3; display:flex; align-items:center; justify-content:center;">${logoHtml}</div><div style="grid-column:1 / 3; grid-row:3; margin-top:0.1rem;">${tagHtml}</div><div style="grid-column:1 / 3; grid-row:4; font-size:0.7rem; color:var(--text-secondary); opacity:0.6; margin-top:0.1rem;">${s.signalDate ? formatFullDateTime(s.signalDate) : ""}</div></div></div><div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);"><div style="display:flex; align-items:center; gap:1rem; padding-bottom:0.4rem; border-bottom:1px solid rgba(255,255,255,0.05); margin-bottom:0.4rem;"><div style="width:48px; height:48px; border-radius:50%; background:${signalBorder}15; border:2px solid ${signalBorder}; display:flex; align-items:center; justify-content:center; flex-shrink:0; color:${signalBorder};">${signalIcon}</div><div style="flex:1;"><div style="font-size:0.55rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-secondary);">Signal Type</div><div style="font-family:'JetBrains Mono'; font-weight:700; font-size:1.3rem; color:${signalBorder}; line-height:1.2;">${signalLabelText}<span style="font-size:0.7rem; font-weight:400; color:var(--text-secondary); margin-left:0.5rem;">${signalLabel}</span></div></div><div style="font-size:0.5rem; background:${signalBorder}15; color:${signalBorder}; padding:2px 10px; border-radius:20px; border:1px solid ${signalBorder}25; text-transform:uppercase; letter-spacing:0.05em; font-weight:600;">${signalDesc}</div></div><div class="price-ladder" style="display:flex; justify-content:space-around; align-items:center; gap:0.5rem; padding:0.2rem 0; margin:0;"><div class="price-item" style="display:flex; align-items:center; gap:0.3rem; flex:1; justify-content:center;"><span class="label" style="font-size:0.6rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.2rem;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Entry</span><span class="value" style="font-family:'JetBrains Mono'; font-weight:600; font-size:0.9rem; color:var(--text-primary);">${fmtPrice(s.entryPrice)}</span><span class="change neutral" style="font-size:0.6rem; color:var(--text-secondary);">—</span></div><div class="price-item" style="display:flex; align-items:center; gap:0.3rem; flex:1; justify-content:center;"><span class="label" style="font-size:0.6rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.2rem;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> TAKE PROFIT</span><span class="value" style="font-family:'JetBrains Mono'; font-weight:600; font-size:0.9rem; color:var(--success);">${fmtPrice(s.tp1)}</span><span class="change positive" style="font-size:0.6rem; color:var(--success);">+${pctTp}%</span></div><div class="price-item" style="display:flex; align-items:center; gap:0.3rem; flex:1; justify-content:center;"><span class="label" style="font-size:0.6rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.2rem;"><i class="fa-solid fa-triangle-exclamation"></i> STOP LOSS</span><span class="value" style="font-family:'JetBrains Mono'; font-weight:600; font-size:0.9rem; color:var(--danger);">${fmtPrice(s.sl)}</span><span class="change negative" style="font-size:0.6rem; color:var(--danger);">${pctSl}%</span></div></div></div>

    <!-- ======== STRATEGY FLOW UNTUK SINYAL BIASA ======== -->
    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      ${renderStrategyFlowForSignal(s)}
    </div>

    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      ${confVisual.replace(/<div class="pro-card" style="position:relative;">/, '<div style="position:relative;">')}
    </div>

    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div class="pro-grid-2" style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
        <div>
          <div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; font-weight:600; font-size:0.8rem; color:var(--text-secondary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> Broker Flow
          </div>
          <div id="brokerFlowContainer" class="broker-flow-container"></div>
        </div>
        <div>
          <div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; font-weight:600; font-size:0.8rem; color:var(--text-secondary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Foreign Flow
          </div>
          <div class="foreign-flow-container"><div class="foreign-row"><span class="foreign-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg> ${foreignLabel}</span><span class="foreign-value ${foreignClass}">${isForeignBuy ? "+" : ""}${foreignAbs} lot</span><div class="foreign-bar-track"><div class="foreign-bar-fill ${foreignClass}-fill" style="width:${Math.min(foreignPct, 100)}%;"></div></div><span class="foreign-participation">${foreignParticipation}%</span></div><div style="font-size:0.65rem; color:var(--text-secondary); display:flex; justify-content:space-between; margin-top:0.3rem;"><span>Partisipasi</span><span>${foreignParticipation}%</span></div></div>
        </div>
      </div>
    </div>

    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div class="pro-grid-2" style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
        <div>
          <div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; font-weight:600; font-size:0.8rem; color:var(--text-secondary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> RSI (14)
          </div>
          <div class="pro-chart-wrap" style="height:120px;"><canvas id="proRsiChart"></canvas></div>
          <div style="text-align:center; font-family:'JetBrains Mono'; font-weight:700; font-size:1.2rem; margin-top:-10px;">${s.rsi != null ? s.rsi.toFixed(2) : "–"}</div>
        </div>
        <div>
          <div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; font-weight:600; font-size:0.8rem; color:var(--text-secondary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> MACD
          </div>
          <div class="pro-chart-wrap" style="height:120px;"><canvas id="proMacdChart"></canvas></div>
          <div style="display:flex; justify-content:space-between; font-size:0.6rem; color:var(--text-secondary); margin-top:0.25rem;"><span>MACD: ${s.macd != null ? s.macd.toFixed(2) : "–"}</span><span>Signal: ${s.macdSignal != null ? s.macdSignal.toFixed(2) : "–"}</span></div>
        </div>
      </div>
    </div>

    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div class="pro-grid-2">
        <div class="col-left">${betaVisual ? betaVisual.replace(/<div class="pro-card">/, '<div style="">') : `<div style="color:var(--text-secondary); opacity:0.5; font-size:0.8rem;">Tidak ada data Beta</div>`}</div>
      </div>
    </div>

    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div class="pro-grid-2">
        <div class="col-right" style="width:100%;">
          <div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; font-weight:600; font-size:0.8rem; color:var(--text-secondary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Teknikal
          </div>
          <div class="pro-indicator-list">${renderIndRow("EMA 20", fmtPrice(s.ema20), s.ema20, s.entryPrice)}${renderIndRow("EMA 50", fmtPrice(s.ema50), s.ema50, s.entryPrice)}${renderIndRow("VWAP", fmtPrice(s.vwap), s.vwap, s.entryPrice)}${s.adx != null ? `<div class="pro-ind-row"><span class="pro-ind-label">ADX</span><div class="pro-ind-track"><div class="pro-ind-fill bg-warning" style="width:${Math.min(s.adx, 100)}%;"></div></div><span class="pro-ind-val">${s.adx}</span></div>` : ""}${s.atr != null ? `<div class="pro-ind-row"><span class="pro-ind-label">ATR</span><div class="pro-ind-track"><div class="pro-ind-fill bg-neutral" style="width:${Math.min((s.atr / (s.entryPrice || 1)) * 100, 100)}%;"></div></div><span class="pro-ind-val">${fmtPrice(s.atr)}</span></div>` : ""}</div>
        </div>
      </div>
    </div>

    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; font-weight:600; font-size:0.8rem; color:var(--text-secondary);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Chart Pattern
      </div>
      <div id="patternVisualContainer"></div>
      <div style="margin-top:0.5rem;">
        <div style="font-size:0.75rem; color:var(--text-secondary);"><strong>Chart:</strong> ${s.patternChart || "–"}</div>
        <div style="font-size:0.75rem; color:var(--text-secondary);"><strong>Candle:</strong> ${s.patternCandle || "–"}</div>
      </div>
    </div>

    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">${s.analystOpinion ? `<div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; font-weight:600; font-size:0.8rem; color:var(--text-secondary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Analyst Opinion</div><div class="pro-text-box">${escapeHtml(s.analystOpinion)}</div>` : `<div style="display:flex; align-items:center; justify-content:center; color:var(--text-secondary); opacity:0.4; font-size:0.8rem;">Tidak ada opini analis</div>`}</div>${s.relatedNews && s.relatedNews.length ? `<div style="padding:0.5rem 0.75rem;"><div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.3rem; font-weight:600; font-size:0.8rem; color:var(--text-secondary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Berita Terkait</div><ul class="pro-news-list">${s.relatedNews.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul></div>` : ""}</div></div>`;

  container.innerHTML = html;
  const backBtn = container.querySelector("#dailyBackBtn");
  if (backBtn && onBack) backBtn.addEventListener("click", onBack);

  requestAnimationFrame(() => {
    setTimeout(() => {
      if (!document.contains(container)) return;
      renderDetailCharts(s, container);
      renderBrokerFlow(s.topBuyers, s.topSellers, s.sinyalBandar, container);
      renderPatternVisual(s.patternChart, container);
    }, 50);
  });
}

async function renderPerformanceSignalList(status) {
  const container = document.getElementById("signalListContainer");
  if (!container) return;

  if (!currentDateRange || !currentDateRange.start || !currentDateRange.end) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:1rem;">Rentang tanggal tidak valid.</div>`;
    return;
  }

  const { start, end } = currentDateRange;
  container.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:1rem;"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>`;

  try {
    const res = await fetch("/api/signals");
    if (!res.ok) throw new Error("Gagal fetch signals");
    const data = await res.json();

    const running = data.running || [];
    const closed = data.closed || [];

    const allSignals = [...running, ...closed].filter(
      (s) => s.status !== "WAITING_ENTRY" && s.status !== "EXPIRED",
    );

    const filteredByDate = allSignals.filter((s) => {
      let dateToCheck = null;
      if (s.status === "TP" || s.status === "SL" || s.status === "STOP LOSS") {
        dateToCheck = s.closeDate ? s.closeDate.split(" ")[0] : null;
      } else if (s.status === "RUNNING" || s.status === "TRAILING") {
        dateToCheck = s.signalDate ? s.signalDate.split(" ")[0] : null;
      } else {
        dateToCheck = s.signalDate ? s.signalDate.split(" ")[0] : null;
      }
      if (!dateToCheck) return false;
      return dateToCheck >= start && dateToCheck <= end;
    });

    let filteredByStatus = [];
    if (status === "TP") {
      filteredByStatus = filteredByDate.filter((s) => s.status === "TP");
    } else if (status === "SL") {
      filteredByStatus = filteredByDate.filter(
        (s) => s.status === "SL" || s.status === "STOP LOSS",
      );
    } else if (status === "RUNNING") {
      filteredByStatus = filteredByDate.filter(
        (s) => s.status === "RUNNING" || s.status === "TRAILING",
      );
    } else {
      filteredByStatus = filteredByDate;
    }

    const totalCountEl = document.getElementById("signalTotalCount");
    if (totalCountEl) {
      totalCountEl.textContent = filteredByStatus.length;
    }

    if (!filteredByStatus.length) {
      container.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:1rem;opacity:0.5;"><i class="fa-regular fa-circle" style="margin-right:0.3rem;"></i> Tidak ada sinyal dengan status ${status} pada periode ini</div>`;
      return;
    }

    const symbols = [...new Set(filteredByStatus.map((s) => s.stockCode))];
    const [priceResults, infoResults] = await Promise.all([
      Promise.all(symbols.map((sym) => fetchStockPrice(sym))),
      Promise.all(symbols.map((sym) => fetchStockInfo(sym))),
    ]);

    const priceMap = {};
    const infoMap = {};
    symbols.forEach((sym, idx) => {
      priceMap[sym] = priceResults[idx];
      infoMap[sym] = infoResults[idx];
    });

    let html = `<div class="sig-list">`;
    html += renderSignalRows(filteredByStatus, priceMap, infoMap);
    html += `</div>`;

    container.innerHTML = html;

    const rows = container.querySelectorAll(".sig-list-row");
    rows.forEach((row) => {
      row.addEventListener("click", function () {
        const stock = this.dataset.stock;
        const date = this.dataset.date;
        if (stock && date) {
          showDailySignalDetail(stock, date);
        }
      });
    });
  } catch (err) {
    console.error("Gagal render performance list:", err);
    container.innerHTML = `<div style="color:var(--danger);padding:1rem;"><i class="fa-solid fa-triangle-exclamation" style="margin-right:0.3rem;"></i> Gagal memuat data</div>`;
  }
}

function getSortedSignals() {
  const allSignals = [
    ..._allRunning.map((s) => ({ ...s, _type: "running" })),
    ..._allClosed.map((s) => ({ ...s, _type: "closed" })),
  ];
  const priority = {
    "STRONG BUY": 1,
    BUY: 2,
    WATCHLIST: 3,
    SELL: 4,
    "STRONG SELL": 5,
    BSJP: 6,
  };
  allSignals.sort((a, b) => {
    const pa = priority[a.signalType] || 99;
    const pb = priority[b.signalType] || 99;
    if (pa !== pb) return pa - pb;
    if (b.confidenceScore !== a.confidenceScore)
      return (b.confidenceScore || 0) - (a.confidenceScore || 0);
    if (a.signalDate && b.signalDate)
      return b.signalDate.localeCompare(a.signalDate);
    return (a.stockCode || "").localeCompare(b.stockCode || "");
  });
  return allSignals;
}

function getSessionFromDate(signalDate) {
  if (!signalDate) return null;
  const date = new Date(signalDate);
  const hour = date.getHours();
  const minute = date.getMinutes();
  const time = hour + minute / 60;
  if (time >= 4 && time < 12) return 1;
  if (time >= 12 && time <= 16) return 2;
  return null;
}

function getColorFromCode(code) {
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

const hitSvg = `<img src="https://stockbit.com/assets/img/correct.png" alt="HIT" style="width:36px; height:36px; object-fit:contain; display:inline-block;">`;
const missedSvg = `<img src="https://stockbit.com/assets/img/missed.png" alt="MISSED" style="width:36px; height:36px; object-fit:contain; display:inline-block;">`;
const hitSvgrow = `<img src="https://stockbit.com/assets/img/correct.png" alt="HIT" style="width:50px; height:50px; object-fit:contain; display:inline-block;">`;
const missedSvgrow = `<img src="https://stockbit.com/assets/img/missed.png" alt="MISSED" style="width:50px; height:50px; object-fit:contain; display:inline-block;">`;

function renderSignalRows(signals, priceMap, infoMap) {
  let rows = "";
  signals.forEach((s) => {
    let priceDisplay = "—";
    let gainStr = "";
    let gainColor = "";
    let arrowIcon = "";
    let arrowPrice = "";
    let statusBadge = "";
    if (s.status === "TP") {
      const exitPrice = s.exitPrice || s.tp1;
      const entryPrice = s.entryPrice;
      const ret =
        entryPrice && exitPrice
          ? ((exitPrice - entryPrice) / entryPrice) * 100
          : 0;
      const priceVal = exitPrice != null ? fmtPriceNoRp(exitPrice) : "—";
      const sign = ret >= 0 ? "+" : "";
      gainStr = `${sign}${ret.toFixed(2)}%`;
      gainColor =
        ret > 0.01
          ? "#10b981"
          : ret < -0.01
            ? "#ef4444"
            : "var(--text-secondary)";
      if (ret > 0.01) {
        arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
        arrowPrice = `<i class="fa-solid fa-arrow-up" style="font-size:0.6rem; color:#10b981; margin-right:0.1rem;"></i>`;
      } else if (ret < -0.01) {
        arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
        arrowPrice = `<i class="fa-solid fa-arrow-down" style="font-size:0.6rem; color:#ef4444; margin-right:0.1rem;"></i>`;
      } else {
        arrowIcon = "";
        arrowPrice = "";
      }
      priceDisplay = `${arrowPrice} ${priceVal}`;
      statusBadge = `<span class="sig-status-stamp">${hitSvgrow}</span>`;
    } else if (s.status === "SL" || s.status === "STOP LOSS") {
      const exitPrice = s.exitPrice || s.sl;
      const entryPrice = s.entryPrice;
      const ret =
        entryPrice && exitPrice
          ? ((exitPrice - entryPrice) / entryPrice) * 100
          : 0;
      const priceVal = exitPrice != null ? fmtPriceNoRp(exitPrice) : "—";
      const sign = ret >= 0 ? "+" : "";
      gainStr = `${sign}${ret.toFixed(2)}%`;
      gainColor =
        ret > 0.01
          ? "#10b981"
          : ret < -0.01
            ? "#ef4444"
            : "var(--text-secondary)";
      if (ret > 0.01) {
        arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
        arrowPrice = `<i class="fa-solid fa-arrow-up" style="font-size:0.6rem; color:#10b981; margin-right:0.1rem;"></i>`;
      } else if (ret < -0.01) {
        arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
        arrowPrice = `<i class="fa-solid fa-arrow-down" style="font-size:0.6rem; color:#ef4444; margin-right:0.1rem;"></i>`;
      } else {
        arrowIcon = "";
        arrowPrice = "";
      }
      priceDisplay = `${arrowPrice} ${priceVal}`;
      statusBadge = `<span class="sig-status-stamp">${missedSvgrow}</span>`;
    } else {
      const currentPrice = priceMap[s.stockCode];
      const priceVal = currentPrice != null ? fmtPriceNoRp(currentPrice) : "—";
      priceDisplay = priceVal;
      const isRunning =
        (s.status === "RUNNING" || s.status === "TRAILING") &&
        s.entryPrice &&
        currentPrice;
      if (isRunning) {
        const gainAbs = currentPrice - s.entryPrice;
        const gainPct = (gainAbs / s.entryPrice) * 100;
        const absGain = Math.abs(gainAbs).toFixed(0);
        const absPct = Math.abs(gainPct).toFixed(2);

        if (Math.abs(gainAbs) < 0.01) {
          gainColor = "var(--text-secondary)";
          gainStr = `0 (0.00%)`;
          arrowIcon = "";
        } else if (gainAbs > 0) {
          arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
          gainColor = "#10b981";
          gainStr = `${arrowIcon} ${absGain} (+${absPct}%)`;
        } else {
          arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
          gainColor = "#ef4444";
          gainStr = `${arrowIcon} ${absGain} (-${absPct}%)`;
        }
      } else {
        gainStr = "—";
        gainColor = "var(--text-secondary)";
        arrowIcon = "";
      }
    }
    const info = infoMap[s.stockCode] || { longName: s.stockCode };
    const stockbitUrl = `https://assets.stockbit.com/logos/companies/${s.stockCode}.png`;
    const parqetUrl = `https://assets.parqet.com/logos/symbol/${s.stockCode}.png`;
    const bgColor = getColorFromCode(s.stockCode);
    const logoHtml = `
      <div class="stock-logo-wrapper">
        <img src="${stockbitUrl}" alt="${s.stockCode}" class="stock-logo"
          onerror="this.onerror=null; this.src='${parqetUrl}'; this.onerror=function(){ this.style.display='none'; this.nextElementSibling.style.display='flex'; }">
        <div class="stock-logo-fallback" style="display:none; background:${bgColor};">${s.stockCode.substring(0, 2)}</div>
      </div>
    `;
    const confidence = s.confidenceScore || 0;
    const hasDetails = s.confidenceDetails && s.confidenceDetails.length > 0;
    const isNoData = confidence === 0 && !hasDetails;

    let confDisplay;
    if (isNoData) {
      confDisplay = "";
    } else {
      let scoreClass = "normal";
      if (confidence >= 8) scoreClass = "high";
      else if (confidence >= 5) scoreClass = "normal";
      else if (confidence >= 3) scoreClass = "low";
      else scoreClass = "skip";
      confDisplay = `<span class="conf-score-badge" data-score="${scoreClass}">${confidence}/10</span>`;
    }

    const signalType = (s.signalType || "WATCHLIST").toUpperCase();
    let badgeColor = "#71717a";
    let badgeBg = "rgba(113,113,122,0.15)";
    let badgeIcon = "fa-eye";

    if (signalType === "TECHNICAL") {
      badgeColor = "#06b6d4";
      badgeBg = "rgba(6,182,212,0.15)";
      badgeIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 3px;">
      <line x1="5" y1="16" x2="5" y2="20" />
      <line x1="10" y1="11" x2="10" y2="20" />
      <line x1="15" y1="14" x2="15" y2="20" />
      <line x1="20" y1="12" x2="20" y2="20" />
      <path d="M 4 13 L 10 6 L 15 10 L 21 4" />
    </svg>
  `;
    } else if (signalType === "BSJP") {
      badgeColor = "#8b5cf6";
      badgeBg = "rgba(139,92,246,0.15)";
      badgeIcon = "fa-chart-simple";
    } else if (signalType.includes("STRONG BUY")) {
      badgeColor = "#fbbf24";
      badgeBg = "rgba(251,191,36,0.15)";
      badgeIcon = "fa-fire";
    } else if (signalType.includes("BUY") && !signalType.includes("STRONG")) {
      badgeColor = "#10b981";
      badgeBg = "rgba(16,185,129,0.15)";
      badgeIcon = "fa-arrow-trend-up";
    } else if (signalType.includes("STRONG SELL")) {
      badgeColor = "#dc2626";
      badgeBg = "rgba(220,38,38,0.15)";
      badgeIcon = "fa-skull";
    } else if (signalType.includes("SELL") && !signalType.includes("STRONG")) {
      badgeColor = "#ef4444";
      badgeBg = "rgba(239,68,68,0.15)";
      badgeIcon = "fa-arrow-trend-down";
    } else {
      badgeColor = "#71717a";
      badgeBg = "rgba(113,113,122,0.15)";
      badgeIcon = "fa-eye";
    }

    const typeBadge = `<span class="sig-type-badge" style="
  font-size:0.55rem; 
  font-weight:600; 
  color:${badgeColor}; 
  background:${badgeBg}; 
  padding:0.15rem 0.5rem; 
  border-radius:12px; 
  border:1px solid ${badgeColor}33; 
  display:inline-flex; 
  align-items:center; 
  gap:0.2rem;
  white-space:nowrap;
  margin-left:0.3rem;
">
  ${badgeIcon.trim().startsWith("<svg") ? badgeIcon : `<i class="fa-solid ${badgeIcon}" style="font-size:0.5rem;"></i>`}
  ${signalType.replace("STRONG ", "S.")}
</span>`;

    rows += `<div class="sig-list-row" data-stock="${s.stockCode}" data-date="${s.signalDate}">
      ${logoHtml}
      <div class="sig-list-name">
        <div class="sig-name-row">
          <div class="sig-stock-info">
            <div class="sig-stock-top">
              <span class="sig-stock-code">${escapeHtml(s.stockCode)}</span>
              ${typeBadge}
              ${confDisplay}
            </div>
            <div class="sig-stock-longname">${escapeHtml(info.longName)}</div>
          </div>
          <div class="sig-right" style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0; margin-left:auto;">
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.1rem;">
              <span class="stock-price" style="font-size:0.9rem; font-weight:600; color:var(--text-primary); display:flex; align-items:center; gap:0.1rem;">${priceDisplay}</span>
              <span style="font-family:'JetBrains Mono'; font-size:0.65rem; color:${gainColor}; font-weight:600; display:flex; align-items:center; gap:0.2rem;">${gainStr}</span>
            </div>
            ${statusBadge}
          </div>
        </div>
      </div>
    </div>`;
  });
  return rows;
}

function closeAllDropdowns() {
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
}

async function showSignalList() {
  isDetailView = false;
  currentDetailIndex = null;
  const container = document.getElementById("signals");
  if (!container) return;

  if (currentSignalFilter === "none" || currentSignalFilter === null) {
    container.innerHTML = `<div class="loading-state"><p>Pilih filter sinyal</p></div>`;
    signalListRendered = false;
    return;
  }

  const allSignals = getSortedSignals().filter(
    (s) => s.signalType !== "TECHNICAL",
  );

  if (!allSignals.length) {
    container.innerHTML = `<div class="loading-state"><p>Belum ada sinyal.</p></div>`;
    signalListRendered = false;
    return;
  }

  let filteredSignals = [];
  const filterType = currentSignalFilter;
  const today = getTodayWIB();

  if (filterType === "today") {
    filteredSignals = allSignals.filter(
      (s) => s.signalDate && s.signalDate.startsWith(today),
    );
  } else if (filterType === "running") {
    filteredSignals = allSignals.filter(
      (s) => s.status === "RUNNING" || s.status === "TRAILING",
    );
  } else {
    filteredSignals = allSignals;
  }

  if (!filteredSignals.length) {
    const msg =
      filterType === "today"
        ? "Tidak ada sinyal hari ini."
        : filterType === "running"
          ? "Tidak ada posisi running."
          : "Tidak ada sinyal.";
    container.innerHTML = `<div class="loading-state"><p>${msg}</p></div>`;
    signalListRendered = false;
    return;
  }

  const symbols = [...new Set(filteredSignals.map((s) => s.stockCode))];
  const [priceResults, infoResults] = await Promise.all([
    Promise.all(symbols.map((sym) => fetchStockPrice(sym))),
    Promise.all(symbols.map((sym) => fetchStockInfo(sym))),
  ]);
  const priceMap = {};
  const infoMap = {};
  symbols.forEach((sym, idx) => {
    priceMap[sym] = priceResults[idx];
    infoMap[sym] = infoResults[idx];
  });

  let totalGainPct = 0;
  let totalRunningCount = 0;
  filteredSignals.forEach((s) => {
    let gainPct = 0;
    if (s.status === "TP" || s.status === "SL" || s.status === "STOP LOSS") {
      gainPct = s.returnPercent || 0;
      if (gainPct !== 0) {
        totalGainPct += gainPct;
        totalRunningCount++;
      }
    } else if (
      (s.status === "RUNNING" || s.status === "TRAILING") &&
      s.entryPrice &&
      priceMap[s.stockCode]
    ) {
      const currentPrice = priceMap[s.stockCode];
      gainPct = ((currentPrice - s.entryPrice) / s.entryPrice) * 100;
      if (gainPct !== 0) {
        totalGainPct += gainPct;
        totalRunningCount++;
      }
    }
  });

  let avgGainPct = totalRunningCount > 0 ? totalGainPct / totalRunningCount : 0;
  let totalGainStr = "";
  let totalGainColor = "";
  let arrowIconTotal = "";
  if (totalRunningCount > 0) {
    const sign = avgGainPct >= 0 ? "+" : "";
    totalGainStr = `${sign}${avgGainPct.toFixed(2)}%`;
    totalGainColor = avgGainPct >= 0 ? "#10b981" : "#ef4444";
    if (avgGainPct > 0.01) {
      arrowIconTotal = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
    } else if (avgGainPct < -0.01) {
      arrowIconTotal = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
    }
  } else {
    totalGainStr = "—";
    totalGainColor = "var(--text-secondary)";
    arrowIconTotal = "";
  }

  let html = "";

  if (filterType === "today") {
    const session1 = filteredSignals.filter(
      (s) => getSessionFromDate(s.signalDate) === 1 && s.signalType !== "BSJP",
    );
    const session2 = filteredSignals.filter(
      (s) => getSessionFromDate(s.signalDate) === 2 && s.signalType !== "BSJP",
    );
    const bsjpToday = filteredSignals.filter((s) => s.signalType === "BSJP");
    const other = filteredSignals.filter(
      (s) =>
        getSessionFromDate(s.signalDate) === null && s.signalType !== "BSJP",
    );

    html += `
      <div class="sig-list-header" style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); margin-bottom:0.5rem;">
        <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary);">
          SINYAL HARI INI
          <span style="font-weight:400; color:var(--text-secondary); opacity:0.6;">(${filteredSignals.length})</span>
        </span>
        <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary);">
          GAIN: ${arrowIconTotal} <span style="font-weight:600; color:${totalGainColor};">${totalGainStr}</span>
        </span>
      </div>
    `;

    if (session1.length) {
      html += `<div class="session-header">SESI 1</div>`;
      html += `<div class="sig-list">${renderSignalRows(session1, priceMap, infoMap)}</div>`;
    }

    if (session2.length) {
      html += `<div class="session-header">SESI 2</div>`;
      html += `<div class="sig-list">${renderSignalRows(session2, priceMap, infoMap)}</div>`;
    }

    if (bsjpToday.length) {
      html += `<div class="session-header" style="color:var(--text-primary);">BSJP</div>`;
      html += `<div class="sig-list">${renderSignalRows(bsjpToday, priceMap, infoMap)}</div>`;
    }

    if (other.length) {
      html += `<div class="session-header">LAINNYA</div>`;
      html += `<div class="sig-list">${renderSignalRows(other, priceMap, infoMap)}</div>`;
    }
  } else if (filterType === "running") {
    const runningBiasa = filteredSignals.filter((s) => s.signalType !== "BSJP");
    const runningBsjp = filteredSignals.filter((s) => s.signalType === "BSJP");
    const allRunning = [...runningBiasa, ...runningBsjp];

    let totalGain = 0,
      totalCount = 0;
    allRunning.forEach((s) => {
      if (s.entryPrice && priceMap[s.stockCode]) {
        const gain =
          ((priceMap[s.stockCode] - s.entryPrice) / s.entryPrice) * 100;
        if (gain !== 0) {
          totalGain += gain;
          totalCount++;
        }
      }
    });
    const avgTotalGain = totalCount > 0 ? totalGain / totalCount : 0;
    const totalGainStr =
      totalCount > 0
        ? (avgTotalGain >= 0 ? "+" : "") + avgTotalGain.toFixed(2) + "%"
        : "—";
    const totalGainColor = avgTotalGain >= 0 ? "#10b981" : "#ef4444";

    if (allRunning.length) {
      html += `
        <div class="sig-list-header" style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); margin-bottom:0.5rem;">
          <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary);">
            ALL RUNNING
            <span style="font-weight:400; color:var(--text-secondary); opacity:0.6;">(${allRunning.length})</span>
          </span>
          <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary);">
            GAIN: <span style="font-weight:600; color:${totalGainColor};">${totalGainStr}</span>
          </span>
        </div>
        <div class="sig-list">${renderSignalRows(runningBiasa, priceMap, infoMap)}</div>
      `;

      if (runningBsjp.length) {
        html += `
          <div class="sig-list-header" style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); margin-bottom:0.5rem; color:var(--text-primary);">
            <span style="font-weight:600; font-size:0.9rem;">
              BSJP
              <span style="font-weight:400; color:var(--text-secondary); opacity:0.6;">(${runningBsjp.length})</span>
            </span>
          </div>
          <div class="sig-list">${renderSignalRows(runningBsjp, priceMap, infoMap)}</div>
        `;
      }
    }
  } else {
    html += `
      <div class="sig-list-header" style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); margin-bottom:0.5rem;">
        <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary);">
          SAHAM
          <span style="font-weight:400; color:var(--text-secondary); opacity:0.6;">(${filteredSignals.length})</span>
        </span>
        <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary);">
          GAIN: ${arrowIconTotal} <span style="font-weight:600; color:${totalGainColor};">${totalGainStr}</span>
        </span>
      </div>
      <div class="sig-list">${renderSignalRows(filteredSignals, priceMap, infoMap)}</div>
    `;
  }

  container.innerHTML = html;
  signalListRendered = true;

  container.querySelectorAll(".sig-list-row").forEach((row) => {
    row.addEventListener("click", function (e) {
      const stock = this.dataset.stock;
      const date = this.dataset.date;
      if (stock && date) {
        showSignalDetailByStock(stock, date);
      }
    });
  });
}

async function updateSignalList() {
  if (isDetailView) return;
  if (!signalListRendered) {
    await showSignalList();
    return;
  }
  const container = document.getElementById("signals");
  if (!container) return;

  const allSignals = getSortedSignals().filter(
    (s) => s.signalType !== "TECHNICAL",
  );
  if (!allSignals.length) return;

  let filteredSignals = [];
  const filterType = currentSignalFilter;
  const today = getTodayWIB();

  if (filterType === "today") {
    filteredSignals = allSignals.filter(
      (s) => s.signalDate && s.signalDate.startsWith(today),
    );
  } else if (filterType === "running") {
    filteredSignals = allSignals.filter(
      (s) => s.status === "RUNNING" || s.status === "TRAILING",
    );
  } else {
    filteredSignals = allSignals;
  }
  if (!filteredSignals.length) return;

  const symbols = [...new Set(filteredSignals.map((s) => s.stockCode))];
  const [priceResults] = await Promise.all([
    Promise.all(symbols.map((sym) => fetchStockPrice(sym))),
  ]);
  const priceMap = {};
  symbols.forEach((sym, idx) => {
    priceMap[sym] = priceResults[idx];
  });

  const rows = container.querySelectorAll(".sig-list-row");
  rows.forEach((row) => {
    const stock = row.dataset.stock;
    const date = row.dataset.date;
    if (!stock || !date) return;

    const signal = filteredSignals.find(
      (s) => s.stockCode === stock && s.signalDate === date,
    );
    if (!signal) return;
    const price = priceMap[stock];
    const priceEl = row.querySelector(".stock-price");
    const gainEl = row.querySelector(".sig-right span:last-child");
    if (!priceEl) return;

    const isRunning =
      signal.status === "RUNNING" || signal.status === "TRAILING";
    if (!isRunning) return;

    if (price != null) {
      let displayPrice = fmtPriceNoRp(price);
      let arrowPrice = "";
      const gainAbs = price - signal.entryPrice;
      if (gainAbs > 0) {
        arrowPrice = `<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.7rem; margin-right:0.1rem;"></i>`;
      } else if (gainAbs < 0) {
        arrowPrice = `<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.7rem; margin-right:0.1rem;"></i>`;
      }
      priceEl.innerHTML = `${arrowPrice} ${displayPrice}`;
      if (gainEl && signal.entryPrice) {
        const gainPct = (gainAbs / signal.entryPrice) * 100;
        const absGain = Math.abs(gainAbs).toFixed(0);
        const absPct = Math.abs(gainPct).toFixed(2);
        let gainStr = "";
        let gainColor = "";
        if (Math.abs(gainAbs) < 0.01) {
          gainStr = `0 (0.00%)`;
          gainColor = "var(--text-secondary)";
        } else if (gainAbs > 0) {
          gainStr = `+${absGain} (+${absPct}%)`;
          gainColor = "#10b981";
        } else {
          gainStr = `-${absGain} (-${absPct}%)`;
          gainColor = "#ef4444";
        }
        gainEl.style.color = gainColor;
        if (gainAbs > 0) {
          gainEl.innerHTML = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i> ${gainStr}`;
        } else if (gainAbs < 0) {
          gainEl.innerHTML = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i> ${gainStr}`;
        } else {
          gainEl.innerHTML = gainStr;
        }
      }
    } else {
      priceEl.textContent = "—";
    }
  });
}

function selectTechnicalFilter(filter) {
  isDetailView = false;
  currentDetailIndex = null;
  currentTechnicalFilter = filter;
  const pageTitle = document.querySelector(".page-title");
  const pageSubtitle = document.querySelector(".page-subtitle");

  if (filter === "today") {
    pageTitle.innerText = "Technical: Hari Ini";
    pageSubtitle.innerText = "Today's technical strategy signals";
    window.location.hash = "#technical-today";
  } else if (filter === "running") {
    pageTitle.innerText = "Technical: Running";
    pageSubtitle.innerText = "Active technical dynamic positions";
    window.location.hash = "#technical-running";
  } else if (filter === "waiting") {
    pageTitle.innerText = "Technical: Waiting Entry";
    pageSubtitle.innerText = "Pending execution asset setups";
    window.location.hash = "#technical-waiting";
  }

  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById("technical-signals").classList.add("active");
  currentTab = "technical-signals";
  technicalListRendered = false;
  fetchSignals(true);

  // BUKA DROPDOWN TECHNICAL
  const techParent = document.getElementById("technicalParent");
  const techSub = document.getElementById("technicalSubMenu");
  if (techParent && techSub) {
    techParent.classList.add("open");
    techSub.classList.add("open");
    techSub.style.display = "block";
    const arrow = techParent.querySelector(".nav-arrow");
    if (arrow) arrow.classList.add("open");
  }
}

function renderTechnicalRows(signals, priceMap, infoMap) {
  let rows = "";
  signals.forEach((s) => {
    let priceDisplay = "—";
    let gainStr = "";
    let gainColor = "";
    let arrowIcon = "";
    let arrowPrice = "";
    let statusBadge = "";

    if (s.status === "TP") {
      const exitPrice = s.exitPrice || s.tp1;
      const entryPrice = s.entryPrice;
      const ret =
        entryPrice && exitPrice
          ? ((exitPrice - entryPrice) / entryPrice) * 100
          : 0;
      const priceVal = exitPrice != null ? fmtPriceNoRp(exitPrice) : "—";
      const sign = ret >= 0 ? "+" : "";
      gainStr = `${sign}${ret.toFixed(2)}%`;
      gainColor =
        ret > 0.01
          ? "#10b981"
          : ret < -0.01
            ? "#ef4444"
            : "var(--text-secondary)";
      if (ret > 0.01) {
        arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
        arrowPrice = `<i class="fa-solid fa-arrow-up" style="font-size:0.6rem; color:#10b981; margin-right:0.1rem;"></i>`;
      } else if (ret < -0.01) {
        arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
        arrowPrice = `<i class="fa-solid fa-arrow-down" style="font-size:0.6rem; color:#ef4444; margin-right:0.1rem;"></i>`;
      } else {
        arrowIcon = "";
        arrowPrice = "";
      }
      priceDisplay = `${arrowPrice} ${priceVal}`;
      statusBadge = `<span class="sig-status-stamp">${hitSvgrow}</span>`;
    } else if (s.status === "SL" || s.status === "STOP LOSS") {
      const exitPrice = s.exitPrice || s.sl;
      const entryPrice = s.entryPrice;
      const ret =
        entryPrice && exitPrice
          ? ((exitPrice - entryPrice) / entryPrice) * 100
          : 0;
      const priceVal = exitPrice != null ? fmtPriceNoRp(exitPrice) : "—";
      const sign = ret >= 0 ? "+" : "";
      gainStr = `${sign}${ret.toFixed(2)}%`;
      gainColor =
        ret > 0.01
          ? "#10b981"
          : ret < -0.01
            ? "#ef4444"
            : "var(--text-secondary)";
      if (ret > 0.01) {
        arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
        arrowPrice = `<i class="fa-solid fa-arrow-up" style="font-size:0.6rem; color:#10b981; margin-right:0.1rem;"></i>`;
      } else if (ret < -0.01) {
        arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
        arrowPrice = `<i class="fa-solid fa-arrow-down" style="font-size:0.6rem; color:#ef4444; margin-right:0.1rem;"></i>`;
      } else {
        arrowIcon = "";
        arrowPrice = "";
      }
      priceDisplay = `${arrowPrice} ${priceVal}`;
      statusBadge = `<span class="sig-status-stamp">${missedSvgrow}</span>`;
    } else {
      const currentPrice = priceMap[s.stockCode];
      const priceVal = currentPrice != null ? fmtPriceNoRp(currentPrice) : "—";
      priceDisplay = priceVal;
      const isRunning =
        (s.status === "RUNNING" || s.status === "TRAILING") &&
        s.entryPrice &&
        currentPrice;
      if (isRunning) {
        const gainAbs = currentPrice - s.entryPrice;
        const gainPct = (gainAbs / s.entryPrice) * 100;
        const absGain = Math.abs(gainAbs).toFixed(0);
        const absPct = Math.abs(gainPct).toFixed(2);
        if (Math.abs(gainAbs) < 0.01) {
          gainColor = "var(--text-secondary)";
          gainStr = `0 (0.00%)`;
          arrowIcon = "";
        } else if (gainAbs > 0) {
          arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
          gainColor = "#10b981";
          gainStr = `${arrowIcon} ${absGain} (+${absPct}%)`;
        } else {
          arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
          gainColor = "#ef4444";
          gainStr = `${arrowIcon} ${absGain} (-${absPct}%)`;
        }
      } else {
        gainStr = "—";
        gainColor = "var(--text-secondary)";
        arrowIcon = "";
      }
    }

    const info = infoMap[s.stockCode] || { longName: s.stockCode };
    const stockbitUrl = `https://assets.stockbit.com/logos/companies/${s.stockCode}.png`;
    const parqetUrl = `https://assets.parqet.com/logos/symbol/${s.stockCode}.png`;
    const bgColor = getColorFromCode(s.stockCode);
    const logoHtml = `
      <div class="stock-logo-wrapper">
        <img src="${stockbitUrl}" alt="${s.stockCode}" class="stock-logo"
          onerror="this.onerror=null; this.src='${parqetUrl}'; this.onerror=function(){ this.style.display='none'; this.nextElementSibling.style.display='flex'; }">
        <div class="stock-logo-fallback" style="display:none; background:${bgColor};">${s.stockCode.substring(0, 2)}</div>
      </div>
    `;

    const techBadge = `<span class="sig-type-badge" style="
      font-size:0.55rem; 
      font-weight:600; 
      color:#06b6d4; 
      background:rgba(6,182,212,0.15); 
      padding:0.15rem 0.5rem; 
      border-radius:12px; 
      border:1px solid rgba(6,182,212,0.3); 
      display:inline-flex; 
      align-items:center; 
      gap:0.2rem;
      white-space:nowrap;
      margin-left:0.3rem;
    ">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:0.55rem; height:0.55rem; display:block;">
        <line x1="5" y1="16" x2="5" y2="20" />
        <line x1="10" y1="11" x2="10" y2="20" />
        <line x1="15" y1="14" x2="15" y2="20" />
        <line x1="20" y1="12" x2="20" y2="20" />
        <path d="M 4 13 L 10 6 L 15 10 L 21 4" />
      </svg> TECHNICAL
    </span>`;

    rows += `<div class="sig-list-row" data-stock="${s.stockCode}" data-date="${s.signalDate}">
      ${logoHtml}
      <div class="sig-list-name">
        <div class="sig-name-row">
          <div class="sig-stock-info">
            <div class="sig-stock-top">
              <span class="sig-stock-code">${escapeHtml(s.stockCode)}</span>
              ${techBadge}
              <!-- Badge status WAITING/ACTIVE dihapus -->
            </div>
            <div class="sig-stock-longname">${escapeHtml(info.longName)}</div>
          </div>
          <div class="sig-right" style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0; margin-left:auto;">
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.1rem;">
              <span class="stock-price" style="font-size:0.9rem; font-weight:600; color:var(--text-primary); display:flex; align-items:center; gap:0.1rem;">${priceDisplay}</span>
              <span style="font-family:'JetBrains Mono'; font-size:0.65rem; color:${gainColor}; font-weight:600; display:flex; align-items:center; gap:0.2rem;">${gainStr}</span>
            </div>
            ${statusBadge}
          </div>
        </div>
      </div>
    </div>`;
  });
  return rows;
}

async function showTechnicalSignalList() {
  const container = document.getElementById("technical-signals");
  if (!container) return;

  const allSignals = [..._allRunning, ..._allClosed];
  let techSignals = allSignals.filter((s) => s.signalType === "TECHNICAL");

  if (!techSignals.length) {
    container.innerHTML = `<div class="loading-state"><p>Belum ada data sinyal teknikal.</p></div>`;
    technicalListRendered = false;
    return;
  }

  const today = getTodayWIB();

  if (currentTechnicalFilter === "today") {
    techSignals = techSignals.filter(
      (s) => s.signalDate && s.signalDate.startsWith(today),
    );
  } else if (currentTechnicalFilter === "running") {
    techSignals = techSignals.filter(
      (s) => s.status === "RUNNING" || s.status === "TRAILING",
    );
  } else if (currentTechnicalFilter === "waiting") {
    techSignals = techSignals.filter((s) => s.status === "WAITING_ENTRY");
  }

  if (!techSignals.length) {
    const msg =
      currentTechnicalFilter === "today"
        ? "Tidak ada sinyal teknikal hari ini."
        : currentTechnicalFilter === "running"
          ? "Tidak ada posisi teknikal running."
          : "Tidak ada sinyal teknikal waiting.";
    container.innerHTML = `<div class="loading-state"><p>${msg}</p></div>`;
    technicalListRendered = false;
    return;
  }

  const symbols = [...new Set(techSignals.map((s) => s.stockCode))];
  const [priceResults, infoResults] = await Promise.all([
    Promise.all(symbols.map((sym) => fetchStockPrice(sym))),
    Promise.all(symbols.map((sym) => fetchStockInfo(sym))),
  ]);
  const priceMap = {};
  const infoMap = {};
  symbols.forEach((sym, idx) => {
    priceMap[sym] = priceResults[idx];
    infoMap[sym] = infoResults[idx];
  });

  let totalGainPct = 0;
  let totalRunningCount = 0;

  techSignals.forEach((s) => {
    let gainPct = 0;
    if (s.status === "TP" || s.status === "SL" || s.status === "STOP LOSS") {
      gainPct = s.returnPercent || 0;
      if (gainPct !== 0) {
        totalGainPct += gainPct;
        totalRunningCount++;
      }
    } else if (
      (s.status === "RUNNING" || s.status === "TRAILING") &&
      s.entryPrice &&
      priceMap[s.stockCode]
    ) {
      const currentPrice = priceMap[s.stockCode];
      gainPct = ((currentPrice - s.entryPrice) / s.entryPrice) * 100;
      if (gainPct !== 0) {
        totalGainPct += gainPct;
        totalRunningCount++;
      }
    }
  });

  const avgGainPct =
    totalRunningCount > 0 ? totalGainPct / totalRunningCount : 0;
  let totalGainStr =
    totalRunningCount > 0
      ? (avgGainPct >= 0 ? "+" : "") + avgGainPct.toFixed(2) + "%"
      : "—";
  let totalGainColor = avgGainPct >= 0 ? "#10b981" : "#ef4444";
  let arrowIconTotal = "";
  if (avgGainPct > 0.01) {
    arrowIconTotal = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
  } else if (avgGainPct < -0.01) {
    arrowIconTotal = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
  }

  let html = `
    <div class="sig-list-header" style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); margin-bottom:0.5rem;">
      <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary);">
        TECHNICAL TRACKER LIST
        <span style="font-weight:400; color:var(--text-secondary); opacity:0.6;">(${techSignals.length})</span>
      </span>
      <span style="font-weight:600; font-size:0.9rem; color:var(--text-primary);">
        GAIN: ${arrowIconTotal} <span id="techListGain" style="font-weight:600; color:${totalGainColor};">${totalGainStr}</span>
      </span>
    </div>
    <div class="sig-list">
      ${renderTechnicalRows(techSignals, priceMap, infoMap)}
    </div>
  `;

  container.innerHTML = html;
  technicalListRendered = true;

  container.querySelectorAll(".sig-list-row").forEach((row) => {
    row.addEventListener("click", function () {
      const stock = this.dataset.stock;
      const date = this.dataset.date;
      const matchSig = allSignals.find(
        (s) => s.stockCode === stock && s.signalDate === date,
      );
      if (matchSig) {
        isDetailView = true;
        renderTechnicalSignalDetail(matchSig, container);
      }
    });
  });

  container._techPriceMap = priceMap;
}

async function updateTechnicalSignalList() {
  if (isDetailView) return;
  const container = document.getElementById("technical-signals");
  if (!container) return;

  await fetchSignals(false);

  const allSignals = [..._allRunning, ..._allClosed];
  let techSignals = allSignals.filter((s) => s.signalType === "TECHNICAL");
  if (!techSignals.length) return;

  const today = getTodayWIB();
  if (currentTechnicalFilter === "today") {
    techSignals = techSignals.filter(
      (s) => s.signalDate && s.signalDate.startsWith(today),
    );
  } else if (currentTechnicalFilter === "running") {
    techSignals = techSignals.filter(
      (s) => s.status === "RUNNING" || s.status === "TRAILING",
    );
  } else if (currentTechnicalFilter === "waiting") {
    techSignals = techSignals.filter((s) => s.status === "WAITING_ENTRY");
  }

  if (!techSignals.length) return;

  const symbols = [...new Set(techSignals.map((s) => s.stockCode))];
  const priceResults = await Promise.all(
    symbols.map((sym) => fetchStockPrice(sym)),
  );
  const priceMap = {};
  symbols.forEach((sym, idx) => {
    priceMap[sym] = priceResults[idx];
  });

  const rows = container.querySelectorAll(".sig-list-row");
  rows.forEach((row) => {
    const stock = row.dataset.stock;
    const date = row.dataset.date;
    if (!stock || !date) return;
    const signal = techSignals.find(
      (s) => s.stockCode === stock && s.signalDate === date,
    );
    if (!signal) return;
    const price = priceMap[stock];
    const priceEl = row.querySelector(".stock-price");
    const gainEl = row.querySelector(".sig-right span:last-child");
    if (!priceEl) return;

    if (
      signal.status !== "TP" &&
      signal.status !== "SL" &&
      signal.status !== "STOP LOSS"
    ) {
      if (price != null) {
        let arrowPrice = "";
        const gainAbs = price - signal.entryPrice;
        const gainPct = (gainAbs / signal.entryPrice) * 100;
        const absGain = Math.abs(gainAbs).toFixed(0);
        const absPct = Math.abs(gainPct).toFixed(2);
        let gainStr = "";
        let gainColor = "";
        if (Math.abs(gainAbs) < 0.01) {
          gainStr = `0 (0.00%)`;
          gainColor = "var(--text-secondary)";
          arrowPrice = "";
        } else if (gainAbs > 0) {
          arrowPrice = `<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.6rem; margin-right:0.1rem;"></i>`;
          gainStr = `+${absGain} (+${absPct}%)`;
          gainColor = "#10b981";
        } else {
          arrowPrice = `<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.6rem; margin-right:0.1rem;"></i>`;
          gainStr = `-${absGain} (-${absPct}%)`;
          gainColor = "#ef4444";
        }
        priceEl.innerHTML = `${arrowPrice} ${fmtPriceNoRp(price)}`;
        if (gainEl) {
          gainEl.style.color = gainColor;
          gainEl.innerHTML = gainStr;
        }
      } else {
        priceEl.textContent = "—";
        if (gainEl) {
          gainEl.textContent = "—";
          gainEl.style.color = "var(--text-secondary)";
        }
      }
    }
  });

  const gainSpan = document.getElementById("techListGain");
  if (gainSpan) {
    let totalGainPct = 0;
    let totalRunningCount = 0;

    techSignals.forEach((s) => {
      let gainPct = 0;
      if (s.status === "TP" || s.status === "SL" || s.status === "STOP LOSS") {
        gainPct = s.returnPercent || 0;
        if (gainPct !== 0) {
          totalGainPct += gainPct;
          totalRunningCount++;
        }
      } else if (
        (s.status === "RUNNING" || s.status === "TRAILING") &&
        s.entryPrice &&
        priceMap[s.stockCode]
      ) {
        const currentPrice = priceMap[s.stockCode];
        gainPct = ((currentPrice - s.entryPrice) / s.entryPrice) * 100;
        if (gainPct !== 0) {
          totalGainPct += gainPct;
          totalRunningCount++;
        }
      }
    });

    const avgGainPct =
      totalRunningCount > 0 ? totalGainPct / totalRunningCount : 0;
    let totalGainStr =
      totalRunningCount > 0
        ? (avgGainPct >= 0 ? "+" : "") + avgGainPct.toFixed(2) + "%"
        : "—";
    let totalGainColor = avgGainPct >= 0 ? "#10b981" : "#ef4444";
    let arrowIconTotal = "";
    if (avgGainPct > 0.01) {
      arrowIconTotal = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
    } else if (avgGainPct < -0.01) {
      arrowIconTotal = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
    }

    const header = gainSpan.closest(".sig-list-header");
    if (header) {
      const leftSpan = header.querySelector("span:first-child");
      const rightSpan = header.querySelector("span:last-child");
      if (rightSpan) {
        rightSpan.innerHTML = `GAIN: ${arrowIconTotal} <span id="techListGain" style="font-weight:600; color:${totalGainColor};">${totalGainStr}</span>`;
      }
    }
  }
}

function renderTechnicalSignalDetail(s, container) {
  const isExpired =
    s.status === "EXPIRED" ||
    s.status === "EXPRIED" ||
    s.expired === true ||
    s.expired === "true" ||
    (s.status === "CLOSED" &&
      (s.returnPercent === 0 || s.returnPercent === null)) ||
    (s.status === "SL" && (s.returnPercent || 0) < -5) ||
    (s.status === "WAITING_ENTRY" &&
      s.signalDate &&
      new Date(s.signalDate) <
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) ||
    (s.closeDate &&
      new Date(s.closeDate) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  let currentPrice = localPrices.get(s.stockCode) || null;
  let gainAbs = 0,
    gainPct = 0,
    gainStr = "—",
    gainColor = "var(--text-secondary)";
  let arrowIcon = "";
  const isRunning = s.status === "RUNNING" || s.status === "TRAILING";
  const isClosed = s.status === "TP" || s.status === "SL";

  if (isRunning && s.entryPrice && currentPrice) {
    gainAbs = currentPrice - s.entryPrice;
    gainPct = (gainAbs / s.entryPrice) * 100;
    const absGain = Math.abs(gainAbs).toFixed(0);
    const absPct = Math.abs(gainPct).toFixed(2);
    if (Math.abs(gainAbs) < 0.01) {
      gainStr = "0 (0.00%)";
      gainColor = "var(--text-secondary)";
    } else if (gainAbs > 0) {
      arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
      gainColor = "#10b981";
      gainStr = `${arrowIcon} ${absGain} (+${absPct}%)`;
    } else {
      arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
      gainColor = "#ef4444";
      gainStr = `${arrowIcon} ${absGain} (-${absPct}%)`;
    }
  } else if (isClosed && s.returnPercent != null) {
    const ret = s.returnPercent;
    const sign = ret >= 0 ? "+" : "";
    gainStr = `${sign}${ret.toFixed(2)}%`;
    gainColor = ret >= 0 ? "#10b981" : "#ef4444";
    if (ret > 0.01)
      arrowIcon = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i>`;
    else if (ret < -0.01)
      arrowIcon = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i>`;
  }

  let displayPrice = "—";
  let priceArrow = "";
  if (isClosed && s.exitPrice) {
    displayPrice = Number(s.exitPrice).toLocaleString("id-ID");
    const ret = s.returnPercent || 0;
    if (ret > 0)
      priceArrow = `<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.8rem; margin-right:0.2rem;"></i>`;
    else if (ret < 0)
      priceArrow = `<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.8rem; margin-right:0.2rem;"></i>`;
  } else if (isRunning && currentPrice != null) {
    displayPrice = Number(currentPrice).toLocaleString("id-ID");
    if (gainAbs > 0)
      priceArrow = `<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.8rem; margin-right:0.2rem;"></i>`;
    else if (gainAbs < 0)
      priceArrow = `<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.8rem; margin-right:0.2rem;"></i>`;
  } else {
    displayPrice = s.entryPrice
      ? Number(s.entryPrice).toLocaleString("id-ID")
      : "—";
  }

  let statusStamp = "";
  if (s.status === "TP")
    statusStamp = `<span class="sig-status-stamp" style="width:36px; height:36px; display:inline-block; flex-shrink:0;">${hitSvg}</span>`;
  else if (s.status === "SL" || s.status === "STOP LOSS")
    statusStamp = `<span class="sig-status-stamp" style="width:36px; height:36px; display:inline-block; flex-shrink:0;">${missedSvg}</span>`;

  const logoUrl = `https://assets.stockbit.com/logos/companies/${s.stockCode}.png`;
  const parqetUrl = `https://assets.parqet.com/logos/symbol/${s.stockCode}.png`;
  const bgColor = getColorFromCode(s.stockCode);
  const logoHtml = `<span class="detail-logo-text"><img src="${logoUrl}" alt="${s.stockCode}" style="width:50px; height:64px; object-fit:contain; border:none; background:transparent; display:block;" onerror="this.onerror=null; this.src='${parqetUrl}'; this.onerror=function(){ this.style.display='none'; this.nextElementSibling.style.display='inline-block'; }"><span style="display:none; width:64px; height:64px; line-height:64px; text-align:center; background:${bgColor}; color:#fff; font-size:1.1rem; font-weight:700; font-family:'JetBrains Mono',monospace;">${s.stockCode.substring(0, 2)}</span></span>`;

  let longName = s.stockCode;
  if (infoCache.has(s.stockCode)) {
    longName = infoCache.get(s.stockCode).data.longName || s.stockCode;
  }

  const entry = s.entryPrice || 0;
  const sl = s.sl || 0;
  const tp1 = s.tp1 || 0;
  const tp2 = s.tp2 || s.target2Low || 0;

  let slPercent = 0,
    tp1Percent = 0,
    tp2Percent = 0;
  if (entry > 0 && sl > 0) slPercent = ((sl - entry) / entry) * 100;
  if (entry > 0 && tp1 > 0) tp1Percent = ((tp1 - entry) / entry) * 100;
  if (entry > 0 && tp2 > 0) tp2Percent = ((tp2 - entry) / entry) * 100;

  const slLabel =
    slPercent < 0 ? `${slPercent.toFixed(1)}%` : `-${slPercent.toFixed(1)}%`;
  const tp1Label =
    tp1Percent > 0 ? `+${tp1Percent.toFixed(1)}%` : `${tp1Percent.toFixed(1)}%`;
  const tp2Label =
    tp2Percent > 0 ? `+${tp2Percent.toFixed(1)}%` : `${tp2Percent.toFixed(1)}%`;

  const step1Active = !isExpired;
  const step2Active =
    !isExpired &&
    (s.breakEven === true || s.status === "TRAILING" || s.status === "TP");
  const step3Active =
    !isExpired && (s.status === "TRAILING" || s.status === "TP");

  let step1State = "default",
    step2State = "default",
    step3State = "default";
  if (!isExpired) {
    if (s.status === "SL" && !s.breakEven) step1State = "failed";
    if (s.status === "SL" && s.breakEven) step2State = "warning";
    else if (s.status === "TP") step2State = "success";
    if (s.status === "SL" && s.breakEven) step3State = "warning";
    else if (s.status === "TP") step3State = "success";
  }

  function stepCircle(active, label, desc, icon, state = "default") {
    let bg, border, color, shadow;
    if (isExpired) {
      bg = "#3a3a3a";
      border = "rgba(255,255,255,0.08)";
      color = "#71717a";
      shadow = "0 0 0 4px rgba(0,0,0,0.3)";
    } else if (state === "failed") {
      bg = "#ef4444";
      border = "#ef4444";
      color = "#fff";
      shadow = "0 0 0 4px rgba(239,68,68,0.2)";
    } else if (state === "warning") {
      bg = "#f59e0b";
      border = "#f59e0b";
      color = "#fff";
      shadow = "0 0 0 4px rgba(245,158,11,0.2)";
    } else if (state === "success" || active) {
      bg = "#10b981";
      border = "#10b981";
      color = "#fff";
      shadow = "0 0 0 4px rgba(16,185,129,0.2)";
    } else {
      bg = "#2a2a2a";
      border = "rgba(255,255,255,0.05)";
      color = "var(--text-secondary)";
      shadow = "0 0 0 4px #121212";
    }
    let descColor = "var(--text-secondary)";
    if (isExpired) descColor = "#71717a";
    else if (state === "failed") descColor = "#ef4444";
    else if (state === "warning") descColor = "#f59e0b";
    else if (state === "success" || active) descColor = "#10b981";

    return `
      <div style="flex:1; text-align:center; z-index:2; position:relative;">
        <div style="width:34px; height:34px; background:${bg}; border:2px solid ${border}; color:${color}; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto; font-size:0.8rem; font-weight:700; box-shadow: ${shadow}; transition:all 0.3s ease;">
          ${icon}
        </div>
        <div style="font-size:0.7rem; font-weight:600; color:${active || state !== "default" ? "var(--text-primary)" : "var(--text-secondary)"}; margin-top:0.4rem;">${label}</div>
        <div style="font-size:0.5rem; color:${descColor}; margin-top:0.1rem; opacity:0.8;">${desc}</div>
      </div>
    `;
  }

  let progressWidth = "0%";
  let progressGradient = "linear-gradient(90deg, #3a3a3a, #3a3a3a)";

  if (isExpired) {
    progressWidth = "100%";
    progressGradient = "linear-gradient(90deg, #3a3a3a, #4a4a4a)";
  } else if (step3Active && step3State !== "warning") {
    progressWidth = "100%";
    progressGradient = "linear-gradient(90deg, #10b981, #34d399)";
  } else if (step2Active) {
    progressWidth = "50%";
    progressGradient = "linear-gradient(90deg, #10b981, #34d399)";
  } else if (step1State === "failed") {
    progressWidth = "10%";
    progressGradient = "linear-gradient(90deg, #ef4444, #f87171)";
  }

  const targetRanges = `
    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:0.7rem; color:var(--text-secondary); text-transform:uppercase; margin-bottom:0.4rem; font-weight:600; display:flex; align-items:center; gap:0.5rem;">
        <i class="fas fa-bullseye" style="color:#10b981; font-size:0.9rem;"></i> 
        Target Profit Range Objectives
        ${isExpired ? `<span style="font-size:0.55rem; color:#71717a; background:rgba(113,113,122,0.15); padding:0.1rem 0.5rem; border-radius:10px; margin-left:auto;"><i class="fa-regular fa-circle-xmark" style="margin-right:0.2rem;"></i>EXPIRED</span>` : ""}
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem;">
        <div class="tech-target-card" style="background:rgba(0,0,0,0.25); padding:0.5rem 0.6rem; border-radius:8px; border-left:3px solid #10b981;">
          <div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.15rem;">
            <span class="target-icon" style="font-size:0.7rem; color:#10b981;"><i class="fa-solid fa-arrow-up-right-dots"></i></span>
            <span style="font-size:0.6rem; color:var(--text-secondary); font-weight:500;">Target Area 1</span>
            <span style="font-size:0.5rem; color:#10b981; background:rgba(16,185,129,0.1); padding:0.05rem 0.4rem; border-radius:8px; margin-left:auto;"><i class="fa-regular fa-flag"></i> PRIORITY</span>
          </div>
          <div style="font-family:'JetBrains Mono'; font-weight:700; font-size:0.95rem; color:#10b981; display:flex; align-items:center; gap:0.3rem;">
            <i class="fa-solid fa-arrow-right" style="font-size:0.6rem; opacity:0.5;"></i>
            ${s.target1Low || s.tp1 || 0} – ${s.target1High || 0}
            <span style="font-size:0.5rem; color:var(--text-secondary); opacity:0.5; margin-left:auto;"><i class="fa-regular fa-clock"></i> TP 1</span>
          </div>
        </div>
        <div class="tech-target-card" style="background:rgba(0,0,0,0.25); padding:0.5rem 0.6rem; border-radius:8px; border-left:3px solid #f59e0b;">
          <div style="display:flex; align-items:center; gap:0.3rem; margin-bottom:0.15rem;">
            <span class="target-icon" style="font-size:0.7rem; color:#f59e0b;"><i class="fa-solid fa-trophy"></i></span>
            <span style="font-size:0.6rem; color:var(--text-secondary); font-weight:500;">Target Area 2</span>
            <span style="font-size:0.5rem; color:#f59e0b; background:rgba(245,158,11,0.1); padding:0.05rem 0.4rem; border-radius:8px; margin-left:auto;"><i class="fa-regular fa-star"></i> EXTENDED</span>
          </div>
          <div style="font-family:'JetBrains Mono'; font-weight:700; font-size:0.95rem; color:#f59e0b; display:flex; align-items:center; gap:0.3rem;">
            <i class="fa-solid fa-arrow-right" style="font-size:0.6rem; opacity:0.5;"></i>
            ${s.target2Low || s.tp2 || 0} – ${s.target2High || 0}
            <span style="font-size:0.5rem; color:var(--text-secondary); opacity:0.5; margin-left:auto;"><i class="fa-regular fa-clock"></i> TP 2</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const buyAreaDisplay = `
    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem;">
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:0.65rem 0.6rem;">
          <div style="font-size:0.6rem; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.3px; display:flex; align-items:center; gap:0.3rem;">
            <i class="fa-solid fa-cart-shopping" style="color:#3b82f6;"></i> Buy Area Reference
          </div>
          <div style="font-family:'JetBrains Mono'; font-size:1.1rem; font-weight:700; color:#3b82f6; margin-top:0.15rem; display:flex; align-items:center; gap:0.3rem;">
            <i class="fa-solid fa-tag" style="font-size:0.6rem; opacity:0.5;"></i>
            ${s.buyAreaLow} – ${s.buyAreaHigh}
          </div>
          <div style="font-size:0.5rem; color:${isExpired ? "#71717a" : "var(--text-secondary)"}; margin-top:0.1rem; display:flex; align-items:center; gap:0; opacity:0.7;">
            <i class="fa-solid fa-arrow-trend-up" style="color:#71717a; font-size:0.5rem; margin-right:4px;"></i>
            ${s.buyType || "BREAKOUT SETUP"}
          </div>
        </div>
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:0.65rem 0.6rem;">
          <div style="font-size:0.6rem; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.3px; display:flex; align-items:center; gap:0.3rem;">
            <i class="fa-solid fa-shield" style="color:#ef4444;"></i> Stop Loss Baseline
          </div>
          <div style="font-family:'JetBrains Mono'; font-size:1.1rem; font-weight:700; color:#ef4444; margin-top:0.15rem; display:flex; align-items:center; gap:0.3rem;">
            <i class="fa-solid fa-arrow-down" style="font-size:0.6rem; opacity:0.5;"></i>
            -${s.stopLossPercent || 5}%
          </div>
          <div style="font-size:0.5rem; color:var(--text-secondary); opacity:0.5; margin-top:0.1rem;">
            <i class="fa-regular fa-circle"></i> ${s.sl ? fmtPrice(s.sl) : "Calculated at entry"}
          </div>
        </div>
      </div>
    </div>
  `;

  let statusBadgeHtml = "";
  if (isExpired) {
    statusBadgeHtml = `<span style="font-size:0.55rem; background:rgba(113,113,122,0.2); color:#71717a; padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto; font-weight:600;"><i class="fa-regular fa-circle-xmark" style="margin-right:0.2rem;"></i>EXPIRED</span>`;
  } else if (s.status === "RUNNING") {
    statusBadgeHtml = `<span style="font-size:0.55rem; background:rgba(16,185,129,0.15); color:#10b981; padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">Active</span>`;
  } else if (s.status === "TRAILING") {
    statusBadgeHtml = `<span style="font-size:0.55rem; background:rgba(245,158,11,0.15); color:#f59e0b; padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">Trailing</span>`;
  } else if (s.status === "WAITING_ENTRY") {
    statusBadgeHtml = `<span style="font-size:0.55rem; background:rgba(59,130,246,0.15); color:#3b82f6; padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">Waiting</span>`;
  } else {
    statusBadgeHtml = `<span style="font-size:0.55rem; background:rgba(255,255,255,0.05); color:var(--text-secondary); padding:0.1rem 0.5rem; border-radius:12px; margin-left:auto;">${s.status}</span>`;
  }

  const strategyFlow = `
    <div style="background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:0.65rem 0.75rem; margin-top:0.5rem;">
      <div style="display:flex; align-items:center; gap:0.4rem; margin-bottom:0.1rem;">
        <i class="fa-solid fa-layer-group" style="color:${isExpired ? "#71717a" : "var(--text-primary)"}; font-size:1rem;"></i>
        <span style="font-weight:600; font-size:0.85rem; color:${isExpired ? "#71717a" : "var(--text-primary)"}; letter-spacing:0.3px;">
          ${isExpired ? "Expired Strategy Flow" : "Technical Strategy Flow"}
        </span>
        ${statusBadgeHtml}
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; margin:0.8rem 0; position:relative; padding:0 0.5rem;">
        <div style="position:absolute; top:17px; left:10%; right:10%; height:2px; background:rgba(255,255,255,0.06); z-index:1;">
          <div style="height:100%; width:${progressWidth}; background:${progressGradient}; border-radius:2px; transition:width 0.8s ease;"></div>
        </div>
        ${stepCircle(step1Active, "Entry", `SL ${slLabel}`, "1", step1State)}
        ${stepCircle(step2Active, "TP 1", `${tp1Label}`, "2", step2State)}
        ${stepCircle(step3Active, "TP 2", `${tp2Label}`, "3", step3State)}
      </div>
      <div style="display:flex; justify-content:center; gap:0.5rem; font-size:0.55rem; color:var(--text-secondary); margin-top:0.2rem; ${isExpired ? "opacity:0.4;" : ""}">
        <span style="display:flex; align-items:center; gap:0.2rem;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981;"></span> Active</span>
        <span style="display:flex; align-items:center; gap:0.2rem;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444;"></span> Stop Loss</span>
        <span style="display:flex; align-items:center; gap:0.2rem;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#f59e0b;"></span> Trailing Hit</span>
        ${isExpired ? `<span style="display:flex; align-items:center; gap:0.2rem; color:#71717a;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#3a3a3a;"></span> Expired</span>` : ""}
      </div>
      ${
        isExpired
          ? `<div style="text-align:center; margin-top:0.4rem; padding:0.3rem 0.5rem; background:rgba(113,113,122,0.08); border-radius:6px; font-size:0.6rem; color:#71717a; border:1px dashed rgba(113,113,122,0.15);">
          <i class="fa-regular fa-clock" style="margin-right:0.3rem;"></i> Signal telah kedaluwarsa — Tidak ada alur aktif
        </div>`
          : `<div style="text-align:center; margin-top:0.4rem; font-size:0.55rem; color:var(--text-secondary); opacity:0.4;">
          <i class="fa-regular fa-circle-check" style="margin-right:0.2rem; color:#10b981;"></i> Alur strategi berjalan sesuai rencana
        </div>`
      }
    </div>
  `;

  const t1Low = Number(s.target1Low || s.tp1 || 0);
  const t1High = Number(s.target1High || 0);
  const t2Low = Number(s.target2Low || s.tp2 || 0);
  const t2High = Number(s.target2High || 0);

  let checkPrice =
    isClosed && s.exitPrice ? Number(s.exitPrice) : Number(currentPrice || 0);

  let dynamicTpVal = t1Low;
  if (checkPrice >= t1Low && t1High > 0) {
    dynamicTpVal = t1High;
  }
  if (checkPrice >= t1High && t2Low > 0) {
    dynamicTpVal = t2Low;
  }
  if (checkPrice >= t2Low && t2High > 0) {
    dynamicTpVal = t2High;
  }

  let dynamicTpPercent = 0;
  if (entry > 0 && dynamicTpVal > 0) {
    dynamicTpPercent = ((dynamicTpVal - entry) / entry) * 100;
  }
  const dynamicTpLabel =
    dynamicTpPercent > 0
      ? `+${dynamicTpPercent.toFixed(1)}%`
      : `${dynamicTpPercent.toFixed(1)}%`;

  const priceLadder = `
    <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div class="price-ladder" style="display:flex; justify-content:space-around; align-items:center; gap:0.5rem; padding:0.2rem 0; margin:0; flex-wrap:wrap;">
        <div class="price-item" style="display:flex; flex-direction:column; align-items:center; gap:0.2rem; flex:1; min-width:70px; padding:0.3rem; background:rgba(0,0,0,0.15); border-radius:8px;">
          <span class="label" style="font-size:0.55rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.2rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Entry
          </span>
          <span class="value" style="font-family:'JetBrains Mono'; font-weight:600; font-size:0.85rem; color:var(--text-primary);">${s.entryPrice ? fmtPrice(s.entryPrice) : "—"}</span>
          <span class="change neutral" style="font-size:0.55rem; color:var(--text-secondary);">—</span>
        </div>
        
        <!-- PERBAIKAN: TP1 & TP2 dihapus, digabung menjadi TAKE PROFIT dinamis dengan EKG/Pulse SVG Icon -->
        <div class="price-item" style="display:flex; flex-direction:column; align-items:center; gap:0.2rem; flex:1; min-width:70px; padding:0.3rem; background:rgba(0,0,0,0.15); border-radius:8px;">
          <span class="label" style="font-size:0.55rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.2rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" style="width:12px;height:12px;margin-right:0.2rem;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> TAKE PROFIT
          </span>
          <span class="value" style="font-family:'JetBrains Mono'; font-weight:600; font-size:0.85rem; color:#10b981;">${dynamicTpVal ? fmtPrice(dynamicTpVal) : "—"}</span>
          <span class="change positive" style="font-size:0.55rem; color:#10b981;">${dynamicTpLabel}</span>
        </div>
        
        <div class="price-item" style="display:flex; flex-direction:column; align-items:center; gap:0.2rem; flex:1; min-width:70px; padding:0.3rem; background:rgba(0,0,0,0.15); border-radius:8px;">
          <span class="label" style="font-size:0.55rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.2rem;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:0.7rem; color:#ef4444;"></i> STOP LOSS
          </span>
          <span class="value" style="font-family:'JetBrains Mono'; font-weight:600; font-size:0.85rem; color:#ef4444;">${s.sl ? fmtPrice(s.sl) : "—"}</span>
          <span class="change negative" style="font-size:0.55rem; color:#ef4444;">${slLabel}</span>
        </div>
      </div>
    </div>
  `;

  const strategyDetail = `
    <div style="background:rgba(255,255,255,0.02); border-radius:6px; padding:0.5rem 0.6rem; margin-top:0.5rem; border:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; gap:0.35rem; font-size:0.65rem; color:var(--text-secondary); line-height:1.3;">
      <div style="display:flex; align-items:start;">
        <i class="fa-regular fa-circle" style="color:#8b5cf6; font-size:0.5rem; margin-right:0.4rem; margin-top:0.15rem;"></i>
        <span>Entry dilakukan saat harga berada di <strong>Buy Area ${s.buyAreaLow} – ${s.buyAreaHigh}</strong>.</span>
      </div>
      <div style="display:flex; align-items:start;">
        <i class="fa-regular fa-circle-check" style="color:#10b981; font-size:0.5rem; margin-right:0.4rem; margin-top:0.15rem;"></i>
        <span>Target pertama <strong>TP 1</strong> di area ${s.target1Low || s.tp1 || 0} – ${s.target1High || 0}.</span>
      </div>
      <div style="display:flex; align-items:start;">
        <i class="fa-regular fa-circle-check" style="color:#f59e0b; font-size:0.5rem; margin-right:0.4rem; margin-top:0.15rem;"></i>
        <span>Target kedua <strong>TP 2</strong> di area ${s.target2Low || s.tp2 || 0} – ${s.target2High || 0}.</span>
      </div>
      <div style="display:flex; align-items:start;">
        <i class="fa-solid fa-triangle-exclamation" style="color:#ef4444; font-size:0.5rem; margin-right:0.4rem; margin-top:0.15rem;"></i>
        <span>Stop Loss <strong>-${s.stopLossPercent || 5}%</strong> dari entry untuk proteksi downside.</span>
      </div>
    </div>
  `;

  const setupText = s.buyType || "BUY ON SUPPORT (RETRACEMENT)";

  const html = `
    <div class="pro-detail-container">
      <button class="sig-back-btn" id="techBackBtn" style="margin-bottom:0.5rem;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg> Kembali
      </button>

      <div style="background:rgba(255,255,255,0.02); border-radius:10px; border:1px solid rgba(255,255,255,0.08); overflow:hidden;">

        <!-- HEADER -->
        <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="display:grid; grid-template-columns: 1fr auto; gap:0.2rem 0.5rem; align-items:center;">
            <div style="grid-column:1; grid-row:1; display:flex; flex-direction:column; gap:0.1rem;">
              <span style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:1.2rem; color:var(--text-primary);">${escapeHtml(s.stockCode)}</span>
              <span style="font-size:0.8rem; color:var(--text-secondary); opacity:0.7;">${escapeHtml(longName)}</span>
            </div>
            <div style="grid-column:1; grid-row:2; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <span style="font-family:'JetBrains Mono'; font-weight:600; font-size:1rem; color:var(--text-primary); display:flex; align-items:center;">
                ${priceArrow} ${displayPrice}
              </span>
              <span style="font-family:'JetBrains Mono'; font-size:0.75rem; color:${gainColor}; font-weight:600; display:flex; align-items:center; gap:0.2rem;">${gainStr}</span>
              ${statusStamp}
            </div>
            <div style="grid-column:2; grid-row:1 / 3; display:flex; align-items:center; justify-content:center;">${logoHtml}</div>
            <div style="grid-column:1 / 3; grid-row:3; margin-top:0.1rem; display:flex; flex-wrap:wrap; align-items:center; gap:0.2rem;">
              <span class="emit-tag">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 3px;">
    <!-- 4 Batang Grafik -->
    <line x1="5" y1="16" x2="5" y2="20" />
    <line x1="10" y1="11" x2="10" y2="20" />
    <line x1="15" y1="14" x2="15" y2="20" />
    <line x1="20" y1="12" x2="20" y2="20" />
    <!-- Garis Tren -->
    <path d="M 4 13 L 10 6 L 15 10 L 21 4" />
  </svg>Technical
</span>
          
              <span class="emit-tag">
                <i class="fa-solid fa-arrow-trend-up" style="color:#71717a; font-size:0.6rem; margin-right:5px;"></i>${setupText}
              </span>
              ${s.status === "WAITING_ENTRY" ? `<span class="emit-tag"><i class="fa-regular fa-hourglass-half" style="margin-right:3px; font-size:0.65rem;"></i>Waiting Entry</span>` : ""}
              ${isExpired ? `<span class="emit-tag" style="color:#71717a; border-color:#71717a;"><i class="fa-regular fa-circle-xmark" style="margin-right:3px; font-size:0.65rem;"></i>EXPIRED</span>` : ""}
            </div>
            <div style="grid-column:1 / 3; grid-row:4; font-size:0.7rem; color:var(--text-secondary); opacity:0.6; margin-top:0.1rem;">${s.signalDate ? formatFullDateTime(s.signalDate) : ""}</div>
          </div>
        </div>

        ${priceLadder}
        ${buyAreaDisplay}
        ${targetRanges}

        <!-- STRATEGY FLOW -->
        <div style="padding:0.5rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);">
          ${strategyFlow}
          ${strategyDetail}
        </div>

        <!-- FOOTER -->
        <div style="padding:0.5rem 0.75rem; text-align:center; font-size:0.55rem; color:var(--text-secondary); opacity:0.4; border-top:1px solid rgba(255,255,255,0.04);">
          <i class="fa-solid fa-microchip" style="margin-right:0.2rem;"></i> Technical Strategy
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  const backBtn = container.querySelector("#techBackBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      isDetailView = false;
      showTechnicalSignalList();
    });
  }
  // FIX: scroll ke atas setelah detail teknikal dirender
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function showSignalDetailByStock(stockCode, signalDate) {
  const allSignals = getSortedSignals();
  const idx = allSignals.findIndex(
    (s) => s.stockCode === stockCode && s.signalDate === signalDate,
  );
  if (idx !== -1) {
    await showSignalDetail(idx);
  } else {
    console.warn("Signal not found:", stockCode, signalDate);
  }
}

function formatFullDateTime(dateStr) {
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

async function showSignalDetail(index) {
  isDetailView = true;
  currentDetailIndex = index;
  const allSignals = getSortedSignals();
  const s = allSignals[index];
  if (!s) return;

  const container = document.getElementById("signals");

  if (s.signalType === "BSJP") {
    renderBsjpDetail(s, container, () => showSignalList());
    // FIX: scroll ke atas setelah BSJP detail
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  let stockInfo = { longName: s.stockCode, logoUrl: null };
  try {
    const info = await fetchStockInfo(s.stockCode);
    if (info) stockInfo = info;
  } catch (e) {}

  let currentPrice = null;
  try {
    currentPrice = await fetchStockPrice(s.stockCode);
  } catch (e) {}

  await renderSignalDetailToContainer(s, container, () => showSignalList());
  // FIX: scroll ke atas setelah detail biasa dirender
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderBrokerFlow(
  topBuyers,
  topSellers,
  sinyalBandar,
  container = document,
) {
  let containerEl = container.querySelector
    ? container.querySelector("#brokerFlowContainer")
    : null;
  if (!containerEl)
    containerEl = document.getElementById("brokerFlowContainer");

  if (!containerEl) {
    console.warn("brokerFlowContainer tidak ditemukan");
    return;
  }

  containerEl.innerHTML = "";

  if (!sinyalBandar || sinyalBandar.trim() === "") {
    containerEl.innerHTML =
      '<div style="text-align:center;padding:0.5rem 0;color:var(--text-secondary);font-size:0.7rem;"><i class="fas fa-database" style="margin-right:0.3rem;"></i> Bandarmology: Data sedang maintenance</div>';
    return;
  }

  const buyers = topBuyers || [];
  const sellers = topSellers || [];

  const normalized = (sinyalBandar || "").toUpperCase().replace(/_/g, " ");
  let bandarSignal = "NEUTRAL";
  let bandarClass = "neutral";

  if (normalized.includes("STRONG BUY")) {
    bandarSignal = "STRONG BUY";
    bandarClass = "strong-buy";
  } else if (normalized.includes("BUY") && !normalized.includes("STRONG")) {
    bandarSignal = "BUY";
    bandarClass = "buy";
  } else if (normalized.includes("STRONG SELL")) {
    bandarSignal = "STRONG SELL";
    bandarClass = "strong-sell";
  } else if (normalized.includes("SELL") && !normalized.includes("STRONG")) {
    bandarSignal = "SELL";
    bandarClass = "sell";
  } else if (normalized.includes("NEUTRAL")) {
    bandarSignal = "NEUTRAL";
    bandarClass = "neutral";
  }

  const topBuy = buyers.slice(0, 5);
  const topSell = sellers.slice(0, 5);
  const maxBuy = topBuy.length ? Math.max(...topBuy.map((b) => b.lot)) : 1;
  const maxSell = topSell.length ? Math.max(...topSell.map((b) => b.lot)) : 1;

  let html = `<div class="broker-flow-grid">`;

  html += `<div class="broker-col"><div class="broker-col-title buy">▲ BUY</div>`;
  if (topBuy.length) {
    topBuy.forEach((b) => {
      const pct = (b.lot / maxBuy) * 100;
      html += `<div class="broker-item buy">
        <span class="code">${b.code}</span>
        <span class="vol">${b.lot.toLocaleString()}L</span>
        <div style="flex:1;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;">
          <div style="width:${Math.min(pct, 100)}%;height:100%;background:var(--success);border-radius:2px;"></div>
        </div>
      </div>`;
    });
  } else {
    html += `<div style="font-size:0.7rem;color:var(--text-secondary);padding:0.5rem 0;">—</div>`;
  }
  html += `</div>`;

  html += `<div class="broker-center">
    <span class="broker-flow-arrow">⟷</span>
    <span class="broker-signal ${bandarClass}">${bandarSignal}</span>
    <span style="font-size:0.6rem;color:var(--text-secondary);">Smart Money</span>
  </div>`;

  html += `<div class="broker-col"><div class="broker-col-title sell">▼ SELL</div>`;
  if (topSell.length) {
    topSell.forEach((b) => {
      const pct = (b.lot / maxSell) * 100;
      html += `<div class="broker-item sell">
        <div style="flex:1;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;">
          <div style="width:${Math.min(pct, 100)}%;height:100%;background:var(--danger);border-radius:2px;margin-left:auto;"></div>
        </div>
        <span class="vol">${b.lot.toLocaleString()}L</span>
        <span class="code">${b.code}</span>
      </div>`;
    });
  } else {
    html += `<div style="font-size:0.7rem;color:var(--text-secondary);text-align:right;padding:0.5rem 0;">—</div>`;
  }
  html += `</div>`;

  html += `</div>`;
  containerEl.innerHTML = html;
}

function renderPatternVisual(patternText, container = document) {
  const containerEl =
    container.getElementById("patternVisualContainer") ||
    container.querySelector("#patternVisualContainer");
  if (!containerEl) return;
  const patterns = {
    "Recovery Uptrend dari Bottom": {
      path: "M10,70 Q40,80 60,40 Q80,10 100,20",
      color: "#10b981",
      label: "Recovery",
    },
    "Breakout Bollinger Upper": {
      path: "M10,60 Q30,50 50,55 Q70,60 90,20 L100,10",
      color: "#f59e0b",
      label: "Breakout",
    },
    "Bullish Momentum Candle": {
      path: "M10,80 Q30,70 50,50 Q70,30 90,20",
      color: "#3b82f6",
      label: "Momentum",
    },
    "Strong Close Near High": {
      path: "M10,70 Q30,50 50,30 Q70,20 90,10 L100,10",
      color: "#8b5cf6",
      label: "Strong",
    },
  };
  let found = null;
  if (patternText) {
    const lower = patternText.toLowerCase();
    for (const [key, val] of Object.entries(patterns)) {
      if (lower.includes(key.toLowerCase())) {
        found = val;
        break;
      }
    }
  }
  if (!found)
    found = {
      path: "M10,70 Q40,80 60,40 Q80,10 100,20",
      color: "#71717a",
      label: "Pattern",
    };

  const svg = `<div class="pattern-visual"><svg viewBox="0 0 120 80" width="100%" height="80">
    <line x1="10" y1="75" x2="110" y2="75" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
    <line x1="10" y1="55" x2="110" y2="55" stroke="rgba(255,255,255,0.03)" stroke-width="0.5" stroke-dasharray="2,2"/>
    <line x1="10" y1="35" x2="110" y2="35" stroke="rgba(255,255,255,0.03)" stroke-width="0.5" stroke-dasharray="2,2"/>
    <line x1="10" y1="15" x2="110" y2="15" stroke="rgba(255,255,255,0.03)" stroke-width="0.5" stroke-dasharray="2,2"/>
    <rect x="20" y="60" width="6" height="15" fill="rgba(239,68,68,0.4)" rx="1"/>
    <line x1="23" y1="55" x2="23" y2="75" stroke="rgba(239,68,68,0.3)" stroke-width="1"/>
    <rect x="35" y="55" width="6" height="20" fill="rgba(239,68,68,0.5)" rx="1"/>
    <line x1="38" y1="48" x2="38" y2="75" stroke="rgba(239,68,68,0.3)" stroke-width="1"/>
    <rect x="50" y="45" width="6" height="25" fill="rgba(16,185,129,0.5)" rx="1"/>
    <line x1="53" y1="40" x2="53" y2="70" stroke="rgba(16,185,129,0.3)" stroke-width="1"/>
    <rect x="65" y="35" width="6" height="30" fill="rgba(16,185,129,0.6)" rx="1"/>
    <line x1="68" y1="30" x2="68" y2="65" stroke="rgba(16,185,129,0.3)" stroke-width="1"/>
    <rect x="80" y="20" width="6" height="40" fill="rgba(16,185,129,0.7)" rx="1"/>
    <line x1="83" y1="15" x2="83" y2="60" stroke="rgba(16,185,129,0.3)" stroke-width="1"/>
    <path d="${found.path}" fill="none" stroke="${found.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4,2"/>
    <path d="${found.path}" fill="none" stroke="${found.color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.15"/>
    <text x="110" y="12" font-size="6" fill="${found.color}" font-weight="700" text-anchor="end" font-family="'JetBrains Mono', monospace">${found.label}</text>
  </svg></div>`;
  containerEl.innerHTML = svg;
}

function renderIndRow(label, displayVal, compareVal, entryVal) {
  let fillClass = "bg-neutral",
    width = "50%";
  if (compareVal && entryVal) {
    if (entryVal > compareVal) {
      fillClass = "bg-success";
      width = "75%";
    } else {
      fillClass = "bg-danger";
      width = "25%";
    }
  }
  return `<div class="pro-ind-row"><span class="pro-ind-label">${label}</span><div class="pro-ind-track"><div class="pro-ind-fill ${fillClass}" style="width:${width};"></div></div><span class="pro-ind-val">${displayVal}</span></div>`;
}

function renderDetailCharts(s, container = document) {
  if (detailCharts.rsi) {
    try {
      detailCharts.rsi.destroy();
    } catch (e) {}
    detailCharts.rsi = null;
  }
  if (detailCharts.macd) {
    try {
      detailCharts.macd.destroy();
    } catch (e) {}
    detailCharts.macd = null;
  }

  Chart.defaults.color = "#71717a";
  Chart.defaults.font.family = "'JetBrains Mono', monospace";

  let ctxRsi = container.querySelector
    ? container.querySelector("#proRsiChart")
    : null;
  if (!ctxRsi) ctxRsi = document.getElementById("proRsiChart");

  if (ctxRsi && s.rsi != null) {
    const rsiVal = s.rsi;
    const color = rsiVal > 70 ? "#ef4444" : rsiVal < 30 ? "#10b981" : "#f59e0b";
    detailCharts.rsi = new Chart(ctxRsi, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: [rsiVal, 100 - rsiVal],
            backgroundColor: [color, "rgba(255,255,255,0.05)"],
            borderWidth: 0,
            cutout: "80%",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        rotation: -90,
        circumference: 180,
        plugins: { tooltip: { enabled: false }, legend: { display: false } },
      },
    });
  }

  let ctxMacd = container.querySelector
    ? container.querySelector("#proMacdChart")
    : null;
  if (!ctxMacd) ctxMacd = document.getElementById("proMacdChart");

  if (ctxMacd && s.macd != null) {
    const hist = s.macd - (s.macdSignal || 0);
    detailCharts.macd = new Chart(ctxMacd, {
      type: "bar",
      data: {
        labels: ["MACD", "Signal", "Hist"],
        datasets: [
          {
            data: [s.macd, s.macdSignal || 0, hist],
            backgroundColor: [
              "#3b82f6",
              "#f59e0b",
              hist > 0 ? "#10b981" : "#ef4444",
            ],
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: "rgba(255,255,255,0.05)" } },
          x: { grid: { display: false } },
        },
      },
    });
  }
}

async function fetchReports() {
  const activeTab = document.querySelector(".view.active")?.id;
  if (activeTab === "daily") {
    if (dailyRendered) {
      await fetchSignals(false);
      await updateDailyContent();
    } else {
      renderDaily();
    }
  } else if (activeTab === "home") {
    await fetchSignals(false);
    updateChartsFromSignals({ running: _allRunning, closed: _allClosed });
  }
}

function selectSignalFilter(filter) {
  isDetailView = false;
  currentDetailIndex = null;
  currentSignalFilter = filter;
  const pageTitle = document.querySelector(".page-title");
  const pageSubtitle = document.querySelector(".page-subtitle");
  if (filter === "today") {
    pageTitle.innerText = "Sinyal Hari Ini";
    pageSubtitle.innerText = "Today's signals (all status)";
    window.location.hash = "#signals-today";
  } else if (filter === "running") {
    pageTitle.innerText = "All Running";
    pageSubtitle.innerText = "Active positions";
    window.location.hash = "#signals-running";
  } else {
    pageTitle.innerText = "Sinyal Aktif";
    pageSubtitle.innerText = "All signals";
    window.location.hash = "#signals";
  }
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById("signals").classList.add("active");
  currentTab = "signals";
  signalListRendered = false;
  fetchSignals(true);

  // BUKA DROPDOWN SIGNALS
  const signalParent = document.getElementById("signalsParent");
  const signalSub = document.getElementById("signalSubMenu");
  if (signalParent && signalSub) {
    signalParent.classList.add("open");
    signalSub.classList.add("open");
    signalSub.style.display = "block";
    const arrow = signalParent.querySelector(".nav-arrow");
    if (arrow) arrow.classList.add("open");
  }
}

async function fetchSignals(showLoadingIndicator = true) {
  if (isDetailView) {
    try {
      const res = await fetch(`${apiBase}/signals`);
      if (!res.ok) throw new Error("Gagal fetch signals");
      const data = await res.json();
      _allRunning = data.running || [];
      _allClosed = data.closed || [];
      updateTotalSignals(_allRunning, _allClosed);
      updateChartsFromSignals({ running: _allRunning, closed: _allClosed });
      checkSignalChanges(_allRunning, _allClosed);
    } catch (err) {
      console.warn("Background fetch error:", err);
    }
    return;
  }

  if (showLoadingIndicator) {
    if (currentTab === "signals") showLoading("signals");
    if (currentTab === "technical-signals") showLoading("technical-signals");
  }

  try {
    const res = await fetch(`${apiBase}/signals`);
    if (!res.ok) throw new Error("Gagal fetch signals");
    const data = await res.json();
    const running = data.running || [];
    const closed = data.closed || [];

    _allRunning = running;
    _allClosed = closed;

    if (currentTab === "signals") {
      if (isDetailView) {
        isDetailView = false;
        currentDetailIndex = null;
        if (window.location.hash.startsWith("#detail-")) {
          history.pushState(null, "", window.location.pathname);
        }
      }
      if (signalListRendered) {
        await updateSignalList();
      } else {
        await showSignalList();
      }
    }

    if (currentTab === "technical-signals") {
      if (isDetailView) {
        isDetailView = false;
      }
      if (technicalListRendered) {
        await updateTechnicalSignalList();
      } else {
        await showTechnicalSignalList();
      }
    }

    updateTotalSignals(running, closed);
    updateChartsFromSignals({ running, closed });
    checkSignalChanges(running, closed);
  } catch (err) {
    console.error(err);

    if (currentTab === "signals") {
      document.getElementById("signals").innerHTML = `
        <div class="loading-state" style="text-align:center; padding:2rem;">
          <div style="display:flex; flex-direction:column; align-items:center; gap:1rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="width:48px; height:48px;">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style="color:#ef4444; font-weight:500; margin:0;">Gagal memuat sinyal biasa</p>
            <button onclick="fetchSignals()" class="retry-btn" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:0.6rem 1.2rem;border-radius:8px;color:var(--text-primary);cursor:pointer;display:flex;align-items:center;gap:0.5rem;transition:0.2s;">
              Coba Lagi
            </button>
          </div>
        </div>
      `;
      signalListRendered = false;
    }

    if (currentTab === "technical-signals") {
      document.getElementById("technical-signals").innerHTML = `
        <div class="loading-state" style="text-align:center; padding:2rem;">
          <div style="display:flex; flex-direction:column; align-items:center; gap:1rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="width:48px; height:48px;">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style="color:#ef4444; font-weight:500; margin:0;">Gagal memuat sinyal teknikal</p>
            <button onclick="fetchSignals()" class="retry-btn" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:0.6rem 1.2rem;border-radius:8px;color:var(--text-primary);cursor:pointer;display:flex;align-items:center;gap:0.5rem;transition:0.2s;">
              Coba Lagi
            </button>
          </div>
        </div>
      `;
      technicalListRendered = false;
    }
  }
}

function updateTotalSignals(running, closed) {
  const total = (running ? running.length : 0) + (closed ? closed.length : 0);
  const el = document.getElementById("totalSignals");
  if (el) el.innerText = total;
}

function checkSignalChanges(running, closed) {
  const prevRunningIds = localStorage.getItem("lastRunningIds") || "";
  const prevClosedIds = localStorage.getItem("lastClosedIds") || "";

  const currentRunningIds = running
    .map((s) => `${s.stockCode}-${s.signalDate}`)
    .sort()
    .join(",");
  const currentClosedIds = closed
    .map((s) => `${s.stockCode}-${s.signalDate}`)
    .sort()
    .join(",");

  const prevRunningArr = prevRunningIds ? prevRunningIds.split(",") : [];
  const currentRunningArr = currentRunningIds
    ? currentRunningIds.split(",")
    : [];

  const newRunning = currentRunningArr.filter(
    (id) => !prevRunningArr.includes(id),
  );

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(new Date());

  if (newRunning.length > 0) {
    const newSignals = running.filter((s) =>
      newRunning.includes(`${s.stockCode}-${s.signalDate}`),
    );

    const groups = { session1: [], session2: [], bsjp: [], other: [] };
    newSignals.forEach((s) => {
      if (s.signalType === "BSJP") {
        groups.bsjp.push(s);
      } else {
        const session = getSessionFromDate(s.signalDate);
        if (session === 1) groups.session1.push(s);
        else if (session === 2) groups.session2.push(s);
        else groups.other.push(s);
      }
    });

    function handleGroupNotification(groupName, signals, cacheKey) {
      if (!signals || signals.length === 0) return;
      const title = `NEW SIGNALS ${groupName}`;
      const body = `${signals.length} sinyal saham baru terdeteksi untuk ${groupName}.`;
      addNotification(title, body, "signal");
    }

    handleGroupNotification("SESI 1", groups.session1, "sesi1");
    handleGroupNotification("SESI 2", groups.session2, "sesi2");
    handleGroupNotification("BSJP", groups.bsjp, "bsjp");
    handleGroupNotification("LAINNYA", groups.other, "other");
  }

  const prevClosedArr = prevClosedIds ? prevClosedIds.split(",") : [];
  const currentClosedArr = currentClosedIds ? currentClosedIds.split(",") : [];
  const newClosed = currentClosedArr.filter(
    (id) => !prevClosedArr.includes(id),
  );

  if (newClosed.length > 0) {
    const closedSignals = closed.filter((s) =>
      newClosed.includes(`${s.stockCode}-${s.signalDate}`),
    );

    closedSignals.forEach((s) => {
      const status = s.status;
      const ret = s.returnPercent || 0;
      const sign = ret >= 0 ? "+" : "";
      const emoji = status === "TP" ? "✅" : "❌";
      addNotification(
        "Signal Closed",
        `${emoji} ${s.stockCode} Selesai ${sign}${ret.toFixed(2)}%`,
        "closed",
      );
    });

    closedSignals.forEach((s) => {
      if (s.status === "TP") {
        const ret = s.returnPercent || 0;
        const sign = ret >= 0 ? "+" : "";
        const entry = s.entryPrice || 0;
        const exit = s.exitPrice || s.tp1 || 0;
        const title = `✅ TP: ${s.stockCode}`;
        const body = `${s.stockCode} Take Profit ${sign}${ret.toFixed(2)}% (Entry ${fmtPriceNoRp(entry)} ➔ Exit ${fmtPriceNoRp(exit)})`;
      }
    });
  }

  localStorage.setItem("lastRunningIds", currentRunningIds);
  localStorage.setItem("lastClosedIds", currentClosedIds);
}

function renderNotificationModal() {
  const oldModal = document.getElementById("notificationModal");
  if (oldModal) oldModal.remove();

  const modal = document.createElement("div");
  modal.id = "notificationModal";
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    animation: fadeIn 0.2s ease;
  `;

  const modalContent = document.createElement("div");
  modalContent.style.cssText = `
    background: rgba(30, 30, 40, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    max-width: 500px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    overflow: hidden;
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  `;
  header.innerHTML = `
    <span style="font-weight:600; font-size:1rem; color:var(--text-primary);">
      <i class="fas fa-bell" style="color:#8b5cf6; margin-right:0.4rem;"></i> Notifications
      <span style="font-size:0.7rem; color:var(--text-secondary); opacity:0.5;">(${notificationHistory.length})</span>
    </span>
    <div style="display:flex; gap:0.5rem;">
      <button id="markAllReadBtn" style="background:rgba(255,255,255,0.05); border:none; color:var(--text-secondary); cursor:pointer; font-size:0.7rem; padding:0.2rem 0.6rem; border-radius:6px; transition:0.2s;">
        <i class="fas fa-check-double"></i> Read All
      </button>
      <button id="clearNotifBtn" style="background:rgba(239,68,68,0.1); border:none; color:#ef4444; cursor:pointer; font-size:0.7rem; padding:0.2rem 0.6rem; border-radius:6px; transition:0.2s;">
        <i class="fas fa-trash"></i> Clear
      </button>
      <button id="closeNotifModal" style="background:rgba(255,255,255,0.05); border:none; color:var(--text-secondary); cursor:pointer; font-size:0.9rem; padding:0.2rem 0.6rem; border-radius:6px; transition:0.2s;">
        ✕
      </button>
    </div>
  `;

  const body = document.createElement("div");
  body.style.cssText = `
    padding: 0.5rem 1.25rem 1.25rem;
    overflow-y: auto;
    flex: 1;
  `;

  if (notificationHistory.length === 0) {
    body.innerHTML = `
      <div style="text-align:center; color:var(--text-secondary); opacity:0.4; padding:2rem 0;">
        <i class="fas fa-bell-slash" style="font-size:2rem; display:block; margin-bottom:0.5rem;"></i>
        No notifications yet
      </div>
    `;
  } else {
    let listHtml = "";
    notificationHistory.forEach((n) => {
      const isRead = n.read ? "opacity:0.5;" : "";
      listHtml += `
        <div style="padding:0.6rem 0; border-bottom:1px solid rgba(255,255,255,0.04); ${isRead}">
          <div style="display:flex; align-items:center; gap:0.4rem;">
            <span style="font-size:0.7rem; color:${n.type === "closed" ? "#ef4444" : "#8b5cf6"};">${n.type === "closed" ? "💹" : "🔔"}</span>
            <span style="font-weight:600; font-size:0.8rem; color:var(--text-primary);">${escapeHtml(n.title)}</span>
          </div>
          <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:0.1rem;">${escapeHtml(n.body)}</div>
          <div style="font-size:0.55rem; color:var(--text-secondary); opacity:0.4; margin-top:0.2rem;">${n.timestamp}</div>
        </div>
      `;
    });
    body.innerHTML = listHtml;
  }

  modalContent.appendChild(header);
  modalContent.appendChild(body);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  document.getElementById("closeNotifModal").addEventListener("click", () => {
    modal.remove();
    markAllAsRead();
  });

  document.getElementById("markAllReadBtn").addEventListener("click", () => {
    markAllAsRead();
    renderNotificationModal();
  });

  document.getElementById("clearNotifBtn").addEventListener("click", () => {
    if (confirm("Clear all notifications?")) {
      clearAllNotifications();
      renderNotificationModal();
    }
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
      markAllAsRead();
    }
  });
}

function updateChartsFromSignals(data) {
  updateEquityChart(data);
  updateWinRateChart(data);
  updateSignalChart(data);
}

function updateEquityChart(data) {
  const ctx = document.getElementById("equityChart");
  if (!ctx) return;
  if (equityChart) equityChart.destroy();
  const closed = data.closed || [];
  let labels = ["Start"],
    equityData = [100];
  if (closed.length) {
    let current = 100;
    closed.forEach((t, i) => {
      labels.push(`T${i + 1}`);
      current += t.returnPercent || 0;
      equityData.push(current);
    });
  } else {
    labels.push("Current");
    equityData.push(100);
  }
  equityChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Equity",
          data: equityData,
          borderColor: "#10b981",
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 300);
            g.addColorStop(0, "rgba(16,185,129,0.2)");
            g.addColorStop(1, "rgba(16,185,129,0)");
            return g;
          },
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        y: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#71717a" },
        },
        x: {
          grid: { display: false },
          ticks: { color: "#71717a", maxTicksLimit: 6 },
        },
      },
    },
  });
}

function updateWinRateChart(data) {
  const ctx = document.getElementById("winRateChart");
  if (!ctx) return;
  if (winRateChart) winRateChart.destroy();

  const closed = data.closed || [];

  const tpCount = closed.filter((s) => s.status === "TP").length;
  const slCount = closed.filter(
    (s) => s.status === "SL" || s.status === "STOP LOSS",
  ).length;
  const totalClosed = tpCount + slCount;
  let winRate = totalClosed > 0 ? (tpCount / totalClosed) * 100 : 0;
  winRate = Math.round(winRate * 10) / 10;

  let totalRisk = 0,
    totalReward = 0,
    grossProfit = 0,
    grossLoss = 0;
  closed.forEach((s) => {
    const ret = s.returnPercent || 0;
    if (ret > 0) {
      grossProfit += ret;
      totalReward += ret;
      totalRisk += ret * 0.5;
    } else {
      grossLoss += Math.abs(ret);
      totalRisk += Math.abs(ret);
    }
  });
  const avgRR = totalRisk > 0 ? (totalReward / totalRisk).toFixed(1) : "-";
  const profitFactor =
    grossLoss > 0
      ? (grossProfit / grossLoss).toFixed(2)
      : grossProfit > 0
        ? "∞"
        : "-";

  document.getElementById("avgRR").innerText = `1:${avgRR}`;
  document.getElementById("profitFactor").innerText = profitFactor;

  const win = winRate;
  const loss = 100 - winRate;
  const dataChart = totalClosed > 0 ? [win, loss] : [0, 100];
  const colors = ["#10b981", "#ef4444"];

  winRateChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Win", "Loss"],
      datasets: [
        {
          data: dataChart,
          backgroundColor: colors,
          borderColor: "transparent",
          cutout: "85%",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
    plugins: [
      {
        id: "winRateText",
        beforeDraw: (chart) => {
          const {
            ctx,
            chartArea: { width, height, top, left },
          } = chart;
          ctx.save();
          ctx.font = "bold 1.5rem 'Space Grotesk'";
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`${winRate}%`, left + width / 2, top + height / 2 - 8);
          ctx.font = "0.7rem 'Space Grotesk'";
          ctx.fillStyle = "#71717a";
          ctx.fillText("WIN RATE", left + width / 2, top + height / 2 + 22);
          ctx.restore();
        },
      },
    ],
  });
}

function updateSignalChart(data) {
  const ctx = document.getElementById("signalChart");
  if (!ctx) return;
  if (signalChart) signalChart.destroy();
  const running = data.running ? data.running.length : 0;
  const closed = data.closed ? data.closed.length : 0;
  const hasData = running + closed > 0;
  signalChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: hasData ? ["Running", "Closed"] : ["No Data"],
      datasets: [
        {
          data: hasData ? [running, closed] : [1],
          backgroundColor: hasData ? ["#10b981", "#3b82f6"] : ["#71717a"],
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#71717a", font: { size: 10 }, usePointStyle: true },
        },
      },
      cutout: "70%",
    },
  });
}

function sendNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, {
      body,
      icon: "https://raw.githubusercontent.com/TheGetsuzoZhiro/image/refs/heads/main/43D434F0-C01C-4A9E-8A5C-93B650B5981C.png",
    });
  }
}

function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    const activeTab = document.querySelector(".view.active")?.id;
    if (activeTab === "home") {
      fetchReports();
    }
    if (
      activeTab === "signals" ||
      activeTab === "home" ||
      activeTab === "daily"
    ) {
      fetchSignals(false);
    }
    updateLastUpdate();
  }, 10000);
}

function updateLastUpdate() {
  const el = document.getElementById("last-update");
  if (el)
    el.innerText = new Date().toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
}

function updateClock() {
  const clockEl = document.getElementById("clockDisplay");
  if (clockEl)
    clockEl.innerText = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
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

function initTabs() {
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
    "technical-today": {
      t: "Technical: Hari Ini",
      s: "Today's technical signals",
    },
    "technical-running": {
      t: "Technical: Running",
      s: "Active technical positions",
    },
    "technical-waiting": {
      t: "Technical: Waiting",
      s: "Pending execution setups",
    },
  };

  btns.forEach((btn) => {
    if (btn.id === "signalsParent" || btn.id === "technicalParent") return;

    btn.addEventListener("click", function (e) {
      // FIX: tambahkan e.stopPropagation() agar parent tidak ikut terpicu
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
          document
            .querySelector('.nav-link[data-tab="technical-signals"]')
            ?.classList.add("active");
          this.classList.add("active");
          document.querySelector(".sidebar")?.classList.remove("open");
          document.querySelector(".overlay")?.classList.remove("active");
          return;
        } else {
          if (tabId === "signals-today") selectSignalFilter("today");
          else if (tabId === "signals-running") selectSignalFilter("running");
          else selectSignalFilter("all");
          btns.forEach((b) => b.classList.remove("active"));
          document
            .querySelector('.nav-link[data-tab="signals"]')
            ?.classList.add("active");
          this.classList.add("active");
          document.querySelector(".sidebar")?.classList.remove("open");
          document.querySelector(".overlay")?.classList.remove("active");
          return;
        }
      }

      currentTab = tabId;
      btns.forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
      views.forEach((v) => v.classList.remove("active"));
      document.getElementById(tabId).classList.add("active");

      if (titles[tabId]) {
        pageTitle.innerText = titles[tabId].t;
        pageSubtitle.innerText = titles[tabId].s;
      }

      if (tabId === "daily") {
        if (!dailyRendered) showLoading("daily");
        fetchReports();
      }
      if (tabId === "signals") {
        signalListRendered = false;
        fetchSignals(true);
      }
      if (tabId === "technical-signals") {
        technicalListRendered = false;
        fetchSignals(true);
      }
      if (tabId === "home") {
        fetchReports();
        fetchSignals(false);
      }

      document.querySelector(".sidebar")?.classList.remove("open");
      document.querySelector(".overlay")?.classList.remove("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function initMobileMenu() {
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

function initPullToRefresh() {
  const wrapper = document.getElementById("pullToRefresh");
  const indicator = document.querySelector(".pull-indicator");
  let startY = 0,
    endY = 0;
  wrapper.addEventListener(
    "touchstart",
    (e) => {
      if (window.scrollY === 0) startY = e.touches[0].clientY;
    },
    { passive: true },
  );
  wrapper.addEventListener(
    "touchmove",
    (e) => {
      if (window.scrollY === 0 && startY > 0) {
        endY = e.touches[0].clientY;
        const diff = endY - startY;
        if (diff > 0 && diff < 200) {
          indicator.classList.add("visible");
          indicator.style.transform = `translateX(-50%) translateY(${diff * 0.5}px)`;
        }
      }
    },
    { passive: true },
  );
  wrapper.addEventListener("touchend", () => {
    if (startY > 0 && endY > 0 && endY - startY > 100 && window.scrollY === 0) {
      triggerHaptic();
      fetchReports();
      fetchSignals(true);
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

function initNotifications() {
  const notifBtn = document.getElementById("notifBtn");
  if (notifBtn) {
    notifBtn.addEventListener("click", async () => {
      const success = await subscribeToPush();
      if (success) {
        alert("✅ Notifikasi aktif! Token baru tersimpan.");
      } else {
        alert(
          "❌ Gagal mengaktifkan notifikasi. Pastikan browser mendukung dan izin diberikan.",
        );
      }
    });
  }
}

function createParticles() {
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

const VAPID_PUBLIC_KEY =
  "BCGyIOUseFBON2YXTAk-rcvncZ65jkbKqb2ShjOuvZhP08HLvaJJis5Bsx8ybuVVcZbXZow5GRrl9ykSiV0Y3B0";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
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
    console.log("✅ Dibuat subscription baru di browser.");

    const response = await fetch("/api/save-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });

    if (response.ok) {
      console.log("✅ Berhasil sinkronisasi token push ke Database server!");
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

function updatePriceElement(symbol, price) {
  const allSignals = getSortedSignals();
  const runningSignals = allSignals.filter(
    (s) =>
      s.stockCode === symbol &&
      (s.status === "RUNNING" || s.status === "TRAILING"),
  );
  if (!runningSignals.length) return;

  runningSignals.forEach((signal) => {
    const rows = document.querySelectorAll(
      `.sig-list-row[data-stock="${symbol}"][data-date="${signal.signalDate}"]`,
    );
    rows.forEach((row) => {
      const priceEl = row.querySelector(".stock-price");
      const gainEl = row.querySelector(".sig-right span:last-child");
      if (!priceEl) return;

      if (price != null) {
        let arrow = "";
        const gain = ((price - signal.entryPrice) / signal.entryPrice) * 100;
        if (Math.abs(gain) < 0.01) {
          if (gainEl) {
            gainEl.innerHTML = `0 (0.00%)`;
            gainEl.style.color = "var(--text-secondary)";
          }
        } else if (gain > 0) {
          const absGain = Math.abs(gain).toFixed(2);
          if (gainEl) {
            gainEl.innerHTML = `<i class="fa-solid fa-arrow-trend-up" style="font-size:0.7rem; color:#10b981;"></i> +${absGain}%`;
            gainEl.style.color = "#10b981";
          }
          arrow =
            '<i class="fa-solid fa-arrow-up" style="color:#10b981; font-size:0.7rem; margin-right:0.1rem;"></i>';
        } else {
          const absGain = Math.abs(gain).toFixed(2);
          if (gainEl) {
            gainEl.innerHTML = `<i class="fa-solid fa-arrow-trend-down" style="font-size:0.7rem; color:#ef4444;"></i> -${absGain}%`;
            gainEl.style.color = "#ef4444";
          }
          arrow =
            '<i class="fa-solid fa-arrow-down" style="color:#ef4444; font-size:0.7rem; margin-right:0.1rem;"></i>';
        }
        priceEl.innerHTML = `${arrow} ${fmtPriceNoRp(price)}`;
      } else {
        priceEl.textContent = "—";
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadNotifications();
  updateNotifBadge();
  createParticles();
  initTabs();

  const pushBtn = document.getElementById("enablePushBtn");
  if (pushBtn) {
    pushBtn.addEventListener("click", async () => {
      const success = await subscribeToPush();
      if (success) {
        alert("✅ Notifikasi aktif! Token baru tersimpan.");
      } else {
        alert(
          "❌ Gagal mengaktifkan notifikasi. Pastikan browser mendukung dan izin diberikan.",
        );
      }
    });
  }

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

  initMobileMenu();
  initPullToRefresh();
  initNotifications();

  window.addEventListener("hashchange", () => {
    const hash = window.location.hash;

    if (hash === "#signals-today") {
      selectSignalFilter("today");
    } else if (hash === "#signals-running") {
      selectSignalFilter("running");
    } else if (hash === "#signals" || hash === "") {
      currentSignalFilter = "none";
      signalListRendered = false;
      showSignalList();
    } else if (hash === "#technical-today") {
      selectTechnicalFilter("today");
    } else if (hash === "#technical-running") {
      selectTechnicalFilter("running");
    } else if (hash === "#technical-waiting") {
      selectTechnicalFilter("waiting");
    } else if (hash === "#home") {
      currentTab = "home";
      currentSignalFilter = "none";
      currentTechnicalFilter = "none";
      document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.remove("active"));
      document.getElementById("home").classList.add("active");
      document
        .querySelectorAll(".nav-link, .nav-sub-link")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelector('.nav-link[data-tab="home"]')
        ?.classList.add("active");
      fetchReports();
      fetchSignals(false);
      showSignalList();
    } else {
      window.location.hash = "home";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const currentHash = window.location.hash;
  if (
    currentHash !== "#home" &&
    !currentHash.startsWith("#detail-") &&
    !currentHash.startsWith("#technical-") &&
    !currentHash.startsWith("#signals-")
  ) {
    window.location.hash = "home";
  }

  currentTab = "home";
  currentSignalFilter = "none";
  currentTechnicalFilter = "none";
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById("home").classList.add("active");
  document
    .querySelectorAll(".nav-link, .nav-sub-link")
    .forEach((b) => b.classList.remove("active"));
  document.querySelector('.nav-link[data-tab="home"]')?.classList.add("active");

  showLoading("daily");
  showLoading("signals");
  showLoading("technical-signals");

  fetchReports();
  fetchSignals(false);
  showSignalList();

  startPolling();
  connectPriceSSE();
  setInterval(updateClock, 1000);
  updateClock();
  updateLastUpdate();

  if (window.location.hash.startsWith("#detail-")) {
    window.location.hash = "home";
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log(
          "ServiceWorker berhasil didaftarkan dengan scope: ",
          registration.scope,
        );
      })
      .catch((error) => {
        console.log("ServiceWorker gagal didaftarkan: ", error);
      });
  });
}
