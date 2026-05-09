# Changelog

## 2026-05-09 — Analogue effect expansion (v3)

### New: 19 analogue CRT / NTSC / VHS effects

A whole new category of 19 effects simulating real analog video hardware.
Each effect has 2–5 named parameter sliders for fine control, backed by
research from libretro CRT shaders, composite-video-simulator, KinoGlitch,
ntsc-rs, and CRT display physics literature.

| # | Effect | What it simulates |
|---|--------|-------------------|
| 1 | `ntsc` | Full NTSC composite encode/decode: dot crawl checkerboard + cross-color rainbow banding |
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

Effects are now organized into two toggleable groups — **Original** (25 effects) and
**Analogue** (19 effects). Untoggling a group removes its effect cards from the UI
entirely and excludes them from the chaos engine. Group state is saved in presets
and share links.

### New: named per-effect controls

The 19 analogue effects now have named slider controls in addition to the universal
`amt` and `freq`. Each control maps to a specific GLSL uniform parameter (`uParam0`–`uParam5`).
When set, the chaos engine uses the user's value instead of generating a random one,
giving precise control while preserving chaotic behavior for untouched parameters.

Examples:
- `ntsc`: Dot Crawl, Rainbow, Chroma Blur, Phase Drift, Luma Bleed
- `phosphor`: Decay Rate, Threshold, Trail Length
- `degauss`: Wavelength, Amplitude, Spread, Speed

### New: tooltips

Every effect and every parameter now has a `ⓘ` icon displaying a detailed tooltip
on hover (or tap on touch devices). The tooltip describes what the effect does
and what each control influences — 44 effect descriptions plus ~200 individual
parameter descriptions. Tooltips auto-position within the viewport.

### Changed: extended uniform slots

The GLSL shader pipeline now supports 6 params per pass (`uParam0`–`uParam5`),
up from 4. All internal data structures (chaos engine, pass objects, locked
passes, presets) have been updated. Effects not using the extra slots still
work — unused uniforms are silently no-oped by WebGL.

### Changed: preset encoding v3

The compact URL encoding is now version 3. New fields:
- `fg` — active effect groups (only emitted when at least one group is off)
- `fxp` — named parameter overrides (`[effectIdx, paramIdx, value]` tuples)

Old v2 links decode correctly via a `>= 2` compatibility check in the decoder.
New v3 links with analogue effect indices are silently ignored by older app versions.

### Changed: burst list

The burst engine now includes 8 new candidates: `ntsc`, `phosphor`, `degauss`,
`pincushion`, `static`, `vhold`, `chromadrop`, `headswitch`. All burst candidate
selection respects both individual enable/disable state and group toggle state.

### Changed: bulk randomize

The "rand params" button now randomizes named control sliders in addition to
`amt` and `freq` sliders.

### Changed: README documentation

Full documentation added: effect groups, analogue effects table with descriptions,
named controls section, tooltip section, updated effect counts to 44 total.

### Changed: CLAUDE.md

Added verification commands for HTTP serving and JS brace balance checks.

### Stats

- **44 total effects** (25 original + 19 analogue)
- **1,019 lines added**, 127 lines removed across 8 files
- **75 new named sliders** across the 19 analogue effects
- **~200 tooltip description strings**
- **Fully backwards compatible** with all existing v2 share links
