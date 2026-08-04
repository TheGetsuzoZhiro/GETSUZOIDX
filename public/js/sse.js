import { SSE_URL } from "./config.js";

// ===== SSE REAL-TIME PRICE =====

let sseConnection = null;
let sseReconnectTimer = null;
export const localPrices = new Map();

let priceUpdateCallbacks = [];

export function onPriceUpdate(callback) {
  priceUpdateCallbacks.push(callback);
}

function notifyPriceUpdates(updates) {
  priceUpdateCallbacks.forEach((cb) => cb(updates));
}

export function connectPriceSSE() {
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }

  if (sseConnection) {
    sseConnection.close();
    sseConnection = null;
  }

  sseConnection = new EventSource(SSE_URL);

  sseConnection.onmessage = function (event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "price" && data.updates) {
        data.updates.forEach(({ symbol, price }) => {
          if (price != null) {
            localPrices.set(symbol, price);
          }
        });
        notifyPriceUpdates(data.updates);
      }
    } catch (e) {
      console.warn("SSE parse error:", e);
    }
  };

  sseConnection.onerror = function () {
    console.warn("SSE connection lost, reconnecting in 3s...");
    sseConnection.close();
    sseConnection = null;
    sseReconnectTimer = setTimeout(connectPriceSSE, 3000);
  };

  console.log("✅ SSE price stream connected");
}

export function disconnectSSE() {
  if (sseConnection) {
    sseConnection.close();
    sseConnection = null;
  }
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }
}

export function getLocalPrice(symbol) {
  return localPrices.get(symbol) || null;
}
