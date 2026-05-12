# CLAUDE.md

## Build / Run
- No build step. Static site: serve via the bundled `serve.py` wrapper — `py serve.py 8765` (or `python3 serve.py 8765`). Do **not** use bare `python3 -m http.server`: it serves `.mjs` as `text/plain`, which Chrome refuses to load as a module, leaving the page black.
- **After finishing work**, always start the dev server so the user can preview (`.claude/launch.json` already points at this):
  ```bash
  py serve.py 8765
  ```
- **Verify the server works** before reporting done — all JS files must serve with HTTP 200 and `.mjs` must be `application/javascript`:
  ```bash
  for f in js/shaders.js js/glitch.js js/presets.js js/main.js vendor/mp4-muxer/mp4-muxer.mjs; do
    curl -s -o /dev/null -w "%{http_code} %{content_type} $f\n" http://localhost:8765/$f; done
  ```
- **Validate JS integrity** — check brace balance across all JS files:
  ```bash
  for f in js/shaders.js js/glitch.js js/presets.js js/main.js; do
    python3 -c "c=open('$f').read();print('$f',c.count('{')==c.count('}') and 'OK' or 'MISMATCH')"; done
  ```
- All JS is loaded as native ES modules via `<script type="module" src="js/main.js">`. No bundler.
- No linter or test runner configured.

## Project conventions
- **Vanilla JS** — no framework. DOM queries via short helper: `const $ = id => document.getElementById(id);`
- **CSS custom properties** in `:root` for theming: `--bg`, `--fg`, `--accent`, `--accent2`, `--warn`, `--panel`, `--line`, `--mono`.
- **Layout**: `.row` class = `display:flex; align-items:center; gap:8px; flex-wrap:wrap;`. `.hidden` = `display:none !important`.
- **Button-label sync**: functions named `update*Btns()` are called after state changes to refresh UI text/icons.
- **Source providers** (`js/sources.js`): `ProceduralSource`, `ImageSource`, `VideoSource`, `WebcamSource`. Each exposes `.ready()`, `.frame(time)`, `.stop()`.
- **Presets** (`js/presets.js`): saved to `localStorage`, optionally encoded into URL hash for sharing.

### Share links (`#p=…`) and legacy presets
- **Verbose JSON (no `v` key)** — original share format: full `captureState`-shaped object. These never stored `activeGroups`; decoding runs `migrateVerboseShareLink`, which sets `activeGroups` to `['original']` when absent so behaviour matches the pre–effect-groups app (`applyState` also defaults missing groups this way).
- **Compact JSON (`v >= 2`)** — short keys (`s`, `i`, `fx`, `fg`, …). **`fg` is always written** on encode so loads never infer wrong groups. **Legacy compact shares that omit `fg`** expand with `activeGroups` defaulting to `['original','analogue']` (historical meaning when Circuit Bend did not exist). Links created with bent on but without `fg` cannot be distinguished from original+analogue-only shares.
- Shader tweaks since v1 may still cause minor visual drift versus ancient builds; group/effect selection is what this migration fixes.
- **Recording** (`js/recorder.js`): 3-tier dispatcher — native MediaRecorder → WebCodecs → ffmpeg.wasm fallback.

## File map
| File | Purpose |
|---|---|
| `index.html` | All UI markup (single page) |
| `styles.css` | All styles |
| `js/main.js` | App bootstrap, UI wiring, render loop |
| `js/shaders.js` | WebGL2 pipeline + 44 GLSL effects (25 original + 19 analogue) |
| `js/glitch.js` | Chaos engine (scheduling, bursts, groups, param overrides) |
| `js/sources.js` | Source providers (webcam, video, image, procedural) |
| `js/procedural.js` | Procedural pattern generators |
| `js/recorder.js` | Multi-tier video recording |
| `js/webcodecs-recorder.js` | WebCodecs MP4 encoder |
| `js/gif-exporter.js` | GIF capture via gif.js |
| `js/presets.js` | Preset persistence + URL hash sharing |
| `vendor/` | Vendored libs (ffmpeg.wasm, gif.js, mp4-muxer) |
| `assets/` | Favicons, apple-touch-icon, OG/Twitter share image (1200×630). `source.png` is the original uncropped frame. OG `<meta>` tags in `index.html` use absolute `https://michal-jenco.github.io/glitch-video-generator/...` URLs so scrapers resolve correctly. |
