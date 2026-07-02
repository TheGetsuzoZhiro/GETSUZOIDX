const axios = require("axios");
const moment = require("moment-timezone");
const express = require("express");
const path = require("path");
const os = require("os");
const webpush = require("web-push");
const mongoose = require("mongoose");
const sentPushesCache = new Map();

moment.tz.setDefault("Asia/Jakarta");

// Variabel pushSubscriptions (RAM) dihapus karena sudah diganti database
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

// ============ MONGOOSE SCHEMAS & MODELS ============
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

// === TAMBAHAN BARU: SCHEMA & MODEL UNTUK SUBSCRIPTION PUSH NOTIF ===
const SubscriptionSchema = new mongoose.Schema(
  {
    endpoint: { type: String, required: true, unique: true },
    expirationTime: mongoose.Schema.Types.Mixed,
    keys: {
      p256dh: String,
      auth: String,
    },
  },
  { timestamps: true, versionKey: false },
);

const SubscriptionModel = mongoose.model(
  "PushSubscription",
  SubscriptionSchema,
  "push_subscriptions",
);

// ============ YAHOO FINANCE & MARKET TIME HELPERS ============
const yahooCache = new Map();

async function fetchYahooData(symbol) {
  const now = Date.now();
  const cached = yahooCache.get(symbol);
  if (cached && now - cached.timestamp < 10000) {
    return cached.data;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.JK`;
    const response = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
    });
    const meta = response.data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("Meta tidak ditemukan");

    const regularMarketTime = meta.regularMarketTime;
    const dateObj = moment.unix(regularMarketTime).tz("Asia/Jakarta");
    const dateStr = dateObj.format("YYYY-MM-DD");

    const result = {
      price: meta.regularMarketPrice,
      date: dateStr,
    };
    yahooCache.set(symbol, { data: result, timestamp: now });
    return result;
  } catch (err) {
    console.error(`Yahoo error for ${symbol}:`, err.message);
    return null;
  }
}

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
  const hour = now.hour();
  const minute = now.minute();
  const dayOfWeek = now.day();
  const isFriday = dayOfWeek === 5;

  if (isFriday) {
    const session1 =
      (hour > 9 || (hour === 9 && minute >= 0)) &&
      (hour < 11 || (hour === 11 && minute <= 30));
    const session2 =
      (hour > 14 || (hour === 14 && minute >= 0)) &&
      (hour < 15 || (hour === 15 && minute <= 49));
    return session1 || session2;
  } else {
    const session1 =
      (hour > 9 || (hour === 9 && minute >= 0)) &&
      (hour < 12 || (hour === 12 && minute <= 0));
    const session2 =
      (hour > 13 || (hour === 13 && minute >= 30)) &&
      (hour < 15 || (hour === 15 && minute <= 49));
    return session1 || session2;
  }
}

// ============ EXPRESS WEB SERVER (READ-ONLY INTERFACE) ============
const app = express();
const PORT =
  process.env.PORT || process.env.SERVER_PORT || process.env.APP_PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Route untuk Realtime Price Checker via Yahoo
const priceCacheBackend = new Map();
app.get("/api/price/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    if (priceCacheBackend.has(symbol)) {
      const cached = priceCacheBackend.get(symbol);
      if (Date.now() - cached.timestamp < 30000) {
        return res.json({ symbol, price: cached.price });
      }
    }
    const data = await fetchYahooData(symbol);
    if (data) {
      priceCacheBackend.set(symbol, {
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

// Route untuk Informasi Profil Saham & Logo
const infoCache = new Map();
app.get("/api/stock-info/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (infoCache.has(symbol)) {
    const cached = infoCache.get(symbol);
    if (Date.now() - cached.timestamp < 3600000) {
      return res.json(cached.data);
    }
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.JK`;
    const response = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
    });
    const meta = response.data?.chart?.result?.[0]?.meta;
    // 🔁 Ambil shortName (semua emiten punya), fallback ke symbol
    const longName = meta?.shortName || meta?.symbol || symbol;
    // ❌ LogoUrl dihapus / tidak dikirim
    const result = { symbol, longName, logoUrl: null };
    infoCache.set(symbol, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (error) {
    // Fallback jika gagal
    res.json({
      symbol,
      longName: symbol,
      logoUrl: null,
    });
  }
});

// Route untuk mengambil semua sinyal
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

// Route untuk Status Operasional Bursa Realtime
app.get("/api/market-status", async (req, res) => {
  const open = await isMarketOpen();
  const now = moment().tz("Asia/Jakarta");
  const dayOfWeek = now.day();
  let statusText = "";
  let statusClass = "";

  if (open) {
    statusText = "Market Open";
    statusClass = "open";
  } else {
    const tradingDay = await isTradingDay();
    if (!tradingDay) {
      statusText = `Libur: ${currentHolidayName || "Nasional"}`;
      statusClass = "holiday";
    } else {
      const hour = now.hour();
      const minute = now.minute();
      if (dayOfWeek === 5) {
        if (hour < 9 || (hour === 9 && minute < 0)) {
          statusText = "Pra Buka";
        } else if (
          (hour > 11 || (hour === 11 && minute > 30)) &&
          (hour < 14 || (hour === 14 && minute < 0))
        ) {
          statusText = "Istirahat";
        } else if (hour >= 15 || (hour === 15 && minute > 49)) {
          statusText = "Pasca Bursa";
        } else {
          statusText = "Market Closed";
        }
      } else {
        if (hour < 9 || (hour === 9 && minute < 0)) {
          statusText = "Pra Buka";
        } else if (
          (hour > 12 || (hour === 12 && minute > 0)) &&
          (hour < 13 || (hour === 13 && minute < 30))
        ) {
          statusText = "Istirahat";
        } else if (hour >= 15 || (hour === 15 && minute > 49)) {
          statusText = "Pasca Bursa";
        } else {
          statusText = "Market Closed";
        }
      }
      statusClass = "closed";
    }
  }

  res.json({
    isOpen: open,
    currentTime: now.format("HH:mm:ss"),
    day: now.format("dddd"),
    date: now.format("DD MMM YYYY"),
    statusText: statusText,
    statusClass: statusClass,
    holidayName: currentHolidayName,
  });
});

app.post("/api/save-subscription", async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Invalid subscription data" });
  }

  try {
    // Simpan ke MongoDB. Jika endpoint sudah ada, akan ditimpa (upsert)
    await SubscriptionModel.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      subscription,
      { upsert: true, returnDocument: 'after' }, // <-- PERUBAHAN di sini
    );

    console.log(`✅ Subscription berhasil disimpan permanen ke MongoDB.`);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Gagal menyimpan subscription ke DB:", error.message);
    res.status(500).json({ error: "Gagal menyimpan ke database server" });
  }
});

app.post("/api/send-push", async (req, res) => {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: "Title and body required" });
  }

  // --- PROTEKSI ANTI-SPAM (MENCEGAH DUPLIKAT DARI MULTI-CLIENT) ---
  const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");

  // Membuat kunci unik berdasarkan Judul dan Tanggal (Contoh: "SIGNALS SESI 1_2026-06-25")
  const pushKey = `${title.toUpperCase().trim()}_${today}`;

  // Jika backend sudah pernah menembakkan notifikasi dengan judul ini hari ini, abaikan request!
  if (sentPushesCache.has(pushKey)) {
    console.log(
      `[SPAM PROTECT] Blokir push duplikat: "${title}". Sudah dikirim hari ini.`,
    );
    return res.json({
      success: true,
      message:
        "Push sudah dikirim sebelumnya untuk sesi ini, dibatalkan untuk mencegah spam.",
    });
  }

  // Kunci sistem segera agar request dari client/tab lain yang masuk di milidetik yang sama langsung terblokir
  sentPushesCache.set(pushKey, true);
  // ----------------------------------------------------------------

  const payload = JSON.stringify({ title, body });

  // Tambahkan opsi pengiriman khusus agar handal di iOS & Android background
  const pushOptions = {
    TTL: 86400, // Waktu simpan di server push (1 hari)
    urgency: "high", // Memaksa iOS/Android langsung bangun di background
  };

  try {
    // Ambil seluruh data subscription aktif dari MongoDB
    const activeSubscriptions = await SubscriptionModel.find({});

    if (activeSubscriptions.length === 0) {
      // Jika kosong, hapus kunci cache agar bisa dicoba lagi nanti
      sentPushesCache.delete(pushKey);
      return res.json({
        success: true,
        message: "Tidak ada subscriber terdaftar.",
      });
    }

    const promises = activeSubscriptions.map((subscription) =>
      webpush
        .sendNotification(subscription, payload, pushOptions)
        .catch(async (err) => {
          console.error(
            "❌ Gagal kirim ke endpoint:",
            subscription.endpoint,
            "Motive:",
            err.message,
          );

          // Gunting/Hapus token dari MongoDB jika statusnya 410 (Gone) atau 404 (Not Found)
          if (err.statusCode === 410 || err.statusCode === 404) {
            await SubscriptionModel.deleteOne({
              endpoint: subscription.endpoint,
            });
            console.log(
              `🗑️ Membersihkan token mati dari DB: ${subscription.endpoint}`,
            );
          }
        }),
    );

    await Promise.all(promises);
    res.json({ success: true, sent: activeSubscriptions.length });
  } catch (error) {
    // Jika gagal total (misal VAPID error), hapus kunci cache agar sistem bisa mencoba ulang
    sentPushesCache.delete(pushKey);
    res.status(500).json({ error: error.message });
  }
});

// Helper IP publik untuk logging lokal
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
// 🚀 SERVER-SIDE WATCHDOG (BACKGROUND PUSH TRIGGER SUNGGUHAN)
// =========================================================================
let serverLastRunningIds = null;
let serverLastClosedIds = null;

// Helper untuk waktu sesi
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

// Helper untuk menembak push dari dalam server sendiri
async function triggerInternalPush(title, body) {
  const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
  const pushKey = `${title.toUpperCase().trim()}_${today}`;

  if (sentPushesCache.has(pushKey)) {
    console.log(`[WATCHDOG] Blokir spam harian: "${title}" sudah terkirim.`);
    return;
  }
  sentPushesCache.set(pushKey, true);

  const payload = JSON.stringify({ title, body });
  const pushOptions = { TTL: 86400, urgency: "high" };

  try {
    const activeSubscriptions = await SubscriptionModel.find({});
    if (activeSubscriptions.length === 0) {
      sentPushesCache.delete(pushKey);
      return;
    }

    const promises = activeSubscriptions.map((sub) =>
      webpush.sendNotification(sub, payload, pushOptions).catch(async (err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await SubscriptionModel.deleteOne({ endpoint: sub.endpoint });
        }
      }),
    );
    await Promise.all(promises);
    console.log(`✅ [WATCHDOG] BACKGROUND PUSH TERKIRIM: ${title}`);
  } catch (err) {
    sentPushesCache.delete(pushKey);
    console.error("❌ [WATCHDOG] Gagal kirim push:", err.message);
  }
}

// Fungsi utama yang berjalan mutlak di background server
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

    // Pencegah Spam Saat Server Restart
    if (serverLastRunningIds === null || serverLastClosedIds === null) {
      serverLastRunningIds = currentRunningIds;
      serverLastClosedIds = currentClosedIds;
      console.log(
        "🔄 [WATCHDOG] Server siap. Memantau sinyal saham di background 24/7...",
      );
      return;
    }

    const prevRunningArr = serverLastRunningIds
      ? serverLastRunningIds.split(",")
      : [];
    const currentRunningArr = currentRunningIds
      ? currentRunningIds.split(",")
      : [];
    const newRunning = currentRunningArr.filter(
      (id) => !prevRunningArr.includes(id),
    );

    // 1. CEK SINYAL BARU
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

      if (groups.session1.length > 0)
        triggerInternalPush(
          "NEW SIGNALS SESI 1",
          `${groups.session1.length} sinyal saham baru terdeteksi untuk SESI 1.`,
        );
      if (groups.session2.length > 0)
        triggerInternalPush(
          "NEW SIGNALS SESI 2",
          `${groups.session2.length} sinyal saham baru terdeteksi untuk SESI 2.`,
        );
      if (groups.bsjp.length > 0)
        triggerInternalPush(
          "NEW SIGNALS BSJP",
          `${groups.bsjp.length} sinyal saham baru terdeteksi untuk BSJP.`,
        );
      if (groups.other.length > 0)
        triggerInternalPush(
          "NEW SIGNALS LAINNYA",
          `${groups.other.length} sinyal saham baru terdeteksi.`,
        );
    }

    // 2. CEK SINYAL TAKE PROFIT
    const prevClosedArr = serverLastClosedIds
      ? serverLastClosedIds.split(",")
      : [];
    const currentClosedArr = currentClosedIds
      ? currentClosedIds.split(",")
      : [];
    const newClosed = currentClosedArr.filter(
      (id) => !prevClosedArr.includes(id),
    );

    if (newClosed.length > 0) {
      const closedSignals = closed.filter((s) =>
        newClosed.includes(`${s.stockCode}-${s.signalDate}`),
      );

      closedSignals.forEach((s) => {
        if (s.status === "TP") {
          const ret = s.returnPercent || 0;
          const sign = ret >= 0 ? "+" : "";
          const title = `✅ TP: ${s.stockCode}`;
          const body = `${s.stockCode} Take Profit ${sign}${ret.toFixed(2)}%`;

          triggerInternalPush(title, body); // Tembak langsung per-saham
        }
      });
    }

    // Update ingatan server
    serverLastRunningIds = currentRunningIds;
    serverLastClosedIds = currentClosedIds;
  } catch (err) {
    console.error("Gagal polling database internal:", err.message);
  }
}

// Jalankan pengecekan pertama kali saat server baru nyala
checkDatabaseForNewSignals();

// Jalankan Watchdog setiap 30 detik secara abadi di server
setInterval(checkDatabaseForNewSignals, 30000);
