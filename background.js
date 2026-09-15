// NexFetch — background.js
// Developer: MR. ARX (Arabi Islam) | Author: NexApp
//
// Responsibility: passively watch network traffic per-tab and detect
// video stream URLs (HLS .m3u8, DASH .mpd, direct mp4/webm/mkv).
// Detected streams are stored in chrome.storage.session, keyed by tabId,
// so the popup can read + display them on demand.

const STREAM_EXTENSIONS = /\.(m3u8|mpd|mp4|webm|mkv|mov|ts)(\?|$)/i;
const STREAM_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/dash+xml",
  "video/mp4",
  "video/webm",
  "video/x-matroska",
];

// tabId -> Map(url -> streamInfo)
const tabStreams = new Map();

function addStream(tabId, info) {
  if (!tabStreams.has(tabId)) tabStreams.set(tabId, new Map());
  const map = tabStreams.get(tabId);
  if (map.has(info.url)) return; // dedupe
  map.set(info.url, info);
  if (!info.pageOrigin) {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab?.url) return;
      try {
        info.pageOrigin = new URL(tab.url).origin;
        info.pageUrl = tab.url;
        persistTabStreams(tabId);
      } catch { /* ignore */ }
    });
  }
  persistTabStreams(tabId);
  updateBadge(tabId);
}

async function persistTabStreams(tabId) {
  const map = tabStreams.get(tabId);
  if (!map) return;
  await chrome.storage.session.set({
    [`streams_${tabId}`]: Array.from(map.values()),
  });
}

function updateBadge(tabId) {
  const count = tabStreams.get(tabId)?.size ?? 0;
  chrome.action.setBadgeText({
    tabId,
    text: count > 0 ? String(count) : "",
  });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#6C5CE7" });
}

// --- Detect by URL pattern (fast path) ---
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (STREAM_EXTENSIONS.test(details.url)) {
      addStream(details.tabId, {
        url: details.url,
        type: guessType(details.url),
        detectedAt: Date.now(),
        source: "url-pattern",
        pageOrigin: details.initiator || null,
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// --- Detect by response Content-Type (catches signed/obfuscated URLs) ---
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const ctHeader = details.responseHeaders?.find(
      (h) => h.name.toLowerCase() === "content-type"
    );
    const ct = ctHeader?.value?.toLowerCase() ?? "";
    if (STREAM_CONTENT_TYPES.some((t) => ct.includes(t))) {
      const clHeader = details.responseHeaders?.find(
        (h) => h.name.toLowerCase() === "content-length"
      );
      addStream(details.tabId, {
        url: details.url,
        type: ct.includes("mpegurl") ? "hls" : ct.includes("dash") ? "dash" : "direct",
        contentType: ct,
        contentLength: clHeader ? Number(clHeader.value) : null,
        detectedAt: Date.now(),
        source: "content-type",
        pageOrigin: details.initiator || null,
      });
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

function guessType(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return "hls";
  if (/\.mpd(\?|$)/i.test(url)) return "dash";
  return "direct";
}

// Clean up when a tab closes / navigates away
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStreams.delete(tabId);
  chrome.storage.session.remove(`streams_${tabId}`);
});

chrome.webNavigation.onCommitted?.addListener?.((details) => {
  if (details.frameId === 0) {
    tabStreams.delete(details.tabId);
    chrome.storage.session.remove(`streams_${details.tabId}`);
    updateBadge(details.tabId);
  }
});

// Message bridge for popup.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_STREAMS") {
    const map = tabStreams.get(msg.tabId);
    sendResponse({ streams: map ? Array.from(map.values()) : [] });
    return true;
  }
});
