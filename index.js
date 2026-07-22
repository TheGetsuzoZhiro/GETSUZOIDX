const axios = require("axios");
const moment = require("moment-timezone");
const express = require("express");
const path = require("path");
const os = require("os");
const webpush = require("web-push");
const mongoose = require("mongoose");

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

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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
    // Ditambahkan .lean() agar mengembalikan plain JavaScript Object
    const subscriptions = await SubscriptionModel.find({}).lean();
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

let serverLastRunningIds = null;
let serverLastClosedIds = null;
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
    // Ditambahkan .lean() agar mengembalikan plain JavaScript Object
    const subscriptions = await SubscriptionModel.find({}).lean();
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

    const prevRunningArr = serverLastRunningIds.split(",");
    const currentRunningArr = currentRunningIds.split(",");
    const newRunning = currentRunningArr.filter(
      (id) => !prevRunningArr.includes(id),
    );

    if (newRunning.length > 0) {
      const newSignals = running.filter((s) =>
        newRunning.includes(`${s.stockCode}-${s.signalDate}`),
      );

      const bsjpSignals = newSignals.filter((s) => s.signalType === "BSJP");
      const technicalSignals = newSignals.filter(
        (s) => s.signalType === "TECHNICAL",
      );
      const regularSignals = newSignals.filter(
        (s) => s.signalType !== "BSJP" && s.signalType !== "TECHNICAL",
      );

      for (const s of bsjpSignals) {
        const title = `NEW BSJP: ${s.stockCode}`;
        const body = `Sinyal BSJP baru untuk ${s.stockCode}`;
        await triggerInternalPush(title, body);
      }

      for (const s of technicalSignals) {
        const title = `NEW TECHNICAL: ${s.stockCode}`;
        const body = `Sinyal Technical baru untuk ${s.stockCode}`;
        await triggerInternalPush(title, body);
      }

      const groups = { session1: [], session2: [], other: [] };
      regularSignals.forEach((s) => {
        const session = getSessionFromDate(s.signalDate);
        if (session === 1) groups.session1.push(s);
        else if (session === 2) groups.session2.push(s);
        else groups.other.push(s);
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
      if (groups.other.length)
        triggerInternalPush(
          "NEW SIGNALS LAINNYA",
          `${groups.other.length} sinyal saham baru.`,
        );
    }

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

checkDatabaseForNewSignals();
setInterval(checkDatabaseForNewSignals, 3000);
