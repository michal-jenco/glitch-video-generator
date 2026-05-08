# Glitch Video Generator

Static WebGL glitch lab for generating chaotic visuals from webcam, uploads, or procedural sources. Record to `.webm`, export to `.mp4` or `.gif`, snapshot to `.png`, and share exact configurations via URL.

## Features

- Full-window WebGL2 renderer with ping-pong framebuffers and feedback effects
- **Default source: webcam** — opens camera on load
- Source modes:
  - `webcam` — mirrored preview by default; **⇋ mirror** toggles horizontal flip; **⇄ flip cam** appears automatically on multi-camera devices (phones/tablets)
  - `procedural` — noise, bars, scrolling error text, grid, circles, plasma, random rotation
  - `upload` — image or video file
- Chaos engine with seeded randomness for reproducible sequences
- 26 WebGL effects with dynamic multi-pass chaining
- Per-effect controls: enable/disable toggle, `amt` (strength), `freq` (selection weight)
- Effect utility buttons: `enable all`, `untoggle all`, `rand toggles`, `rand params`
- Session controls: `pause`, `lock chain` (freeze pipeline order while still allowing live amt tweaks), randomize seed
- **Recording & export:**
  - `● REC` / `■ STOP` triggers a three-tier MP4 strategy auto-selected at startup:
    1. **Native `MediaRecorder` MP4** (Chromium ≥ 129, Safari iOS 17+ / Safari macOS 17+) — hardware H.264, instant
    2. **WebCodecs + mp4-muxer** (Firefox 130+ where the AVC encoder ships, older Chrome/Safari with WebCodecs) — hardware H.264, instant
    3. **`MediaRecorder` WEBM + ffmpeg.wasm transcode** — last resort, ~5× clip-length to encode
  - WEBM download is always available when the recording is webm (tier 3); hidden when the recording is already mp4 (tiers 1–2)
  - `● GIF` — captures live canvas at 12 fps, downscaled to 480 px wide; duration 2 / 3 / 5 / 8 s selectable
  - `📷 PNG` — instant full-resolution frame snapshot
- **Preset system:**
  - Save named presets to `localStorage` (auto-generates a glitchy name like `CORRUPT_BURST_3FA2`)
  - Load / delete from dropdown
  - Presets include: seed, intensity, chaos rate, max effects, per-effect config, **and source mode**
  - `⇗ copy share link` — encodes the full config into the URL hash; anyone opening the link gets your exact setup auto-loaded

## Effect Set

Current shader effects include:

- `rgb_split`
- `datamosh`
- `pixsort`
- `vhs`
- `slice`
- `feedback`
- `wave`
- `color`
- `crt`
- `mosaic`
- `ascii`
- `jpegblocks`
- `interlace`
- `voronoi`
- `band`
- `echo`
- `edge`
- `barcode`
- `strobe`
- `solarize`
- `lineshift`
- `tunnel`
- `bitflip`
- `swirl`
- `ghostrgb`

## Project Structure

```text
.
├── index.html
├── styles.css
├── README.md
├── js/
│   ├── main.js          # app bootstrap, UI wiring, render loop
│   ├── shaders.js       # WebGL2 pipeline + 26 GLSL effect shaders
│   ├── glitch.js        # chaos engine (seeded scheduling, bursts)
│   ├── sources.js       # webcam, image, video source providers
│   ├── procedural.js    # procedural pattern generators
│   ├── recorder.js              # 3-tier recording dispatcher (mp4 / webcodecs / webm+ffmpeg)
│   ├── webcodecs-recorder.js    # canvas → VideoEncoder (H.264) → mp4-muxer
│   ├── gif-exporter.js          # gif.js-based GIF capture
│   └── presets.js               # localStorage presets + URL-hash sharing
└── vendor/
    ├── ffmpeg/                  # vendored ffmpeg.wasm (single-threaded)
    ├── gif.js/                  # vendored gif.js + gif.worker.js
    └── mp4-muxer/               # vendored mp4-muxer 5.2.2 for WebCodecs path
```

## Run Locally

From the project root:

```bash
python3 -m http.server 8000
```

Open:

- <http://localhost:8000>

## Usage Quick Start

1. Allow camera access — webcam starts by default.
2. Tune `intensity`, `chaos rate`, and `max effects` to taste.
3. Fine-tune individual effects in the `EFFECTS` panel (toggle, amt, freq).
4. Optional: `pause` to freeze, `lock chain` to fix the current effect pipeline while still tweaking amounts live.
5. Export:
   - Video: `● REC` → `■ STOP` → `↓ WEBM` or `↓ MP4`
   - GIF: pick duration → `● GIF`
   - Still: `📷 PNG`
6. Save your setup: type a name (or use the generated one) → `save`. Share via `⇗ copy share link`.

## Seeded Reproducibility

- The seed drives deterministic effect scheduling and burst parameter generation.
- Using the same seed and same control state reproduces the same chaos sequence.

## Browser Notes

- Primary target: **Chrome** (best WebGL2, MediaRecorder, and GIF worker support).
- Safari: instant native MP4 from iOS 17 / macOS 17 onward.
- **Firefox**: instant MP4 only when its WebCodecs H.264 encoder is present and works end-to-end. As of mid-2026 this is **not the case on most desktop Firefox builds** (especially macOS) — Mozilla ships the WebCodecs API but the AVC encoder is gated behind prefs and platform availability. Firefox **Android** is more likely to have a working hardware AVC encoder than Firefox **desktop** because mobile Firefox can lean on Android's `MediaCodec`. The app probes by actually pushing a test frame through the encoder at startup and only chooses the WebCodecs path if it produces a real chunk; otherwise it transparently falls back to WEBM + ffmpeg.wasm and shows the slower-encode hint.
- The ffmpeg fallback is single-threaded — no `SharedArrayBuffer` or cross-origin isolation headers required, so it works on GitHub Pages as-is, but encoding takes several times the clip length.
- GIF encoding runs in background web workers (gif.js); large durations on slow devices may take a moment.

## Camera Flip (Mobile)

On devices with multiple cameras (phones, tablets) the **⇄ flip cam** button appears automatically when the webcam source is active. It toggles between front (`user`) and back (`environment`) camera and restarts the stream. Hidden on single-camera devices.

## Mirror Toggle

The **⇋ mirror** button horizontally flips the webcam image. Front camera defaults to mirrored (the typical selfie view); rear camera defaults to non-mirrored (matches what you see through the lens). Once clicked, the choice sticks until you flip cameras, which resets to the per-camera default.

## Preset Sharing

Clicking **⇗ copy share link** encodes the full current configuration — seed, all sliders, every per-effect toggle/amount/weight, and the active source — into the URL hash as a base64 blob. The recipient opens the link and the state is applied automatically on load, then the hash is cleared from the URL bar.

