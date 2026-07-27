TOLONG PERBAIKI KDOE INI DIA UNTUK NOTIF TAKE PROFIT DAN NOTIF NEW SIGNLAS NYA DUPLIKAT SEND 2X BUAT AGAR ANTI DUPLIKAT GIMANA APAKAH BISA? BUAT ANTI DUPLIKAT

const axios = require("axios");
const moment = require("moment-timezone");
const express = require("express");
const path = require("path");
const os = require("os");
const webpush = require("web-push");
const mongoose = require("mongoose");
const compression = require("compression");

const sentPushesCache = new Map();
const infoCache = new Map();
const lastPrices = new Map();
const sseClients = [];

moment.tz.setDefault("Asia/Jakarta");

const vapidPublicKey =
  "BCGyIOUseFBON2YXTAk-rcvncZ65jkbKqb2ShjOuvZhP08HLvaJJis5Bsx8ybuVVcZbXZow5GRrl9ykSiV0Y3B0";
const vapidPrivateKey = "7PHNRENDWCkDl7JwoVYayqJDBkvSbzwZ2vxz1Cx7bSI";
webpush.setVapidDetails(
  "mailto:radityayoga187@gmail.com",
  vapidPublicKey,
  vapidPrivateKey,
);

const MONGO_URI =
  "mongodb+srv://zhironihboss_db_user:tzPCYPLUNw0fWrTz@cluster0.bfs8tiy.mongodb.net/getsuzo_db?retryWrites=true&w=majority&appName=Cluster0";

mongoose
  .connect(MONGO_URI)
  .then(() =>
    console.log("✅ Berhasil terhubung ke MongoDB Atlas (Read-Only Mode)!"),
  )
  .catch((err) => console.error("❌ Gagal koneksi ke MongoDB:", err.message));

const NotifLogSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now, expires: "7d" },
  },
  { versionKey: false },
);
const NotifLogModel = mongoose.model("NotifLog", NotifLogSchema, "notif_logs");

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
  },
  { versionKey: false },
);

SignalSchema.index({ status: 1 });
SignalSchema.index({ stockCode: 1, signalDate: 1 });
SignalSchema.index({ signalType: 1, status: 1 });

const SignalModel = mongoose.model("Signal", SignalSchema, "signals");

const NewsSchema = new mongoose.Schema(
  {
    link: { type: String, required: true, unique: true },
    category: { type: String, required: true },
    stockCodes: [String],
    title: String,
    description: String,
    imageUrl: String,
    publishedAt: Date,
  },
  { versionKey: false },
);

NewsSchema.index({ stockCodes: 1, publishedAt: -1 });
NewsSchema.index({ category: 1, publishedAt: -1 });
NewsSchema.index({ publishedAt: -1 });

const NewsModel = mongoose.model("News", NewsSchema, "news");

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

async function getStockbitToken() {
  try {
    const doc = await TokenModel.findById("stockbit_token").lean();
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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  compression({
    level: 6,
    filter: (req, res) => {
      if (
        req.headers["accept"] === "text/event-stream" ||
        req.path.includes("/sse")
      ) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/sse/prices", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.push(client);

  if (lastPrices.size > 0) {
    const updates = Array.from(lastPrices.values());
    const payload = JSON.stringify({ type: "price", updates });
    try {
      res.write(`data: ${payload}\n\n`);
      if (typeof res.flush === "function") res.flush();
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
    const sym = u.symbol || u.stockCode;
    if (sym && u.price != null) {
      const normalizedUpdate = {
        symbol: sym,
        stockCode: sym,
        price: u.price,
        change: u.change || 0,
        changePercent: u.changePercent || 0,
      };
      lastPrices.set(sym, normalizedUpdate);
    }
  });

  const payload = JSON.stringify({ type: "price", updates });

  for (let i = sseClients.length - 1; i >= 0; i--) {
    const client = sseClients[i];
    try {
      client.res.write(`data: ${payload}\n\n`);
      if (typeof client.res.flush === "function") {
        client.res.flush();
      }
    } catch (e) {
      sseClients.splice(i, 1);
    }
  }

  res.json({ success: true, clients: sseClients.length });
});

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

let cachedSignalsJsonString = null;
let cachedSignalsEtag = null;
let isRefreshingSignalsCache = false;

async function fetchAndSerializeSignals() {
  if (isRefreshingSignalsCache) return;
  isRefreshingSignalsCache = true;
  try {
    const allSignals = await SignalModel.find({}).lean();
    const running = [];
    const closed = [];

    for (let i = 0; i < allSignals.length; i++) {
      if (allSignals[i].status === "RUNNING") {
        running.push(allSignals[i]);
      } else {
        closed.push(allSignals[i]);
      }
    }

    cachedSignalsJsonString = JSON.stringify({ running, closed });
    cachedSignalsEtag = `W/"sig-${Date.now()}"`;

    return { allSignals, running, closed };
  } catch (err) {
    console.error("❌ [CACHE SIGNALS] Gagal memperbarui cache:", err.message);
    return null;
  } finally {
    isRefreshingSignalsCache = false;
  }
}

app.get("/api/signals", async (req, res) => {
  try {
    if (!cachedSignalsJsonString) {
      await fetchAndSerializeSignals();
    }

    if (req.headers["if-none-match"] === cachedSignalsEtag) {
      return res.status(304).end();
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("ETag", cachedSignalsEtag);
    res.setHeader(
      "Cache-Control",
      "public, max-age=15, stale-while-revalidate=15",
    );
    res.setHeader("X-Cache", "HIT-PRESERIALIZED-RAM");

    return res.send(cachedSignalsJsonString);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

let cachedNewsJsonString = null;
let cachedNewsEtag = null;
let isRefreshingNewsCache = false;

async function fetchAndSerializeNews() {
  if (isRefreshingNewsCache) return;
  isRefreshingNewsCache = true;
  try {
    const news = await NewsModel.find({})
      .select("link category stockCodes title description imageUrl publishedAt")
      .sort({ publishedAt: -1 })
      .limit(50)
      .lean();

    cachedNewsJsonString = JSON.stringify(news);
    cachedNewsEtag = `W/"news-${Date.now()}"`;
    return news;
  } catch (err) {
    console.error(
      "❌ [CACHE NEWS] Gagal memperbarui cache berita:",
      err.message,
    );
    return null;
  } finally {
    isRefreshingNewsCache = false;
  }
}

app.get("/api/news", async (req, res) => {
  try {
    const { stockCode, category, limit, page } = req.query;

    const isDefaultFeed =
      !stockCode &&
      !category &&
      (!page || parseInt(page) === 1) &&
      (!limit || parseInt(limit) <= 50);

    if (isDefaultFeed) {
      if (!cachedNewsJsonString) {
        await fetchAndSerializeNews();
      }

      if (req.headers["if-none-match"] === cachedNewsEtag) {
        return res.status(304).end();
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader("ETag", cachedNewsEtag);
      res.setHeader(
        "Cache-Control",
        "public, max-age=10, stale-while-revalidate=20",
      );
      res.setHeader("X-Cache", "HIT-PRESERIALIZED-RAM");

      return res.send(cachedNewsJsonString);
    }

    const filter = {};
    if (stockCode) filter.stockCodes = stockCode.toUpperCase();
    if (category) filter.category = category.toUpperCase();

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    res.setHeader(
      "Cache-Control",
      "public, max-age=10, stale-while-revalidate=20",
    );

    if (page && limit) {
      const [totalItems, news] = await Promise.all([
        NewsModel.countDocuments(filter),
        NewsModel.find(filter)
          .select(
            "link category stockCodes title description imageUrl publishedAt",
          )
          .sort({ publishedAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
      ]);

      return res.json({
        data: news,
        pagination: {
          totalItems,
          totalPages: Math.ceil(totalItems / limitNum),
          currentPage: pageNum,
          limit: limitNum,
        },
      });
    }

    const news = await NewsModel.find(filter)
      .select("link category stockCodes title description imageUrl publishedAt")
      .sort({ publishedAt: -1 })
      .limit(limitNum > 0 ? limitNum : 50)
      .lean();

    res.json(news);
  } catch (error) {
    console.error("❌ [NEWS API] Gagal ambil data:", error.message);
    res.status(500).json({ error: error.message });
  }
});

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

app.post("/api/send-push", async (req, res) => {
  const { title, body, stockCode, icon, image } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: "Title and body required" });
  }
  const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
  const pushKey = `${title.toUpperCase().trim()}_${today}`;

  try {
    await NotifLogModel.create({ key: pushKey });
  } catch (e) {
    console.log(`[SPAM] Blokir duplikat (DB Lock): "${title}"`);
    return res.json({ success: true, message: "Sudah dikirim hari ini" });
  }

  // Tentukan logo saham otomatis
  let finalIcon = icon;
  if (!finalIcon && stockCode) {
    finalIcon = `https://assets.stockbit.com/logos/companies/${stockCode.toUpperCase()}.png`;
  }
  if (!finalIcon) {
    finalIcon = "https://getsuzo-idx.onrender.com/icon-192.png";
  }

  const payload = JSON.stringify({
    title,
    body,
    icon: finalIcon,
    image: image || null,
    data: { url: "/" },
  });
  const pushOptions = { TTL: 86400, urgency: "high" };

  try {
    const subscriptions = await SubscriptionModel.find({}).lean();
    if (subscriptions.length === 0) {
      return res.json({ success: true, message: "Tidak ada subscriber" });
    }

    const uniqueSubs = Array.from(
      new Map(subscriptions.map((s) => [s.endpoint, s])).values(),
    );

    const promises = uniqueSubs.map((sub) =>
      webpush.sendNotification(sub, payload, pushOptions).catch(async (err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await SubscriptionModel.deleteOne({ endpoint: sub.endpoint });
        }
      }),
    );
    await Promise.all(promises);
    res.json({ success: true, sent: uniqueSubs.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

const serverLastStatus = new Map();
let isWatchdogInitialized = false;

let serverLastNewsLinks = null;
let isCheckingSignals = false;
let isCheckingNews = false;

function cleanupCacheSet(setInstance, maxSize = 1000) {
  if (setInstance.size > maxSize) {
    const items = Array.from(setInstance);
    const toRemove = items.slice(0, items.length - maxSize);
    toRemove.forEach((item) => setInstance.delete(item));
  }
}

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

// =============== FUNGSI TRIGGER INTERNAL PUSH (LOGI DENGAN DYNAMIC STOCK LOGO) ===============
async function triggerInternalPush(title, body, customPushKey = null, options = {}) {
  const { skipInsert = false, stockCode = null, icon = null, image = null, url = "/" } = options;
  const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
  const pushKey = customPushKey || `${title.toUpperCase().trim()}_${today}`;

  // Jika tidak skipInsert, coba insert ke database untuk cegah spam
  if (!skipInsert) {
    try {
      await NotifLogModel.create({ key: pushKey });
    } catch (e) {
      console.log(`[WATCHDOG] Blokir spam / duplikat (DB Lock): "${pushKey}"`);
      return;
    }
  }

  // Tentukan logo emiten dari CDN Stockbit
  let finalIcon = icon;
  if (!finalIcon && stockCode) {
    finalIcon = `https://assets.stockbit.com/logos/companies/${stockCode.toUpperCase()}.png`;
  }
  if (!finalIcon) {
    finalIcon = "https://getsuzo-idx.onrender.com/icon-192.png";
  }

  const payload = JSON.stringify({
    title,
    body,
    icon: finalIcon,
    image: image || null,
    data: { url },
  });

  const pushOptions = { TTL: 86400, urgency: "high" };
  try {
    const subscriptions = await SubscriptionModel.find({}).lean();
    if (subscriptions.length === 0) return;

    const uniqueSubs = Array.from(
      new Map(subscriptions.map((s) => [s.endpoint, s])).values(),
    );

    const promises = uniqueSubs.map((sub) =>
      webpush.sendNotification(sub, payload, pushOptions).catch(async (err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await SubscriptionModel.deleteOne({ endpoint: sub.endpoint });
        }
      }),
    );
    await Promise.all(promises);
    console.log(`✅ [WATCHDOG] PUSH TERKIRIM (+Logo): ${title}`);
  } catch (err) {
    console.error("❌ [WATCHDOG] Gagal kirim push:", err.message);
  }
}

async function checkDatabaseForNewSignals() {
  if (isCheckingSignals) return;
  isCheckingSignals = true;

  try {
    const result = await fetchAndSerializeSignals();
    if (!result) return;

    const { allSignals } = result;
    const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");

    if (!isWatchdogInitialized) {
      allSignals.forEach((s) => {
        const key = `${s._id.toString()}`;
        serverLastStatus.set(key, s.status);
      });
      isWatchdogInitialized = true;
      console.log(
        "🔄 [WATCHDOG SINYAL] Server siap. Memantau sinyal saham 24/7...",
      );
      return;
    }

    for (const s of allSignals) {
      const docId = s._id.toString();
      const prevStatus = serverLastStatus.get(docId);
      const stockCode = s.stockCode ? s.stockCode.toUpperCase() : null;

      if (prevStatus === undefined) {
        serverLastStatus.set(docId, s.status);

        // -------------------- SINYAL BARU (belum pernah terlihat) --------------------
        if (s.signalType === "TECHNICAL") {
          const title = `NEW TECHNICAL: ${s.stockCode}`;
          const body = `Sinyal Technical baru untuk ${s.stockCode}`;
          const customPushKey = `TECH_NEW_${docId}`;
          await triggerInternalPush(title, body, customPushKey, { stockCode });
        } else if (s.signalType === "BSJP") {
          if (s.status === "RUNNING") {
            const title = `NEW BSJP: ${s.stockCode}`;
            const body = `Sinyal BSJP baru untuk ${s.stockCode}`;
            const customPushKey = `BSJP_NEW_${docId}`;
            await triggerInternalPush(title, body, customPushKey, { stockCode });
          }
        } else {
          // SINYAL BIASA
          if (s.status === "RUNNING") {
            const session = getSessionFromDate(s.signalDate);
            if (session === 1 || session === 2) {
              const key = `SIGNAL_SESSION_${session}_${today}`;
              try {
                await NotifLogModel.create({ key });
                const title = `NEW SIGNALS SESI ${session}`;
                const body = `Sinyal baru untuk sesi ${session}`;
                await triggerInternalPush(title, body, key, {
                  skipInsert: true,
                  stockCode,
                });
              } catch (e) {
                console.log(`[WATCHDOG] Notifikasi sesi ${session} sudah dikirim hari ini.`);
              }
            } else {
              const title = `NEW SIGNALS LAINNYA`;
              const body = `Sinyal baru untuk ${s.stockCode}`;
              const customPushKey = `REG_NEW_${docId}`;
              await triggerInternalPush(title, body, customPushKey, { stockCode });
            }
          }
        }
      } else if (prevStatus !== s.status) {
        serverLastStatus.set(docId, s.status);

        // -------------------- PERUBAHAN STATUS (contoh: TP) --------------------
        if (s.status === "TP" && prevStatus !== "TP") {
          const ret = s.returnPercent || 0;
          const sign = ret >= 0 ? "+" : "";
          const title = `✅ TP: ${s.stockCode}`;
          const body = `${s.stockCode} Take Profit ${sign}${ret.toFixed(2)}%`;
          const customPushKey = `TP_DONE_${docId}`;
          await triggerInternalPush(title, body, customPushKey, { stockCode });
        }
      }
    }
  } catch (err) {
    console.error("❌ [WATCHDOG SINYAL] Gagal polling database:", err.message);
  } finally {
    isCheckingSignals = false;
  }
}

async function checkDatabaseForNews() {
  if (isCheckingNews) return;
  isCheckingNews = true;

  try {
    await fetchAndSerializeNews();

    const recentNews = await NewsModel.find({})
      .select("link category stockCodes title description imageUrl publishedAt")
      .sort({ publishedAt: -1 })
      .limit(100)
      .lean();

    if (serverLastNewsLinks === null) {
      serverLastNewsLinks = new Set(recentNews.map((n) => n.link));
      console.log(
        "🔄 [WATCHDOG BERITA] Inisialisasi awal berita selesai. Memantau berita baru...",
      );
      return;
    }

    const newNewsItems = recentNews.filter(
      (n) => !serverLastNewsLinks.has(n.link),
    );

    if (newNewsItems.length > 0) {
      const activeSignals = await SignalModel.find({
        status: { $in: ["RUNNING", "WAITING_ENTRY", "TRAILING"] },
        $or: [
          { closeDate: { $exists: false } },
          { closeDate: null },
          { closeDate: "" },
        ],
      })
        .select("stockCode status closeDate")
        .lean();

      const activeStockCodes = new Set(
        activeSignals
          .map((s) => (s.stockCode ? s.stockCode.toUpperCase() : null))
          .filter(Boolean),
      );

      const sortedNews = [...newNewsItems].reverse();

      for (const news of sortedNews) {
        serverLastNewsLinks.add(news.link);

        const newsStocks = (news.stockCodes || [])
          .map((code) => code.toUpperCase())
          .filter(Boolean);

        const matchedActiveStocks = newsStocks.filter((code) =>
          activeStockCodes.has(code),
        );
        const hasActiveSignalMatch = matchedActiveStocks.length > 0;

        const category = news.category || "BERITA";
        const stockStr =
          newsStocks.length > 0 ? newsStocks.join(", ") : "GENERAL";

        let title = `${category}: ${stockStr}`;
        title = hasActiveSignalMatch ? `🔥 ${title}` : `📰 ${title}`;

        let body = news.description || "Ada berita pasar baru.";
        if (body.length > 200) {
          body = body.substring(0, 197) + "...";
        }

        const primaryStockCode = newsStocks.length > 0 ? newsStocks[0] : null;

        const customPushKey = `NEWS_PUSH_${news.link}`;
        await triggerInternalPush(title, body, customPushKey, {
          stockCode: primaryStockCode,
          image: news.imageUrl || null,
        });
      }

      cleanupCacheSet(serverLastNewsLinks, 1000);
    }
  } catch (err) {
    console.error("❌ [WATCHDOG BERITA] Gagal polling berita:", err.message);
  } finally {
    isCheckingNews = false;
  }
}

checkDatabaseForNewSignals();
checkDatabaseForNews();

setInterval(() => {
  checkDatabaseForNewSignals();
  checkDatabaseForNews();
}, 10000);
