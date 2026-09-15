# NexFetch

Video stream detector + downloader Chrome extension.
**Developer:** MR. ARX (Arabi Islam) · **Author:** NexApp · **Site:** https://nexfetch.vercel.app (not live yet)

## What's included (Phase 1 — features 1–3 of the roadmap)

- `manifest.json` — Manifest V3 config
- `background.js` — stream detection engine (URL-pattern + Content-Type sniffing, per-tab)
- `popup.html/css/js` — detected-streams list UI
- `download.html/js` — **large-file-safe download engine**:
  - Direct files (mp4/webm/mkv) streamed to disk, no memory buffering
  - HLS (.m3u8) playlist parsing, master-playlist variant selection, per-segment
    fetch with Content-Length verification + retry, sequential disk writes via
    File System Access API — built specifically so 6–10GB / multi-hour videos
    don't corrupt or crash the tab
  - Progress checkpointing to `chrome.storage.local` (foundation for resume)
- `icons/` — placeholder icons (swap with your real logo — see below)

## Not yet built (next phases)

- **4. Chromecast** — Presentation API integration
- **5. Cloud backup** — Drive/S3/R2 OAuth + upload
- **6. Save-for-later library** — needs your backend/DB (Supabase, matching NexAuras/NexSecurity stack)
- **7. Payment/tiers** — intentionally skipped per your instruction

## Load it locally

1. `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select the `nexfetch` folder
4. Visit any page with a video, let it start playing, then click the NexFetch icon

## Swapping in your real logo

Replace `icons/icon16.png`, `icon48.png`, `icon128.png` with your files (same names/sizes),
and `popup.html`'s `<img src="icons/icon48.png">`.

## Known limitation to watch

`ffmpeg.wasm` (for format conversion, not yet wired in) has a WASM memory ceiling
(~2–4GB) — it will NOT be run against full 6–10GB files. When conversion is added,
it needs to either (a) only run on already-small/remuxed outputs, or (b) hand off
to your NexGrab desktop app (native ffmpeg, no memory ceiling) for heavy jobs.
This is a placeholder note for that future phase — not yet implemented here.
"# NexFetch-Chrome" 
