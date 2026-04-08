/**
 * Time Champ Chrome Extension — background service worker
 *
 * Connects to the native messaging host "com.timechamp.agent" and forwards
 * the active tab URL whenever the user switches tabs or navigates.
 * The native host relays this back to the main agent process via a local
 * Unix domain socket / named pipe.
 */

const NATIVE_HOST = "com.timechamp.agent";

let port = null;
let reconnectTimer = null;

// ── Connection management ────────────────────────────────────────────────────

function connect() {
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);

    port.onMessage.addListener((msg) => {
      // Ack from native host (optional).
      console.debug("[TC] native host says:", msg);
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      console.warn("[TC] native host disconnected:", err?.message);
      port = null;
      scheduleReconnect();
    });

    console.log("[TC] connected to native host");
    sendCurrentTab(); // send immediately on connect
  } catch (e) {
    console.warn("[TC] connectNative failed:", e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

function send(message) {
  if (!port) {
    connect();
    return;
  }
  try {
    port.postMessage(message);
  } catch (e) {
    console.warn("[TC] postMessage error:", e);
    port = null;
    scheduleReconnect();
  }
}

// ── URL reporting ────────────────────────────────────────────────────────────

async function getActiveTabURL() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url ?? "";
  } catch {
    return "";
  }
}

async function sendCurrentTab() {
  const url = await getActiveTabURL();
  if (url && !url.startsWith("chrome://") && !url.startsWith("chrome-extension://")) {
    send({ type: "url", url });
  }
}

// ── Event listeners ─────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(() => sendCurrentTab());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") sendCurrentTab();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) sendCurrentTab();
});

// ── Bootstrap ────────────────────────────────────────────────────────────────
connect();
