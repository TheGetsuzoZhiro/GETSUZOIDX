const axios = require("axios");
const moment = require("moment-timezone");
const express = require("express");
const path = require("path");
const os = require("os");
const webpush = require("web-push");
const mongoose = require("mongoose");

const sentPushesCache = new Map();
const priceCacheBackend = new Map();
const infoCache = new Map();

moment.tz.setDefault("Asia/Jakarta");

// ============ VAPID ============
const vapidPublicKey =
  "BCGyIOUseFBON2YXTAk-rcvncZ65jkbKqb2ShjOuvZhP08HLvaJJis5Bsx8ybuVVcZbXZow5GRrl9ykSiV0Y3B0";
const vapidPrivateKey = "7PHNRENDWCkDl7JwoVYayqJDBkvSbzwZ2vxz1Cx7bSI";
webpush.setVapidDetails(
  "mailto:radityayoga187@gmail.com",
  vapidPublicKey,
  vapidPrivateKey,
);

// ============ KONEKSI MONGODB ============
const MONGO_URI =
  "mongodb+srv://zhironihboss_db_user:tzPCYPLUNw0fWrTz@cluster0.bfs8tiy.mongodb.net/getsuzo_db?retryWrites=true&w=majority&appName=Cluster0";

mongoose
  .connect(MONGO_URI)
  .then(() =>
    console.log("✅ Berhasil terhubung ke MongoDB Atlas (Read-Only Mode)!"),
  )
  .catch((err) => console.error("❌ Gagal koneksi ke MongoDB:", err.message));

// ============ MONGOOSE SCHEMAS ============
const SignalSchema = new mongoose.Schema(
  {
    stockCode: String,
    signalType: String,
    confidenceScore: Number,
    confidenceDetails: [String],
    entryPrice: Number,
    tp1: Number,
    sl: Number,
    slModerat: Number,
    slKonservatif: Number,
    macd: Number,
    macdSignal: Number,
    rsi: Number,
    ema20: Number,
    ema50: Number,
    vwap: Number,
    adx: Number,
    bbLow: Number,
    bbHigh: Number,
    atr: Number,
    patternChart: String,
    patternCandle: String,
    sinyalBandar: String,
    smartMoneyNet: Number,
    foreignNet: Number,
    foreignPartisipasi: Number,
    beta: Number,
    volatilitas: Number,
    topBuyers: [{ code: String, lot: Number }],
    topSellers: [{ code: String, lot: Number }],
    analystOpinion: String,
    relatedNews: [String],
    status: String,
    signalDate: String,
    closeDate: String,
    exitPrice: Number,
    returnPercent: Number,
    holdingDays: Number,
    currentHigh: Number,
    currentLow: Number,
  },
  { versionKey: false },
);

const SignalModel = mongoose.model("Signal", SignalSchema, "signals");

const SubscriptionSchema = new mongoose.Schema(
  {
    endpoint: { type: String, required: true, unique: true },
    expirationTime: mongoose.Schema.Types.Mixed,
    keys: { p256dh: String, auth: String },
  },
  { timestamps: true, versionKey: false },
);
const SubscriptionModel = mongoose.model(
  "PushSubscription",
  SubscriptionSchema,
  "push_subscriptions",
);

// ============ TOKEN STOCKBIT ============
const TokenSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "stockbit_token" },
    token: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
const TokenModel = mongoose.model(
  "StockbitToken",
  TokenSchema,
  "stockbit_tokens",
);

let stockbitToken = null;

async function fetchTokenFromMongo() {
  try {
    const doc = await TokenModel.findById("stockbit_token");
    if (doc && doc.token) {
      stockbitToken = doc.token;
      console.log("✅ Token Stockbit dimuat dari MongoDB (Frontend)");
      return true;
    }
    console.warn("⚠️ Token tidak ditemukan di MongoDB (Frontend)");
    return false;
  } catch (err) {
    console.error("❌ Gagal ambil token:", err.message);
    return false;
  }
}

// ============ FUNGSI AMBIL HARGA STOCKBIT DENGAN RENTANG (SAMA SEPERTI BACKEND) ============
async function fetchStockbitPrice(symbol, startDate = null) {
  if (!stockbitToken) {
    console.warn(`[STOCKBIT] Token kosong, skip ${symbol}`);
    return null;
  }

  const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
  let start = today;
  if (startDate) {
    start = moment(startDate).tz("Asia/Jakarta").format("YYYY-MM-DD");
    if (start > today) start = today; // antisipasi jika startDate di masa depan
  }

  const url = `https://exodus.stockbit.com/company-price-feed/historical/summary/${symbol.toUpperCase()}?period=HS_PERIOD_DAILY&start_date=${start}&end_date=${today}&limit=1&page=1`;

  try {
    const response = await axios({
      method: "GET",
      url,
      headers: {
        Authorization: stockbitToken,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
        Origin: "https://pro.stockbit.com",
        Referer: "https://pro.stockbit.com/",
      },
      timeout: 10000,
    });

    const result = response.data?.data?.result;
    if (!result || result.length === 0) return null;
    const last = result[0]; // data terbaru dalam rentang
    return { price: last.close };
  } catch (err) {
    if (err.response && err.response.status === 401) {
      console.warn(`[STOCKBIT] Token expired, refresh...`);
      await fetchTokenFromMongo();
    } else {
      console.error(`[STOCKBIT] Gagal ambil ${symbol}:`, err.message);
    }
    return null;
  }
}

// ============ MARKET HELPERS (libur, jam bursa) ============
const liburCache = { date: null, isLibur: false };
let currentHolidayName = null;

async function isTradingDay() {
  const now = moment().tz("Asia/Jakarta");
  const today = now.format("YYYY-MM-DD");
  const dayOfWeek = now.day();

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    currentHolidayName = "Akhir Pekan";
    return false;
  }

  if (liburCache.date === today) {
    if (liburCache.isLibur) {
      currentHolidayName = liburCache.holidayName || "Libur Nasional";
    } else {
      currentHolidayName = null;
    }
    return !liburCache.isLibur;
  }

  try {
    const response = await axios.get("https://api-hari-libur.vercel.app/api", {
      timeout: 5000,
    });
    if (response.data && response.data.data) {
      const holiday = response.data.data.find((h) => h.date === today);
      if (holiday) {
        liburCache.date = today;
        liburCache.isLibur = true;
        liburCache.holidayName = holiday.description || "Libur Nasional";
        currentHolidayName = liburCache.holidayName;
        return false;
      }
    }
  } catch (err) {
    console.error("Gagal cek libur, asumsikan hari trading:", err.message);
  }

  liburCache.date = today;
  liburCache.isLibur = false;
  liburCache.holidayName = null;
  currentHolidayName = null;
  return true;
}

async function isMarketOpen() {
  if (!(await isTradingDay())) return false;

  const now = moment().tz("Asia/Jakarta");
  const hour = now.hour(),
    minute = now.minute(),
    dayOfWeek = now.day(),
    isFriday = dayOfWeek === 5;

  if (isFriday) {
    const s1 =
      (hour > 9 || (hour === 9 && minute >= 0)) &&
      (hour < 11 || (hour === 11 && minute <= 30));
    const s2 =
      (hour > 14 || (hour === 14 && minute >= 0)) &&
      (hour < 15 || (hour === 15 && minute <= 49));
    return s1 || s2;
  } else {
    const s1 =
      (hour > 9 || (hour === 9 && minute >= 0)) &&
      (hour < 12 || (hour === 12 && minute <= 0));
    const s2 =
      (hour > 13 || (hour === 13 && minute >= 30)) &&
      (hour < 15 || (hour === 15 && minute <= 49));
    return s1 || s2;
  }
}

// ============ EXPRESS APP ============
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ----- ROUTE PRICE (STOCKBIT) dengan CACHE 5 DETIK & DUKUNGAN startDate -----
app.get("/api/price/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const startDate = req.query.startDate || null; // misal: ?startDate=2026-07-07

  try {
    // Cache bedakan berdasarkan symbol dan startDate (jika ada)
    const cacheKey = startDate ? `${symbol}_${startDate}` : symbol;
    if (priceCacheBackend.has(cacheKey)) {
      const cached = priceCacheBackend.get(cacheKey);
      if (Date.now() - cached.timestamp < 5000) {
        return res.json({ symbol, price: cached.price });
      }
    }

    const data = await fetchStockbitPrice(symbol, startDate);
    if (data && data.price !== undefined) {
      priceCacheBackend.set(cacheKey, {
        price: data.price,
        timestamp: Date.now(),
      });
      res.json({ symbol, price: data.price });
    } else {
      res.status(404).json({ error: "Price not found" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----- ROUTE STOCK INFO (long name dari Yahoo Search, logo dari Stockbit) -----
app.get("/api/stock-info/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (infoCache.has(symbol)) {
    const cached = infoCache.get(symbol);
    if (Date.now() - cached.timestamp < 3600000) {
      return res.json(cached.data);
    }
  }

  try {
    // Ambil longname dari Yahoo Search API (ringan)
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}.JK`;
    const response = await axios.get(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
    });

    let longName = symbol;
    const quotes = response.data?.quotes;
    if (quotes && quotes.length > 0) {
      const match = quotes.find(
        (q) => q.symbol && q.symbol.toUpperCase() === `${symbol}.JK`,
      );
      if (match) {
        longName = match.longname || match.shortname || symbol;
      } else {
        longName = quotes[0].longname || quotes[0].shortname || symbol;
      }
    }

    const result = {
      symbol,
      longName,
      logoUrl: `https://assets.stockbit.com/logos/companies/${symbol}.png`,
    };

    infoCache.set(symbol, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (error) {
    console.warn(
      `Gagal fetch info ${symbol} dari Yahoo Search:`,
      error.message,
    );
    // Fallback
    res.json({
      symbol,
      longName: symbol,
      logoUrl: `https://assets.stockbit.com/logos/companies/${symbol}.png`,
    });
  }
});

// ----- ROUTE SIGNALS -----
app.get("/api/signals", async (req, res) => {
  try {
    const allSignals = await SignalModel.find({});
    const running = allSignals.filter((s) => s.status === "RUNNING");
    const closed = allSignals.filter((s) => s.status !== "RUNNING");
    res.json({ running, closed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----- ROUTE MARKET STATUS -----
app.get("/api/market-status", async (req, res) => {
  const open = await isMarketOpen();
  const now = moment().tz("Asia/Jakarta");
  const dayOfWeek = now.day();
  let statusText = "",
    statusClass = "";
  if (open) {
    statusText = "Market Open";
    statusClass = "open";
  } else {
    const tradingDay = await isTradingDay();
    if (!tradingDay) {
      statusText = `Libur: ${currentHolidayName || "Nasional"}`;
      statusClass = "holiday";
    } else {
      const hour = now.hour(),
        minute = now.minute();
      if (dayOfWeek === 5) {
        if (hour < 9 || (hour === 9 && minute < 0)) statusText = "Pra Buka";
        else if (
          (hour > 11 || (hour === 11 && minute > 30)) &&
          (hour < 14 || (hour === 14 && minute < 0))
        )
          statusText = "Istirahat";
        else if (hour >= 15 || (hour === 15 && minute > 49))
          statusText = "Pasca Bursa";
        else statusText = "Market Closed";
      } else {
        if (hour < 9 || (hour === 9 && minute < 0)) statusText = "Pra Buka";
        else if (
          (hour > 12 || (hour === 12 && minute > 0)) &&
          (hour < 13 || (hour === 13 && minute < 30))
        )
          statusText = "Istirahat";
        else if (hour >= 15 || (hour === 15 && minute > 49))
          statusText = "Pasca Bursa";
        else statusText = "Market Closed";
      }
      statusClass = "closed";
    }
  }
  res.json({
    isOpen: open,
    currentTime: now.format("HH:mm:ss"),
    day: now.format("dddd"),
    date: now.format("DD MMM YYYY"),
    statusText,
    statusClass,
    holidayName: currentHolidayName,
  });
});

// ----- ROUTE SAVE SUBSCRIPTION -----
app.post("/api/save-subscription", async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Invalid subscription data" });
  }
  try {
    await SubscriptionModel.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      subscription,
      { upsert: true, returnDocument: "after" },
    );
    console.log(`✅ Subscription saved to MongoDB.`);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Gagal simpan subscription:", error.message);
    res.status(500).json({ error: "Gagal menyimpan ke database" });
  }
});

// ----- ROUTE SEND PUSH (dengan spam protection) -----
app.post("/api/send-push", async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: "Title and body required" });
  }
  const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
  const pushKey = `${title.toUpperCase().trim()}_${today}`;
  if (sentPushesCache.has(pushKey)) {
    console.log(`[SPAM] Blokir duplikat: "${title}"`);
    return res.json({ success: true, message: "Sudah dikirim hari ini" });
  }
  sentPushesCache.set(pushKey, true);

  const payload = JSON.stringify({ title, body });
  const pushOptions = { TTL: 86400, urgency: "high" };

  try {
    const subscriptions = await SubscriptionModel.find({});
    if (subscriptions.length === 0) {
      sentPushesCache.delete(pushKey);
      return res.json({ success: true, message: "Tidak ada subscriber" });
    }
    const promises = subscriptions.map((sub) =>
      webpush.sendNotification(sub, payload, pushOptions).catch(async (err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await SubscriptionModel.deleteOne({ endpoint: sub.endpoint });
        }
      }),
    );
    await Promise.all(promises);
    res.json({ success: true, sent: subscriptions.length });
  } catch (error) {
    sentPushesCache.delete(pushKey);
    res.status(500).json({ error: error.message });
  }
});

// ----- HELPER IP -----
async function getPublicIP() {
  const sources = [
    "https://api.ipify.org?format=text",
    "https://ifconfig.me/ip",
    "https://ident.me",
  ];
  for (const url of sources) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url.trim(), { signal: controller.signal });
      clearTimeout(timeoutId);
      const ip = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch {}
  }
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

app.get("/", (req, res) => {
  res.send("Server Frontend Read-Only Aktif!");
});

app.listen(PORT, "0.0.0.0", async () => {
  const ip = await getPublicIP();
  console.log(`\n🌐 Frontend API server available at:`);
  console.log(`   • http://localhost:${PORT}`);
  console.log(`   • http://${ip}:${PORT}`);
  console.log(`\n✅ Read-Only Server running on Port: ${PORT}`);
});

// =========================================================================
// 🚀 WATCHDOG – Deteksi sinyal baru & perubahan status ke TP/SL (Background)
// =========================================================================
let serverLastRunningIds = null;
let serverLastClosedIds = null;
// Map untuk menyimpan status terakhir per sinyal
const serverLastStatus = new Map();

function getSessionFromDate(signalDate) {
  if (!signalDate) return null;
  const date = new Date(signalDate);
  const hour = date.getHours(),
    minute = date.getMinutes();
  const time = hour + minute / 60;
  if (time >= 4 && time < 12) return 1;
  if (time >= 12 && time <= 16) return 2;
  return null;
}

async function triggerInternalPush(title, body) {
  const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
  const pushKey = `${title.toUpperCase().trim()}_${today}`;
  if (sentPushesCache.has(pushKey)) {
    console.log(`[WATCHDOG] Blokir spam: "${title}"`);
    return;
  }
  sentPushesCache.set(pushKey, true);
  const payload = JSON.stringify({ title, body });
  const pushOptions = { TTL: 86400, urgency: "high" };
  try {
    const subscriptions = await SubscriptionModel.find({});
    if (subscriptions.length === 0) {
      sentPushesCache.delete(pushKey);
      return;
    }
    const promises = subscriptions.map((sub) =>
      webpush.sendNotification(sub, payload, pushOptions).catch(async (err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await SubscriptionModel.deleteOne({ endpoint: sub.endpoint });
        }
      }),
    );
    await Promise.all(promises);
    console.log(`✅ [WATCHDOG] PUSH TERKIRIM: ${title}`);
  } catch (err) {
    sentPushesCache.delete(pushKey);
    console.error("❌ [WATCHDOG] Gagal kirim push:", err.message);
  }
}

async function checkDatabaseForNewSignals() {
  try {
    const allSignals = await SignalModel.find({});
    const running = allSignals.filter((s) => s.status === "RUNNING");
    const closed = allSignals.filter((s) => s.status !== "RUNNING");

    const currentRunningIds = running
      .map((s) => `${s.stockCode}-${s.signalDate}`)
      .sort()
      .join(",");
    const currentClosedIds = closed
      .map((s) => `${s.stockCode}-${s.signalDate}`)
      .sort()
      .join(",");

    // Inisialisasi pertama kali
    if (serverLastRunningIds === null || serverLastClosedIds === null) {
      serverLastRunningIds = currentRunningIds;
      serverLastClosedIds = currentClosedIds;
      allSignals.forEach((s) => {
        const key = `${s.stockCode}-${s.signalDate}`;
        serverLastStatus.set(key, s.status);
      });
      console.log(
        "🔄 [WATCHDOG] Server siap. Memantau sinyal saham di background 24/7...",
      );
      return;
    }

    // ---- DETEKSI SINYAL BARU (RUNNING) ----
    const prevRunningArr = serverLastRunningIds.split(",");
    const currentRunningArr = currentRunningIds.split(",");
    const newRunning = currentRunningArr.filter(
      (id) => !prevRunningArr.includes(id),
    );

    if (newRunning.length > 0) {
      const newSignals = running.filter((s) =>
        newRunning.includes(`${s.stockCode}-${s.signalDate}`),
      );
      const groups = { session1: [], session2: [], bsjp: [], other: [] };
      newSignals.forEach((s) => {
        if (s.signalType === "BSJP") groups.bsjp.push(s);
        else {
          const session = getSessionFromDate(s.signalDate);
          if (session === 1) groups.session1.push(s);
          else if (session === 2) groups.session2.push(s);
          else groups.other.push(s);
        }
      });
      if (groups.session1.length)
        triggerInternalPush(
          "NEW SIGNALS SESI 1",
          `${groups.session1.length} sinyal saham baru untuk SESI 1.`,
        );
      if (groups.session2.length)
        triggerInternalPush(
          "NEW SIGNALS SESI 2",
          `${groups.session2.length} sinyal saham baru untuk SESI 2.`,
        );
      if (groups.bsjp.length)
        triggerInternalPush(
          "NEW SIGNALS BSJP",
          `${groups.bsjp.length} sinyal saham baru untuk BSJP.`,
        );
      if (groups.other.length)
        triggerInternalPush(
          "NEW SIGNALS LAINNYA",
          `${groups.other.length} sinyal saham baru.`,
        );
    }

    // ---- DETEKSI PERUBAHAN STATUS MENJADI TP (dari status apapun) ----
    const tpSignals = allSignals.filter((s) => s.status === "TP");
    for (const s of tpSignals) {
      const key = `${s.stockCode}-${s.signalDate}`;
      const prevStatus = serverLastStatus.get(key);
      if (prevStatus !== "TP") {
        const ret = s.returnPercent || 0;
        const sign = ret >= 0 ? "+" : "";
        const title = `✅ TP: ${s.stockCode}`;
        const body = `${s.stockCode} Take Profit ${sign}${ret.toFixed(2)}%`;
        await triggerInternalPush(title, body);
        serverLastStatus.set(key, "TP");
      }
    }

    // ---- (Opsional) DETEKSI SL ----
    const slSignals = allSignals.filter((s) => s.status === "SL");
    for (const s of slSignals) {
      const key = `${s.stockCode}-${s.signalDate}`;
      const prevStatus = serverLastStatus.get(key);
      if (prevStatus !== "SL") {
        const ret = s.returnPercent || 0;
        const title = `❌ SL: ${s.stockCode}`;
        const body = `${s.stockCode} Stop Loss ${ret.toFixed(2)}%`;
        await triggerInternalPush(title, body);
        serverLastStatus.set(key, "SL");
      }
    }

    // Update cache
    serverLastRunningIds = currentRunningIds;
    serverLastClosedIds = currentClosedIds;
    allSignals.forEach((s) => {
      const key = `${s.stockCode}-${s.signalDate}`;
      if (!serverLastStatus.has(key)) {
        serverLastStatus.set(key, s.status);
      }
    });
  } catch (err) {
    console.error("❌ [WATCHDOG] Gagal polling database:", err.message);
  }
}

// ============ START WATCHDOG & TOKEN REFRESH ============
fetchTokenFromMongo();
setInterval(fetchTokenFromMongo, 60 * 60 * 1000); // refresh token setiap jam

checkDatabaseForNewSignals();
setInterval(checkDatabaseForNewSignals, 30000); // setiap 30 detik
