// NexFetch — download.js (v3)
// Adds: UI wiring for the redesigned page (speed pill = concurrency,
// auto-start toggle, editable filename), and bounded-concurrency segment
// fetching (fetch up to N segments in parallel, but always WRITE them to
// disk in strict order — out-of-order network completions are buffered
// until their turn comes up). Everything from v2 (OPFS assembly + native
// chrome.downloads save with no picker, skip-on-failure, inter-request
// pacing) is unchanged.

const REFERER_RULE_ID = 90210;

// Extension-context fetches don't carry the site's normal Referer/Origin,
// which many video CDNs (BunnyCDN etc.) check before serving segments —
// that's the real cause of the HTTP 401 bursts. This rule rewrites those
// headers to match the page the stream was actually detected on, for the
// duration of this download only.
async function applyRefererSpoof(pageOrigin, targetUrl) {
  if (!pageOrigin) return;
  try {
    const host = new URL(targetUrl).hostname;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [REFERER_RULE_ID],
      addRules: [
        {
          id: REFERER_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Referer", operation: "set", value: pageOrigin + "/" },
              { header: "Origin", operation: "set", value: pageOrigin },
            ],
          },
          condition: { urlFilter: `||${host}`, resourceTypes: ["xmlhttprequest"] },
        },
      ],
    });
    log(`Spoofing Referer as ${pageOrigin} for ${host}`);
  } catch (err) {
    log(`⚠️ Could not apply Referer fix: ${err.message}`);
  }
}

async function clearRefererSpoof() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [REFERER_RULE_ID] });
  } catch { /* ignore */ }
}

const params = new URL(location.href).searchParams;
const stream = JSON.parse(params.get("stream") || "{}");

const titleEl = document.getElementById("title");
const thumbEl = document.getElementById("thumb");
const badgeRowEl = document.getElementById("badgeRow");
const fillEl = document.getElementById("fill");
const pctEl = document.getElementById("pct");
const speedStatEl = document.getElementById("speedStat");
const etaEl = document.getElementById("eta");
const logEl = document.getElementById("log");
const logPanel = document.getElementById("logPanel");
const logToggle = document.getElementById("logToggle");
const logCopy = document.getElementById("logCopy");
const speedGroup = document.getElementById("speedGroup");
const autoStartPill = document.getElementById("autoStartPill");
const autoSavePill = document.getElementById("autoSavePill");
const filenameInput = document.getElementById("filenameInput");
const filenameExt = document.getElementById("filenameExt");
const startBtn = document.getElementById("startBtn");

let concurrency = 4; // 2x default now means 4 parallel connections
let autoStart = true;

logToggle.addEventListener("click", () => logPanel.classList.toggle("open"));
logCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(logEl.textContent);
  logCopy.textContent = "Copied";
  setTimeout(() => (logCopy.textContent = "Copy"), 1200);
});

// Speed pill now maps to actual parallel-connection counts, not a cosmetic label.
const SPEED_TO_CONCURRENCY = { 1: 2, 2: 4, 3: 8 };
speedGroup.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-speed]");
  if (!btn) return;
  concurrency = SPEED_TO_CONCURRENCY[Number(btn.dataset.speed)];
  [...speedGroup.querySelectorAll("button")].forEach((b) => b.classList.toggle("active", b === btn));
});

autoStartPill.addEventListener("click", () => {
  autoStart = !autoStart;
  autoStartPill.classList.toggle("on", autoStart);
});
autoSavePill.addEventListener("click", () => autoSavePill.classList.toggle("on"));

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  logEl.textContent += line;
  logEl.scrollTop = logEl.scrollHeight;
}

function addBadge(text, accent = false) {
  const span = document.createElement("span");
  span.className = accent ? "badge accent" : "badge";
  span.textContent = text;
  badgeRowEl.appendChild(span);
}

function baseFileName(s) {
  try {
    const u = new URL(s.url);
    return u.pathname.split("/").pop().split(".")[0] || "video";
  } catch {
    return "video";
  }
}

// --- Initial UI fill ---
titleEl.textContent = stream.title || baseFileName(stream);
addBadge(stream.type.toUpperCase(), true);
if (stream.label) addBadge(stream.label);
filenameInput.value = baseFileName(stream) + (stream.label ? `-${stream.label}` : "");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function saveBlobViaChromeDownloads(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  chrome.downloads.download({ url: objectUrl, filename, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError) {
      log(`❌ Save failed: ${chrome.runtime.lastError.message}`);
      return;
    }
    const listener = (delta) => {
      if (delta.id === downloadId && delta.state?.current) {
        if (delta.state.current === "complete" || delta.state.current === "interrupted") {
          URL.revokeObjectURL(objectUrl);
          chrome.downloads.onChanged.removeListener(listener);
        }
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

async function runDownload() {
  startBtn.disabled = true;
  startBtn.textContent = "Downloading…";
  const filename = `${filenameInput.value || "video"}${filenameExt.textContent}`;

  try {
    if (stream.type !== "hls") {
      log("Direct file — handing off to the browser's downloader.");
      chrome.downloads.download({ url: stream.url, filename, saveAs: false });
      titleEl.textContent = titleEl.textContent + " — started";
      fillEl.style.width = "100%";
      pctEl.textContent = "Started";
      startBtn.textContent = "Started";
      return;
    }
    await downloadHLS(stream.url, filename);
    startBtn.textContent = "Done";
  } catch (err) {
    log(`❌ Error: ${err.message}`);
    await clearRefererSpoof();
    startBtn.disabled = false;
    startBtn.textContent = "Retry";
  }
}

startBtn.addEventListener("click", runDownload);
if (autoStart) runDownload();

async function downloadHLS(playlistUrl, filename) {
  await applyRefererSpoof(stream.pageOrigin, playlistUrl);

  let res = await fetch(playlistUrl);
  if (!res.ok) {
    await clearRefererSpoof();
    throw new Error(`Playlist fetch failed: HTTP ${res.status}. The link may need a fresh page reload.`);
  }
  let text = await res.text();

  if (text.includes("#EXT-X-STREAM-INF")) {
    playlistUrl = pickBestVariant(text, playlistUrl);
    log(`Master playlist — using: ${playlistUrl}`);
    res = await fetch(playlistUrl);
    if (!res.ok) {
      await clearRefererSpoof();
      throw new Error(`Variant playlist fetch failed: HTTP ${res.status}.`);
    }
    text = await res.text();
  }

  const base = new URL(playlistUrl);
  const lines = text.split("\n").map((l) => l.trim());

  const opfsRoot = await navigator.storage.getDirectory();
  const tmpHandle = await opfsRoot.getFileHandle(`nexfetch_${Date.now()}.tmp`, { create: true });
  const writable = await tmpHandle.createWritable();

  const mapLine = lines.find((l) => l.startsWith("#EXT-X-MAP"));
  if (mapLine) {
    const uriMatch = mapLine.match(/URI="([^"]+)"/);
    if (uriMatch) {
      const initUrl = new URL(uriMatch[1], base).toString();
      log("Writing init segment…");
      const initBuf = await fetchSegmentWithRetry(initUrl);
      await writable.write(initBuf);
    }
  }

  const segmentUrls = lines
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => new URL(l, base).toString());

  if (!segmentUrls.length) throw new Error("No segments found in playlist.");

  const total = segmentUrls.length;
  const startTime = Date.now();
  let skipped = 0;
  let nextToWrite = 0;
  const completed = new Map(); // index -> ArrayBuffer|null (null = skipped/failed)
  let cursor = 0;
  let consecutiveFailures = 0;
  let stopEarly = false;
  const FAILURE_STOP_THRESHOLD = 15;

  async function worker() {
    while (cursor < total && !stopEarly) {
      const idx = cursor++;
      let buf = null;
      try {
        buf = await fetchSegmentWithRetry(segmentUrls[idx]);
        consecutiveFailures = 0;
      } catch (err) {
        skipped++;
        consecutiveFailures++;
        log(`⚠️ Skipped segment ${idx + 1}/${total}: ${err.message}`);
        if (consecutiveFailures >= FAILURE_STOP_THRESHOLD && !stopEarly) {
          stopEarly = true;
          log(`⛔ ${FAILURE_STOP_THRESHOLD} segments failed in a row — the source link has likely expired. Reopen the video page and click Download again for a fresh link.`);
        }
      }
      completed.set(idx, buf);

      // Drain any segments that are now writable in order.
      while (completed.has(nextToWrite)) {
        const data = completed.get(nextToWrite);
        completed.delete(nextToWrite);
        if (data) await writable.write(data);
        nextToWrite++;
        updateProgress(nextToWrite, total, startTime);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  // Flush whatever made it into the buffer before we stopped (early-stop safety net).
  while (completed.has(nextToWrite)) {
    const data = completed.get(nextToWrite);
    completed.delete(nextToWrite);
    if (data) await writable.write(data);
    nextToWrite++;
  }
  if (stopEarly && nextToWrite < total) {
    skipped += total - nextToWrite; // remaining segments never attempted
  }

  await writable.close();
  await clearRefererSpoof();

  const file = await tmpHandle.getFile();
  saveBlobViaChromeDownloads(file, filename);
  await opfsRoot.removeEntry(tmpHandle.name).catch(() => {});

  if (skipped > 0) {
    log(`✅ Done — ${skipped}/${total} segments were skipped (small gaps possible).`);
    titleEl.textContent = titleEl.textContent + ` — complete (${skipped} skipped)`;
  } else {
    log("✅ Done. No segments skipped.");
    titleEl.textContent = titleEl.textContent + " — complete";
  }
}

async function fetchSegmentWithRetry(url, retries = 4) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const expected = Number(res.headers.get("content-length"));
      if (expected && buf.byteLength !== expected) {
        throw new Error(`size mismatch (${buf.byteLength}/${expected})`);
      }
      return buf;
    } catch (err) {
      attempt++;
      if (attempt >= retries) throw new Error(`failed after ${retries} tries (${err.message})`);
      await sleep(400 * attempt);
    }
  }
}

function pickBestVariant(masterText, masterUrl) {
  const lines = masterText.split("\n");
  let bestBandwidth = -1;
  let bestUri = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
      const bw = bwMatch ? Number(bwMatch[1]) : 0;
      const uri = lines[i + 1]?.trim();
      if (uri && bw > bestBandwidth) {
        bestBandwidth = bw;
        bestUri = uri;
      }
    }
  }
  return new URL(bestUri, masterUrl).toString();
}

function updateProgress(done, total, startTime) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  fillEl.style.width = `${pct}%`;
  pctEl.textContent = `${done}/${total} segments`;

  const elapsedSec = (Date.now() - startTime) / 1000;
  if (elapsedSec > 0) {
    const perSec = done / elapsedSec;
    if (perSec > 0) {
      const remaining = (total - done) / perSec;
      etaEl.textContent = `ETA ${Math.round(remaining)}s`;
      speedStatEl.textContent = `${perSec.toFixed(1)} seg/s`;
    }
  }
}
