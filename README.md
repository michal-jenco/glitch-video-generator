# Glitch Video Generator

Static WebGL glitch lab for generating chaotic visuals from webcam, uploads, or procedural sources. Record to `.webm`, export to `.mp4` or `.gif`, snapshot to `.png`, and share exact configurations via URL.

## Features

- Full-window WebGL2 renderer with ping-pong framebuffers and feedback effects
- **Default source: webcam** — opens camera on load
- Source modes:
  - `webcam` — mirrored preview; **⇄ flip cam** appears automatically on multi-camera devices (phones/tablets)
  - `procedural` — noise, bars, scrolling error text, grid, circles, plasma, random rotation
  - `upload` — image or video file
- Chaos engine with seeded randomness for reproducible sequences
- 26 WebGL effects with dynamic multi-pass chaining
- Per-effect controls: enable/disable toggle, `amt` (strength), `freq` (selection weight)
- Effect utility buttons: `enable all`, `untoggle all`, `rand toggles`, `rand params`
- Session controls: `pause`, `lock chain` (freeze pipeline order while still allowing live amt tweaks), randomize seed
- **Recording & export:**
  - `● REC` / `■ STOP` → `↓ WEBM` (MediaRecorder, vp9/vp8)
  - `↓ MP4` — in-browser transcode via bundled ffmpeg.wasm (works on GitHub Pages, no SharedArrayBuffer needed)
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
- `kaleido`
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
│   ├── recorder.js      # MediaRecorder wrapper + ffmpeg MP4 export
│   ├── gif-exporter.js  # gif.js-based GIF capture
│   └── presets.js       # localStorage presets + URL-hash sharing
└── vendor/
    ├── ffmpeg/          # vendored ffmpeg.wasm (single-threaded)
    └── gif.js/          # vendored gif.js + gif.worker.js
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
- Safari: WebM recording may be limited depending on OS/codec version; MP4 export works.
- MP4 export uses a vendored single-threaded ffmpeg.wasm — no `SharedArrayBuffer` or cross-origin isolation headers required, so it works on GitHub Pages as-is.
- GIF encoding runs in background web workers (gif.js); large durations on slow devices may take a moment.

## Camera Flip (Mobile)

On devices with multiple cameras (phones, tablets) the **⇄ flip cam** button appears automatically when the webcam source is active. It toggles between front (`user`) and back (`environment`) camera and restarts the stream. Hidden on single-camera devices.

## Preset Sharing

Clicking **⇗ copy share link** encodes the full current configuration — seed, all sliders, every per-effect toggle/amount/weight, and the active source — into the URL hash as a base64 blob. The recipient opens the link and the state is applied automatically on load, then the hash is cleared from the URL bar.

