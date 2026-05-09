# Changelog

## 2026-05-09 — Analogue effect expansion (v3)

### New: 19 analogue CRT / NTSC / VHS effects

A whole new category of 19 effects simulating real analog video hardware.
Each effect has 2–5 named parameter sliders for fine control, backed by
research from libretro CRT shaders, composite-video-simulator, KinoGlitch,
ntsc-rs, and CRT display physics literature.

| # | Effect | What it simulates |
|---|--------|-------------------|
| 1 | `ntsc` | Full NTSC composite encode/decode: dot crawl + cross-color rainbow banding |
| 2 | `posterize` | Hardware ADC/DAC bit truncation (1980s video hardware quantisation) |
| 3 | `chromadrop` | Chroma decoder failure: random scanlines revert to grayscale |
| 4 | `colorfringe` | Per-scanline animated chromatic aberration with independent RGB sine waves |
| 5 | `headswitch` | VHS playback head switching band at the bottom of the frame |
| 6 | `tracking` | VHS tracking error: rolling band of offset video with soft feathered edges |
| 7 | `edgeboost` | VHS edge enhancement / unsharp mask with characteristic overshoot ringing |
| 8 | `phosphor` | CRT phosphor afterglow: luminance-weighted ghost trails from previous frame |
| 9 | `degauss` | Magnetic degaussing burst: radial RGB rainbow ripple |
| 10 | `beamconv` | Electron beam convergence error: RGB misalignment worse at screen corners |
| 11 | `vhold` | Vertical hold/sync failure: frame snapping or full vertical roll with tear bar |
| 12 | `static` | RF noise / analog TV snow with horizontal sync banding and streaks |
| 13 | `halation` | CRT glass scatter: wide soft glow around bright areas from photon spread |
| 14 | `shadowmask` | Visible RGB phosphor pattern: aperture grille or shadow mask overlay |
| 15 | `pincushion` | Dynamic CRT geometry instability: edges bow in/out with animated coefficients |
| 16 | `scanbeam` | Brightness-dependent scanline beam width: bright pixels = wider beam |
| 17 | `wiggle` | CRT deflection circuit wobble: low-frequency frame sway |
| 18 | `bloom` | Isolated cathode bloom: thresholded bright-region Gaussian blur + additive blend |
| 19 | `scanphase` | NTSC subcarrier phase drift: per-line hue rotation desynchronization |

### New: effect groups

Effects are now organized into toggleable groups. Untoggling a group removes
its effect cards from the UI entirely and excludes them from the chaos engine.
Group state is saved in presets and share links.

### New: named per-effect controls

The 19 analogue effects now have named slider controls in addition to the universal
`amt` and `freq`. Each control maps to a specific GLSL uniform parameter (`uParam0`–`uParam5`).
When set, the chaos engine uses the user's value instead of generating a random one,
giving precise control while preserving chaotic behavior for untouched parameters.

### New: tooltips

Every effect and every parameter now has a `ⓘ` icon displaying a detailed tooltip
on hover (or tap on touch devices). ~253 tooltip description strings.

### Changed: extended uniform slots

The GLSL shader pipeline now supports 6 params per pass (`uParam0`–`uParam5`), up from 4.

### Changed: preset encoding v3

New fields: `fg` (active groups) and `fxp` (named param overrides). Old v2 links decode
correctly via a `>= 2` compatibility check.

### Changed: burst list

The burst engine now includes 8 new analogue candidates: `ntsc`, `phosphor`, `degauss`,
`pincushion`, `static`, `vhold`, `chromadrop`, `headswitch`.

### Changed: bulk randomize

The "rand params" button now randomizes named control sliders in addition to
`amt` and `freq` sliders.

### Changed: README documentation

Full documentation added: effect groups, analogue effects table with descriptions,
named controls section, tooltip section.

### Changed: CLAUDE.md

Added verification commands for HTTP serving and JS brace balance checks.

---

## 2026-05-09 (session 2) — Circuit Bend group + aggressive refactors

### New: Circuit Bend group (9 effects)

A third effect group focused on aggressive circuit-bent signal chain destruction —
image dissolution, color injection, and frame tearing. Based on research into
real analog video glitch art, circuit-bent video enhancers, and dirty video mixers.

| # | Effect | What it simulates |
|---|--------|-------------------|
| 1 | `dissolve` | Image dissolution: frame breaks into horizontal noise bands that scroll vertically |
| 2 | `colorbars` | Injected chroma carrier: psychedelic horizontal color bands modulated by image brightness |
| 3 | `channelswap` | Horizontal-segmented RGB channel remixing: red becomes green, green becomes blue, etc. |
| 4 | `crushblow` | Luma crush + chroma blowout: extreme contrast with neon saturation |
| 5 | `sliceshift` | Horizontal band displacement + per-band independent hue/sat/brightness treatment |
| 6 | `noisewipe` | Structured noise wall rolls across the frame dissolving the image in its path |
| 7 | `chromasmearplus` | Heavy horizontal chroma smear + per-row vertical displacement (failing TBC) |
| 8 | `huespread` | Per-scanline hue rotation random walk creating horizontal color gradients |
| 9 | `framerip` | Frame buffer tearing: current/old frames ripped apart with jagged corruption boundaries |

### Changed: analogue defaults amplified

Defaults on 9 existing analogue effects increased for more aggressive out-of-box visuals:
`ntsc`, `chromadrop`, `colorfringe`, `headswitch`, `tracking`, `edgeboost`, `static`,
`degauss`, `scanphase`.

### Changed: dynamic group discovery

Both `applyState` and `expandState` now derive active groups from `EFFECTS` dynamically
instead of hardcoding — new groups auto-appear in presets and share links with zero glue code.

### Fixed: white-out prevention

All 9 bent shaders now `clamp` their output to [0,1]. Specific fixes: `dissolve` and
`noisewipe` noise multipliers capped; `crushblow` final output clamped; `colorbars`
bar blend clamped; `channelswap`, `sliceshift`, `chromasmearplus`, `huespread`,
`framerip` given blanket output clamps.

### Fixed: chromasmearplus shader compile error

`uv` variable undeclared — added `vec2 uv = vUv;` declaration and removed dead code.

### Fixed: feedbackcascade white-out (removed)

The `feedbackcascade` effect produced unresolvable pure-white frames due to feedback
loop amplification. Attempted clamp + screen blend mitigation but the fundamental
recursive additive feedback design could not be bounded. Removed entirely from all
shaders, EFFECTS, burst list, and documentation.

### Changed: burst list

Added `dissolve`, `colorbars`, `channelswap`, `crushblow` to burst candidates.

### Stats

- **53 total effects** (25 original + 19 analogue + 9 circuit bend)
- **3 effect groups** with independent UI toggles and state persistence
- **10 new GLSL shaders written, 1 removed**
- **30 new named parameter sliders** across bent group
- **~60 new tooltip descriptions**
- **9 existing analogue defaults amplified**
- **5 burst candidates added**
- **Zero backwards compatibility breaks** — v3 encoding unchanged

### Fixed: fit mode missing from share links

`captureState` was receiving `fitMode`/`tileCols`/`tileRows` from `collectState`
but silently dropping them from the returned object. Added to state object, compact
encoding (`fm`/`tc`/`tr` keys) and expandState decoding. The `applyState` side
was already wired — the data just never reached it.
