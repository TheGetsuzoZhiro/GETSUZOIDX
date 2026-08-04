// Konfigurasi global
export const API_BASE = "/api";
export const SSE_URL = "/api/sse/prices";
export const VAPID_PUBLIC_KEY =
  "BCGyIOUseFBON2YXTAk-rcvncZ65jkbKqb2ShjOuvZhP08HLvaJJis5Bsx8ybuVVcZbXZow5GRrl9ykSiV0Y3B0";
export const NOTIF_KEY = "notificationHistory";

// Konstanta kategori berita
export const CATEGORY_MAP = {
  buyback: "BUY BACK AND BACKDOOR",
  akuisisi: "AKUISISI AND MERGER",
  private: "PRIVATE PLACEMENT",
  rightissue: "RIGHT ISSUE",
  dividen: "DIVIDEN",
  labarugi: "LABA RUGI",
  tender: "TENDER OFFER",
  net: "NET SELL AND NET BUY ASING",
  konglomerasi: "KONGLOMERASI",
  sentimen: "SENTIMEN LAINYA",
};

// Warna untuk fallback logo
export const COLORS = [
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

// SVG untuk status
export const HIT_SVG = `<img src="https://stockbit.com/assets/img/correct.png" alt="HIT" style="width:36px; height:36px; object-fit:contain; display:inline-block;">`;
export const MISSED_SVG = `<img src="https://stockbit.com/assets/img/missed.png" alt="MISSED" style="width:36px; height:36px; object-fit:contain; display:inline-block;">`;
export const HIT_SVG_ROW = `<img src="https://stockbit.com/assets/img/correct.png" alt="HIT" style="width:50px; height:50px; object-fit:contain; display:inline-block;">`;
export const MISSED_SVG_ROW = `<img src="https://stockbit.com/assets/img/missed.png" alt="MISSED" style="width:50px; height:50px; object-fit:contain; display:inline-block;">`;
