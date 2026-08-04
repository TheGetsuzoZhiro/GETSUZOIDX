// ===== CHARTS =====

let equityChart = null;
let winRateChart = null;
let signalChart = null;
let returnChartInstance = null;
let detailCharts = { rsi: null, macd: null, bandar: null };

export function destroyAllCharts() {
  if (equityChart) { equityChart.destroy(); equityChart = null; }
  if (winRateChart) { winRateChart.destroy(); winRateChart = null; }
  if (signalChart) { signalChart.destroy(); signalChart = null; }
  if (returnChartInstance) { returnChartInstance.destroy(); returnChartInstance = null; }
  if (detailCharts.rsi) { detailCharts.rsi.destroy(); detailCharts.rsi = null; }
  if (detailCharts.macd) { detailCharts.macd.destroy(); detailCharts.macd = null; }
}

export function updateEquityChart(data) {
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
      datasets: [{
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
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
      scales: {
        y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#71717a" } },
        x: { grid: { display: false }, ticks: { color: "#71717a", maxTicksLimit: 6 } },
      },
    },
  });
}

export function updateWinRateChart(data) {
  const ctx = document.getElementById("winRateChart");
  if (!ctx) return;
  if (winRateChart) winRateChart.destroy();

  const closed = data.closed || [];
  const tpCount = closed.filter((s) => s.status === "TP").length;
  const slCount = closed.filter((s) => s.status === "SL" || s.status === "STOP LOSS").length;
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
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? "∞" : "-";

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
      datasets: [{
        data: dataChart,
        backgroundColor: colors,
        borderColor: "transparent",
        cutout: "85%",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
    plugins: [{
      id: "winRateText",
      beforeDraw: (chart) => {
        const { ctx, chartArea: { width, height, top, left } } = chart;
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
    }],
  });
}

export function updateSignalChart(data) {
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
      datasets: [{
        data: hasData ? [running, closed] : [1],
        backgroundColor: hasData ? ["#10b981", "#3b82f6"] : ["#71717a"],
        borderColor: "rgba(255,255,255,0.1)",
        borderWidth: 2,
        hoverOffset: 4,
      }],
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

export function updateChartsFromSignals(data) {
  updateEquityChart(data);
  updateWinRateChart(data);
  updateSignalChart(data);
}

// Daily charts
export function renderDailyReturnChart(signals, containerId = "dailyReturnChartWrapper") {
  const wrapper = document.getElementById(containerId);
  if (!wrapper) return;
  if (returnChartInstance) {
    returnChartInstance.destroy();
    returnChartInstance = null;
  }

  const closed = signals
    .filter((s) => s.status === "TP" || s.status === "SL" || s.status === "STOP LOSS")
    .sort((a, b) => (a.closeDate || "").localeCompare(b.closeDate || ""));

  if (!closed.length) {
    wrapper.innerHTML =
      '<div style="text-align:center;color:var(--text-secondary);padding:4rem 1.5rem;font-size:0.9rem;">Tidak ada data untuk ditampilkan.</div>';
    return;
  }

  wrapper.innerHTML = '<canvas id="dailyReturnChart"></canvas>';
  const ctx = document.getElementById("dailyReturnChart");

  const labels = closed.map((_, idx) => `T${idx + 1}`);
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
      datasets: [{
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
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
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

export function renderDailyWinRateChart(parsed) {
  const ctxWin = document.getElementById("dailyWinRateChart");
  if (!ctxWin) return;
  let existingChart = Chart.getChart(ctxWin);
  if (existingChart) existingChart.destroy();

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

  new Chart(ctxWin, {
    type: "doughnut",
    data: {
      datasets: [{
        data: displayData,
        backgroundColor: displayColors,
        borderWidth: 0,
        cutout: "70%",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ctx.parsed + "%" } },
      },
    },
    plugins: [{
      id: "winRateText",
      beforeDraw: function (chart) {
        const { ctx, chartArea: { width, height, top, left } } = chart;
        ctx.save();
        ctx.font = 'bold 1.2rem "JetBrains Mono"';
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(centerText, left + width / 2, top + height / 2);
        ctx.restore();
      },
    }],
  });
}

export function renderDailySignalChart(parsed) {
  const ctxSignal = document.getElementById("dailySignalChart");
  if (!ctxSignal) return;
  let existingSignalChart = Chart.getChart(ctxSignal);
  if (existingSignalChart) existingSignalChart.destroy();

  new Chart(ctxSignal, {
    type: "bar",
    data: {
      labels: ["New", "TP", "SL", "Running"],
      datasets: [{
        data: [parsed.totalSignals, parsed.tp, parsed.sl, parsed.running],
        backgroundColor: ["#3b82f6", "#10b981", "#ef4444", "#f59e0b"],
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#71717a" } },
        x: { grid: { display: false }, ticks: { color: "#71717a" } },
      },
    },
  });
}

export function renderDetailCharts(s, container = document) {
  if (detailCharts.rsi) {
    try { detailCharts.rsi.destroy(); } catch (e) {}
    detailCharts.rsi = null;
  }
  if (detailCharts.macd) {
    try { detailCharts.macd.destroy(); } catch (e) {}
    detailCharts.macd = null;
  }

  Chart.defaults.color = "#71717a";
  Chart.defaults.font.family = "'JetBrains Mono', monospace";

  let ctxRsi = container.querySelector ? container.querySelector("#proRsiChart") : null;
  if (!ctxRsi) ctxRsi = document.getElementById("proRsiChart");

  if (ctxRsi && s.rsi != null) {
    const rsiVal = s.rsi;
    const color = rsiVal > 70 ? "#ef4444" : rsiVal < 30 ? "#10b981" : "#f59e0b";
    detailCharts.rsi = new Chart(ctxRsi, {
      type: "doughnut",
      data: {
        datasets: [{
          data: [rsiVal, 100 - rsiVal],
          backgroundColor: [color, "rgba(255,255,255,0.05)"],
          borderWidth: 0,
          cutout: "80%",
        }],
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

  let ctxMacd = container.querySelector ? container.querySelector("#proMacdChart") : null;
  if (!ctxMacd) ctxMacd = document.getElementById("proMacdChart");

  if (ctxMacd && s.macd != null) {
    const hist = s.macd - (s.macdSignal || 0);
    detailCharts.macd = new Chart(ctxMacd, {
      type: "bar",
      data: {
        labels: ["MACD", "Signal", "Hist"],
        datasets: [{
          data: [s.macd, s.macdSignal || 0, hist],
          backgroundColor: ["#3b82f6", "#f59e0b", hist > 0 ? "#10b981" : "#ef4444"],
          borderRadius: 4,
        }],
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
