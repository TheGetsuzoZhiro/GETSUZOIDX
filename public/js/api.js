import { API_BASE } from "./config.js";

// ===== API FUNCTIONS =====

let infoCache = new Map();

export async function fetchSignalsFromAPI() {
  const response = await fetch(`${API_BASE}/signals`);
  if (!response.ok) throw new Error("Gagal fetch signals");
  const data = await response.json();
  return {
    running: data.running || [],
    closed: data.closed || [],
  };
}

export async function fetchStockPrice(symbol) {
  try {
    const response = await fetch(`${API_BASE}/stock-info/${symbol}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.price || null;
  } catch (e) {
    console.warn(`Gagal fetch price ${symbol}:`, e);
    return null;
  }
}

export async function fetchStockInfo(symbol) {
  if (infoCache.has(symbol)) {
    const cached = infoCache.get(symbol);
    if (Date.now() - cached.timestamp < 3600000) {
      return cached.data;
    }
  }
  try {
    const response = await fetch(`${API_BASE}/stock-info/${symbol}`);
    if (!response.ok) throw new Error("Network error");
    const data = await response.json();
    infoCache.set(symbol, { data, timestamp: Date.now() });
    return data;
  } catch (e) {
    console.warn(`Gagal fetch info ${symbol}:`, e);
    return { symbol, longName: symbol, logoUrl: null };
  }
}

export async function fetchNews(category, page = 1) {
  const limit = 10;
  const url = `${API_BASE}/news?category=${encodeURIComponent(category)}&page=${page}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

export async function fetchNewsByStock(stockCode, limit = 10) {
  const url = `${API_BASE}/news?stockCode=${encodeURIComponent(stockCode)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Gagal mengambil berita");
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

export async function saveSubscription(subscription) {
  const response = await fetch(`${API_BASE}/save-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  });
  return response.ok;
}
