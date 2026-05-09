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
- **44 WebGL effects** (25 original + 19 analogue) split into toggleable effect groups
- **Effect groups:** `Original` and `Analogue` — toggle whole categories on/off; hidden groups are excluded from the chaos engine and the UI
- Per-effect controls: enable/disable toggle, `amt` (strength), `freq` (selection weight)
- **Named per-effect parameters** with custom slider controls for fine-tuning analogue effects
- **`ⓘ` tooltips** on every effect and parameter with detailed technical descriptions
- Effect utility buttons: `enable all`, `untoggle all`, `rand toggles`, `rand params`
- Session controls: `pause`, `lock chain` (freeze pipeline order while still allowing live amt tweaks), randomize seed
- **Recording & export:**
  - `● REC` / `■ STOP` triggers a three-tier MP4 strategy auto-selected at startup:
    1. **Native `MediaRecorder` MP4** (Chromium >= 129, Safari iOS 17+ / Safari macOS 17+) — hardware H.264, instant
    2. **WebCodecs + mp4-muxer** (Firefox 130+ where the AVC encoder ships, older Chrome/Safari with WebCodecs) — hardware H.264, instant
    3. **`MediaRecorder` WEBM + ffmpeg.wasm transcode** — last resort, ~5x clip-length to encode
  - WEBM download is always available when the recording is webm (tier 3); hidden when the recording is already mp4 (tiers 1-2)
  - `● GIF` — captures live canvas at 12 fps, downscaled to 480 px wide; duration 2 / 3 / 5 / 8 s selectable
  - `📷 PNG` — instant full-resolution frame snapshot
- **Preset system:**
  - Save named presets to `localStorage` (auto-generates a glitchy name like `CORRUPT_BURST_3FA2`)
  - Load / delete from dropdown
  - Presets include: seed, intensity, chaos rate, max effects, per-effect config, effect groups, named parameter overrides, **and source mode**
  - `⇗ copy share link` — encodes the full config into the URL hash; anyone opening the link gets your exact setup auto-loaded

## Effect Groups

Effects are organized into two groups that can be independently toggled on/off. When a group is disabled, its effects are hidden from the UI entirely and will never be randomly selected by the chaos engine.

### Original (25 effects)
The classic glitch set: chromatic aberration, datamoshing, pixel sorting, VHS noise, feedback, wave warps, CRT geometry, pixelation, edge detection, and more.

### Analogue (19 effects)
CRT / NTSC / VHS hardware simulation: composite video artifacts, phosphor persistence, degaussing ripples, beam convergence errors, vertical hold failure, RF snow, head switching bands, tracking errors, and more.

<table>
<tr><th>Effect</th><th>Description</th></tr>
<tr><td><code>ntsc</code></td><td>Full NTSC composite video encode/decode: dot crawl checkerboard on colored edges, cross-color rainbow banding on sharp luma transitions</td></tr>
<tr><td><code>posterize</code></td><td>Hardware-style bit truncation (ADC->DAC), quantizing channels to coarse color bands</td></tr>
<tr><td><code>chromadrop</code></td><td>Random scanline color dropout -- lines revert to grayscale, simulating failing chroma decoder</td></tr>
<tr><td><code>colorfringe</code></td><td>Animated per-scanline chromatic aberration with independent RGB offsets oscillating across the frame</td></tr>
<tr><td><code>headswitch</code></td><td>VHS head switching band at the bottom of the frame: distorted lines with color corruption and noise</td></tr>
<tr><td><code>tracking</code></td><td>VHS tracking error: a horizontal band of offset video rolls vertically with soft feathered edges</td></tr>
<tr><td><code>edgeboost</code></td><td>VHS edge enhancement / sharpening halo with characteristic bright overshoot ringing</td></tr>
<tr><td><code>phosphor</code></td><td>CRT phosphor persistence: bright pixels leave decaying trails weighted by luminance</td></tr>
<tr><td><code>degauss</code></td><td>Magnetic degaussing ripple: radial RGB rainbow warp spreading from a point</td></tr>
<tr><td><code>beamconv</code></td><td>Electron beam convergence error: RGB channels misalign progressively toward screen corners</td></tr>
<tr><td><code>vhold</code></td><td>Vertical hold failure: frame snaps or rolls vertically with visible sync tear bar</td></tr>
<tr><td><code>static</code></td><td>RF noise / analog TV snow with horizontal banding at ~15.7 kHz scanline spacing</td></tr>
<tr><td><code>halation</code></td><td>CRT glass scatter: wide, subtle glow around very bright areas from photon spread in glass</td></tr>
<tr><td><code>shadowmask</code></td><td>Visible RGB phosphor pattern overlay (aperture grille or shadow mask) with moire interaction</td></tr>
<tr><td><code>pincushion</code></td><td>Dynamic CRT geometry instability: edges bow in/out with animated coefficients</td></tr>
<tr><td><code>scanbeam</code></td><td>Brightness-dependent scanline beam width: bright pixels = wider beam, dark = thin</td></tr>
<tr><td><code>wiggle</code></td><td>Frame wobble/breathing from CRT deflection circuit instability or magnetic interference</td></tr>
<tr><td><code>bloom</code></td><td>Isolated cathode bloom: thresholded bright regions blurred and additively blended back</td></tr>
<tr><td><code>scanphase</code></td><td>NTSC subcarrier phase drift: per-line hue rotation slowly desynchronizes, creating color flicker</td></tr>
</table>

The active groups are saved in presets and share links. When both groups are active (the default), no group data appears in the URL -- the compact encoding only emits group state when at least one group is toggled off.

## Named Controls

Effects with custom parameter controls expose individual sliders labeled with descriptive names instead of relying entirely on the `amt` slider. For example, the `ntsc` effect shows:

- `amt` — overall intensity when this effect activates
- `freq` — how often this effect is randomly selected
- `Dot Crawl` — checkerboard pattern strength on colored edges
- `Rainbow` — cross-color banding on sharp luminance transitions
- `Chroma Blur` — horizontal chroma lowpass bandwidth
- `Phase Drift` — per-line color phase variation
- `Luma Bleed` — luminance leaking into chroma channels

When a named control is set, the chaos engine uses that value instead of generating a random one -- giving you precise control while keeping the chaotic feel for parameters you leave at their default. Named control values are saved in presets and share links via a compact `fxp` encoding.

## Tooltips

Every effect and every parameter has a `ⓘ` icon that shows a detailed tooltip on hover (or tap on touch devices). The tooltip describes what the effect does and what each control influences. Tooltips are purely informational -- they don't change behavior and can be safely ignored.

## Effect Set

### Original Effects (25)

- `rgb_split` — chromatic aberration (channel split with wobble)
- `datamosh` — motion smear from previous frame sampling
- `pixsort` — per-row brightness threshold horizontal smear
- `vhs` — scanline jitter, chroma bleed, tape noise, tracking band
- `slice` — horizontal band displacement
- `feedback` — affine warp (rotation + scale + pan) of previous frame
- `wave` — sine wave slit-scan warp
- `color` — HSV manipulation: hue rotation, saturation, posterization, inversion
- `crt` — barrel distortion, vignette, cheap 4-tap bloom
- `mosaic` — pixelation via UV quantization
- `ascii` — luminance-based dot pattern rendering
- `jpegblocks` — fake DCT block corruption with displacement and tint
- `interlace` — odd-row drift tearing with dimming
- `voronoi` — Voronoi diagram UV displacement
- `band` — tracking band roll with noise and channel swap
- `echo` — motion trails via previous-frame max-blend
- `edge` — Sobel edge detection with colored overlay
- `barcode` — column noise bars on horizontal bands
- `strobe` — time freeze blending previous frame
- `solarize` — threshold-based inversion with hash noise
- `lineshift` — per-column vertical drift
- `tunnel` — polar coordinate warp with animated angle and radius
- `bitflip` — channel swapping and bit-depth quantization
- `swirl` — radial swirl from center
- `ghostrgb` — chroma ghost trails from previous frame offsets

### Analogue Effects (19)

<table>
<tr><td><code>ntsc</code></td><td><code>posterize</code></td><td><code>chromadrop</code></td><td><code>colorfringe</code></td><td><code>headswitch</code></td></tr>
<tr><td><code>tracking</code></td><td><code>edgeboost</code></td><td><code>phosphor</code></td><td><code>degauss</code></td><td><code>beamconv</code></td></tr>
<tr><td><code>vhold</code></td><td><code>static</code></td><td><code>halation</code></td><td><code>shadowmask</code></td><td><code>pincushion</code></td></tr>
<tr><td><code>scanbeam</code></td><td><code>wiggle</code></td><td><code>bloom</code></td><td><code>scanphase</code></td><td></td></tr>
</table>

## Project Structure

```text
.
├── index.html
├── styles.css
├── README.md
├── js/
│   ├── main.js          # app bootstrap, UI wiring, render loop
│   ├── shaders.js       # WebGL2 pipeline + 44 GLSL effect shaders (25 original + 19 analogue)
│   ├── glitch.js        # chaos engine (seeded scheduling, bursts, groups, param overrides)
│   ├── sources.js       # webcam, image, video source providers
│   ├── procedural.js    # procedural pattern generators
│   ├── recorder.js              # 3-tier recording dispatcher (mp4 / webcodecs / webm+ffmpeg)
│   ├── webcodecs-recorder.js    # canvas -> VideoEncoder (H.264) -> mp4-muxer
│   ├── gif-exporter.js          # gif.js-based GIF capture
│   └── presets.js               # localStorage presets + URL-hash sharing (v3 compact encoding)
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

1. Allow camera access -- webcam starts by default.
2. Tune `intensity`, `chaos rate`, and `max effects` to taste.
3. Toggle effect groups above the effects list to show/hide entire categories.
4. Fine-tune individual effects in the `EFFECTS` panel (toggle, amt, freq, and named controls). Use `ⓘ` icons for details.
5. Optional: `pause` to freeze, `lock chain` to fix the current effect pipeline while still tweaking amounts live.
6. Export:
   - Video: `● REC` -> `■ STOP` -> `↓ WEBM` or `↓ MP4`
   - GIF: pick duration -> `● GIF`
   - Still: `📷 PNG`
7. Save your setup: type a name (or use the generated one) -> `save`. Share via `⇗ copy share link`.

## Seeded Reproducibility

- The seed drives deterministic effect scheduling and burst parameter generation.
- Using the same seed and same control state reproduces the same chaos sequence.

## Browser Notes

- Primary target: **Chrome** (best WebGL2, MediaRecorder, and GIF worker support).
- Safari: instant native MP4 from iOS 17 / macOS 17 onward.
- **Firefox**: instant MP4 only when its WebCodecs H.264 encoder is present and works end-to-end. As of mid-2026 this is **not the case on most desktop Firefox builds** (especially macOS) -- Mozilla ships the WebCodecs API but the AVC encoder is gated behind prefs and platform availability. Firefox **Android** is more likely to have a working hardware AVC encoder than Firefox **desktop** because mobile Firefox can lean on Android's `MediaCodec`. The app probes by actually pushing a test frame through the encoder at startup and only chooses the WebCodecs path if it produces a real chunk; otherwise it transparently falls back to WEBM + ffmpeg.wasm and shows the slower-encode hint.
- The ffmpeg fallback is single-threaded -- no `SharedArrayBuffer` or cross-origin isolation headers required, so it works on GitHub Pages as-is, but encoding takes several times the clip length.
- GIF encoding runs in background web workers (gif.js); large durations on slow devices may take a moment.

## Camera Flip (Mobile)

On devices with multiple cameras (phones, tablets) the **⇄ flip cam** button appears automatically when the webcam source is active. It toggles between front (`user`) and back (`environment`) camera and restarts the stream. Hidden on single-camera devices.

## Mirror Toggle

The **⇋ mirror** button horizontally flips the webcam image. Front camera defaults to mirrored (the typical selfie view); rear camera defaults to non-mirrored (matches what you see through the lens). Once clicked, the choice sticks until you flip cameras, which resets to the per-camera default.

## Preset Sharing

Clicking **⇗ copy share link** encodes the full current configuration -- seed, all sliders, every per-effect toggle/amount/weight, effect group state, named parameter overrides, and the active source -- into the URL hash as a base64 blob using a compact v3 encoding. The recipient opens the link and the state is applied automatically on load, then the hash is cleared from the URL bar. Links are backwards compatible: older v2 links decode correctly, with new analogue effects and groups defaulting to enabled.
