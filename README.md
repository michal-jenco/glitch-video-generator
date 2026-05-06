# Glitch Video Generator

Static WebGL glitch lab for generating chaotic visuals from uploads, webcam, or procedural sources, then recording them to `.webm`.

## Features

- Full-window WebGL2 renderer with ping-pong framebuffers and feedback effects
- Source modes:
  - `procedural` (noise, bars, text, grid, circles, plasma, random rotation)
  - `upload` (image or video files)
  - `webcam` (mirrored/selfie-style preview; **⇄ flip cam** button appears automatically on devices with multiple cameras, e.g. phones)
- Chaos engine with seeded randomness for reproducible runs
- Rich effect library (26 effects) with dynamic multi-pass chaining
- Per-effect controls:
  - enable/disable toggle
  - `amt` (strength)
  - `freq` (selection weight)
- Effect utility controls:
  - `enable all`
  - `untoggle all`
  - `rand toggles`
  - `rand params`
- Session controls:
  - `pause / unpause` rendering
  - `lock chain / unlock chain` to freeze current pass pipeline order/composition
  - while locked, per-effect toggles and `amt` still apply immediately
  - randomize seed
- Recording:
  - `REC` / `STOP`
  - explicit `DL` (download last `.webm` recording)
  - `MP4` export via bundled ffmpeg.wasm (single-threaded, no `SharedArrayBuffer` required — works on GitHub Pages)
  - `.webm` via `MediaRecorder` (`vp9` with `vp8` fallback)

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
└── js
    ├── main.js
    ├── shaders.js
    ├── glitch.js
    ├── sources.js
    ├── procedural.js
    └── recorder.js
```

## Run Locally

From the project root:

```bash
python3 -m http.server 8000
```

Open:

- <http://localhost:8000>

## Usage Quick Start

1. Pick a source (`procedural`, `upload`, or `webcam`).
2. Tune global `intensity`, `chaos rate`, and `max effects`.
3. Adjust individual effect toggles/amount/frequency in the `EFFECTS` panel.
4. Optional:
   - freeze animation with `pause`
   - freeze current pass pipeline with `lock chain`
   - keep tweaking effect toggles/amount while locked to art-direct a fixed chain
5. Record with `REC`, stop, then click `DL`.

## Seeded Reproducibility

- The seed drives deterministic effect scheduling and burst parameter generation.
- Using the same seed and same control state reproduces the same chaos sequence.

## Browser Notes

- Primary target: Chrome (best support/performance).
- `MediaRecorder` and WebM support vary by browser; Safari behavior may be limited depending on version/system codecs.
- MP4 export uses a vendored single-threaded ffmpeg.wasm build — no `SharedArrayBuffer` / cross-origin isolation headers required, so it works on GitHub Pages as-is.

## Camera Flip (Mobile)

When using the `webcam` source on a device with multiple cameras (phones, tablets), a **⇄ flip cam** button appears below the source selector. Clicking it switches between the front (`user`) and back (`environment`) camera. The button is hidden on single-camera devices (laptops, desktops).

