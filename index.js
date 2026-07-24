const axios = require("axios");
const moment = require("moment-timezone");
const express = require("express");
const path = require("path");
const os = require("os");
const mongoose = require("mongoose");

const infoCache = new Map();
const lastPrices = new Map();
const sseClients = [];

moment.tz.setDefault("Asia/Jakarta");

// ===== KONEKSI MONGODB =====
const MONGO_URI =
  "mongodb+srv://zhironihboss_db_user:tzPCYPLUNw0fWrTz@cluster0.bfs8tiy.mongodb.net/getsuzo_db?retryWrites=true&w=majority&appName=Cluster0";

mongoose
  .connect(MONGO_URI)
  .then(() =>
    console.log("✅ Berhasil terhubung ke MongoDB Atlas (Read-Only Mode)!"),
  )
  .catch((err) => console.error("❌ Gagal koneksi ke MongoDB:", err.message));

// ===== SCHEMA =====
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
    // tambahan untuk technical
    buyType: String,
    buyAreaLow: Number,
    buyAreaHigh: Number,
    stopLossPercent: Number,
    target1Low: Number,
    target1High: Number,
    target2Low: Number,
    target2High: Number,
    tp2: Number,
    notifiedBuyArea: Boolean,
    volumePercent: Number,
    breakEven: Boolean,
  },
  { versionKey: false },
);

// Model untuk collection aktif (hanya sinyal yang belum closed)
const SignalModel = mongoose.model("Signal", SignalSchema, "signals");

// Model untuk subscription push
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

// Model untuk token Stockbit
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

// ===== FUNGSI BANTU =====
async function getStockbitToken() {
  try {
    const doc = await TokenModel.findById("stockbit_token");
    if (doc && doc.token) {
      let token = doc.token.trim();
      if (!token.startsWith("Bearer ")) {
        token = `Bearer ${token}`;
      }
      return token;
    }
    return null;
  } catch (err) {
    console.error("❌ Gagal ambil token Stockbit:", err.message);
    return null;
  }
}

// ===== CEK HARI LIBUR & MARKET =====
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

// ===== EXPRESS APP =====
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== SSE PRICE STREAM =====
app.get("/api/sse/prices", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.push(client);

  if (lastPrices.size > 0) {
    const updates = Array.from(lastPrices.values());
    const payload = JSON.stringify({ type: "price", updates });
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (e) {}
  }

  req.on("close", () => {
    const idx = sseClients.indexOf(client);
    if (idx > -1) sseClients.splice(idx, 1);
  });
});

app.post("/api/sse/price-update", (req, res) => {
  const { updates } = req.body;
  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: "Invalid updates" });
  }

  updates.forEach((u) => {
    if (u.symbol && u.price != null) {
      lastPrices.set(u.symbol, u);
    }
  });

  const payload = JSON.stringify({ type: "price", updates });
  sseClients.forEach((client) => {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (e) {
      const idx = sseClients.indexOf(client);
      if (idx > -1) sseClients.splice(idx, 1);
    }
  });

  res.json({ success: true, clients: sseClients.length });
});

// ===== STOCK INFO =====
app.get("/api/stock-info/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  if (infoCache.has(symbol)) {
    return res.json(infoCache.get(symbol));
  }

  const token = await getStockbitToken();
  if (!token) {
    const fallback = {
      symbol,
      longName: symbol,
      logoUrl: `https://assets.stockbit.com/logos/companies/${symbol}.png`,
    };
    infoCache.set(symbol, fallback);
    return res.json(fallback);
  }

  try {
    const url = `https://exodus.stockbit.com/emitten/${symbol}/info`;
    const response = await axios.get(url, {
      headers: {
        Authorization: token,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
        Origin: "https://pro.stockbit.com",
        Referer: "https://pro.stockbit.com/",
      },
      timeout: 10000,
    });

    const data = response.data?.data;
    let longName = symbol;
    if (data && data.name) {
      longName = data.name;
    }

    const result = {
      symbol,
      longName,
      logoUrl: `https://assets.stockbit.com/logos/companies/${symbol}.png`,
    };

    infoCache.set(symbol, result);
    res.json(result);
  } catch (err) {
    console.warn(
      `[STOCKBIT] Gagal ambil info ${symbol}:`,
      err.response?.status || err.message,
    );

    const fallback = {
      symbol,
      longName: symbol,
      logoUrl: `https://assets.stockbit.com/logos/companies/${symbol}.png`,
    };
    infoCache.set(symbol, fallback);
    res.json(fallback);
  }
});

// ===== ENDPOINT SIGNALS (DENGAN ARCHIVE) =====
app.get("/api/signals", async (req, res) => {
  try {
    // Ambil sinyal aktif (status RUNNING, TRAILING, WAITING_ENTRY)
    const activeSignals = await SignalModel.find({
      status: { $in: ["RUNNING", "TRAILING", "WAITING_ENTRY"] },
    });

    // Ambil archive bulan berjalan untuk sinyal closed
    const currentMonth = moment().tz("Asia/Jakarta").format("YYYY_MM");
    let closedSignals = [];
    try {
      const ArchiveModel = mongoose.model(
        `signals_${currentMonth}`,
        SignalSchema,
        `signals_${currentMonth}`,
      );
      closedSignals = await ArchiveModel.find({
        status: { $in: ["TP", "SL", "EXPIRED"] },
      });
    } catch (err) {
      // Jika archive bulan ini belum ada, abaikan
      console.log(`ℹ️ Archive untuk bulan ${currentMonth} belum tersedia.`);
    }

    // Gabungkan: running = aktif, closed = dari archive
    res.json({
      running: activeSignals,
      closed: closedSignals,
    });
  } catch (error) {
    console.error("❌ Gagal fetch signals:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// (Opsional) Endpoint untuk mengambil archive bulan tertentu
app.get("/api/history/:month", async (req, res) => {
  const month = req.params.month; // format YYYY_MM
  try {
    const ArchiveModel = mongoose.model(
      `signals_${month}`,
      SignalSchema,
      `signals_${month}`,
    );
    const data = await ArchiveModel.find({});
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: "Archive not found" });
  }
});

// ===== MARKET STATUS =====
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

// ===== PUSH SUBSCRIPTION =====
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

// ===== ROOT =====
app.get("/", (req, res) => {
  res.send("Frontend Server Berjalan!");
});

// ===== START SERVER =====
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

app.listen(PORT, "0.0.0.0", async () => {
  const ip = await getPublicIP();
  console.log(`\n🌐 Frontend API server available at:`);
  console.log(`   • http://localhost:${PORT}`);
  console.log(`   • http://${ip}:${PORT}`);
  console.log(`\n✅ Read-Only Server running on Port: ${PORT}`);
});
