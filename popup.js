// NexFetch — popup.js

const listEl = document.getElementById("stream-list");

function formatBytes(bytes) {
  if (!bytes) return "size unknown";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

// Parse #EXTINF durations from a media playlist to get total seconds.
function sumDuration(mediaPlaylistText) {
  let total = 0;
  for (const line of mediaPlaylistText.split("\n")) {
    const m = line.match(/^#EXTINF:([\d.]+)/);
    if (m) total += parseFloat(m[1]);
  }
  return total;
}

function parseVariants(masterText, masterUrl) {
  const lines = masterText.split("\n");
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
      const resMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
      const uri = lines[i + 1]?.trim();
      if (uri) {
        variants.push({
          bandwidth: bwMatch ? Number(bwMatch[1]) : 0,
          resolution: resMatch ? resMatch[1] : null,
          url: new URL(uri, masterUrl).toString(),
        });
      }
    }
  }
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants;
}

function qualityLabel(resolution) {
  if (!resolution) return "Auto";
  const h = Number(resolution.split("x")[1]);
  if (h >= 2160) return "4K";
  if (h >= 1440) return "1440p";
  if (h >= 1080) return "1080p";
  if (h >= 720) return "720p";
  if (h >= 480) return "480p";
  if (h >= 360) return "360p";
  return `${h}p`;
}

function startDownload(streamPayload) {
  const url = new URL(chrome.runtime.getURL("download.html"));
  url.searchParams.set("stream", JSON.stringify(streamPayload));
  chrome.tabs.create({ url: url.toString() });
}

const REFERER_RULE_ID_PREVIEW = 90211;

async function applyRefererSpoofPreview(pageOrigin, targetUrl) {
  if (!pageOrigin) return;
  try {
    const host = new URL(targetUrl).hostname;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [REFERER_RULE_ID_PREVIEW],
      addRules: [
        {
          id: REFERER_RULE_ID_PREVIEW,
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
  } catch { /* best-effort preview only */ }
}

async function renderHlsCard(container, stream) {
  container.innerHTML = `<p class="nf-empty" style="padding:12px;">Reading playlist…</p>`;
  try {
    await applyRefererSpoofPreview(stream.pageOrigin, stream.url);
    const masterRes = await fetch(stream.url);
    if (!masterRes.ok) throw new Error(`HTTP ${masterRes.status}`);
    const masterText = await masterRes.text();

    if (!masterText.includes("#EXT-X-STREAM-INF")) {
      container.innerHTML = "";
      renderSingleAction(container, stream, "HLS");
      return;
    }

    const variants = parseVariants(masterText, stream.url);
    let durationSec = 0;
    try {
      const mediaText = await (await fetch(variants[0].url)).text();
      durationSec = sumDuration(mediaText);
    } catch { /* duration estimate optional */ }

    container.innerHTML = "";
    variants.forEach((v) => {
      const row = document.createElement("div");
      row.className = "nf-quality-row";
      const estBytes = durationSec && v.bandwidth ? (v.bandwidth * durationSec) / 8 : null;
      row.innerHTML = `
        <div>
          <span class="nf-quality-label">${qualityLabel(v.resolution)}</span>
          <span class="nf-quality-size">${estBytes ? formatBytes(estBytes) : "size unknown"}</span>
        </div>
        <button class="nf-quality-dl">Download</button>
      `;
      row.querySelector("button").addEventListener("click", () => {
        startDownload({ url: v.url, type: "hls", label: qualityLabel(v.resolution), pageOrigin: stream.pageOrigin });
      });
      container.appendChild(row);
    });
  } catch (err) {
    container.innerHTML = `<p class="nf-empty">Couldn't read playlist: ${err.message}</p>`;
  }
}

function renderSingleAction(container, stream, label) {
  const row = document.createElement("div");
  row.className = "nf-quality-row";
  row.innerHTML = `
    <div><span class="nf-quality-label">${label}</span></div>
    <button class="nf-quality-dl">Download</button>
  `;
  row.querySelector("button").addEventListener("click", () => startDownload(stream));
  container.appendChild(row);
}

function render(streams) {
  if (!streams.length) {
    listEl.innerHTML = `<p class="nf-empty">No video streams detected yet.<br>Play the video on this page, then reopen NexFetch.</p>`;
    return;
  }

  listEl.innerHTML = "";
  streams.forEach((s) => {
    const card = document.createElement("div");
    card.className = "nf-item";
    const header = document.createElement("div");
    header.className = "nf-item-top";
    header.innerHTML = `<span class="nf-badge">${s.type.toUpperCase()}</span>`;
    card.appendChild(header);

    const urlLine = document.createElement("div");
    urlLine.className = "nf-url";
    urlLine.title = s.url;
    urlLine.textContent = s.url;
    card.appendChild(urlLine);

    const body = document.createElement("div");
    card.appendChild(body);
    listEl.appendChild(card);

    if (s.type === "hls") {
      renderHlsCard(body, s);
    } else {
      renderSingleAction(body, s, s.type.toUpperCase());
    }
  });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  chrome.runtime.sendMessage({ type: "GET_STREAMS", tabId: tab.id }, (res) => {
    render(res?.streams ?? []);
  });
}

init();
