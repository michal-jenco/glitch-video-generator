# CLAUDE.md

## Build / Run
- No build step. Static site: open `index.html` in browser or serve with `python3 -m http.server`.
- **After finishing work**, always start the dev server so the user can preview: `python3 -m http.server 8088 &`
- All JS is loaded as native ES modules via `<script type="module" src="js/main.js">`. No bundler.
- No linter or test runner configured.

## Project conventions
- **Vanilla JS** — no framework. DOM queries via short helper: `const $ = id => document.getElementById(id);`
- **CSS custom properties** in `:root` for theming: `--bg`, `--fg`, `--accent`, `--accent2`, `--warn`, `--panel`, `--line`, `--mono`.
- **Layout**: `.row` class = `display:flex; align-items:center; gap:8px; flex-wrap:wrap;`. `.hidden` = `display:none !important`.
- **Button-label sync**: functions named `update*Btns()` are called after state changes to refresh UI text/icons.
- **Source providers** (`js/sources.js`): `ProceduralSource`, `ImageSource`, `VideoSource`, `WebcamSource`. Each exposes `.ready()`, `.frame(time)`, `.stop()`.
- **Presets** (`js/presets.js`): saved to `localStorage`, optionally encoded into URL hash for sharing.
- **Recording** (`js/recorder.js`): 3-tier dispatcher — native MediaRecorder → WebCodecs → ffmpeg.wasm fallback.

## File map
| File | Purpose |
|---|---|
| `index.html` | All UI markup (single page) |
| `styles.css` | All styles |
| `js/main.js` | App bootstrap, UI wiring, render loop |
| `js/shaders.js` | WebGL2 pipeline + 26 GLSL effects |
| `js/glitch.js` | Chaos engine (scheduling, bursts) |
| `js/sources.js` | Source providers (webcam, video, image, procedural) |
| `js/procedural.js` | Procedural pattern generators |
| `js/recorder.js` | Multi-tier video recording |
| `js/webcodecs-recorder.js` | WebCodecs MP4 encoder |
| `js/gif-exporter.js` | GIF capture via gif.js |
| `js/presets.js` | Preset persistence + URL hash sharing |
| `vendor/` | Vendored libs (ffmpeg.wasm, gif.js, mp4-muxer) |
