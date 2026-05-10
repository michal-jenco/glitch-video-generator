import { Pipeline, EFFECTS } from './shaders.js';
import { ChaosEngine, parseSeed } from './glitch.js';
import { ProceduralSource, ImageSource, VideoSource, WebcamSource } from './sources.js';
import { Recorder, detectRecorderMode } from './recorder.js';
import { GifExporter, downloadBlob } from './gif-exporter.js';
import { listPresets, savePreset, deletePreset, captureState, stateToHash, stateFromHash } from './presets.js';

const canvas = document.getElementById('stage');
const pipeline = new Pipeline(canvas);
const chaos = new ChaosEngine({ seed: parseSeed('0xCAFEBABE') });
const recorder = new Recorder(canvas);
const gifExporter = new GifExporter(canvas);

let source = new WebcamSource('user', (typeof matchMedia === 'function' && matchMedia('(orientation: portrait)').matches) ? 'portrait' : 'landscape');
// sync row visibility to match the default webcam selection
document.addEventListener('DOMContentLoaded', () => {}, { once: true });
// rows aren't hidden by CSS default — fix initial state inline
// (switchSource handles this on change; we mirror it here for the initial load)
requestAnimationFrame(() => {
  $('proceduralRow').classList.add('hidden');
  $('uploadRow').classList.add('hidden');
  $('webcamRow').classList.remove('hidden');
  WebcamSource.flipSupported().then(has => {
    $('flipCamBtn').style.display = has ? '' : 'none';
  });
});

// ---------- resize ----------
const ASPECT_RATIOS = {
  'free': null,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '1:1': 1,
  '21:9': 21 / 9,
};
const RES_CAPS = { 'auto': null, '480p': 480, '720p': 720, '1080p': 1080 };

let aspectLock = 'free';
let resolutionCap = 'auto';
let fitMode = 'contain';
let tileCols = 4;
let tileRows = 4;

function resize(){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const portrait = document.body.classList.contains('portrait');
  const baseW = window.innerWidth * dpr;
  const baseH = (portrait ? window.innerHeight * 0.5 : window.innerHeight) * dpr;
  const ratio = ASPECT_RATIOS[aspectLock] ?? null;

  let w, h;
  if (ratio == null) {
    w = baseW; h = baseH;
  } else if (baseW / baseH > ratio) {
    h = baseH; w = baseH * ratio;
  } else {
    w = baseW; h = baseW / ratio;
  }

  const cap = RES_CAPS[resolutionCap] ?? null;
  if (cap != null) {
    const shortEdge = Math.min(w, h);
    if (shortEdge > cap) {
      const scale = cap / shortEdge;
      w *= scale; h *= scale;
    }
  }

  // Keep dims even — yuv420p MP4 encoding needs it.
  w = Math.max(2, Math.floor(w / 2) * 2);
  h = Math.max(2, Math.floor(h / 2) * 2);

  if (canvas.width !== w || canvas.height !== h){
    canvas.width = w; canvas.height = h;
    pipeline.resize(w, h);
  }

  const locked = ratio != null || cap != null;
  if (locked) {
    canvas.classList.add('locked');
    canvas.style.width = (w / dpr) + 'px';
    canvas.style.height = (h / dpr) + 'px';
  } else {
    canvas.classList.remove('locked');
    canvas.style.width = '';
    canvas.style.height = '';
  }
}
window.addEventListener('resize', resize);
resize();

// ---------- orientation ----------
function getOrientation(){
  // Prefer viewport-based detection — screen.orientation reports the device
  // screen, not our (possibly windowed/iframed) viewport.
  if (typeof matchMedia === 'function'){
    if (matchMedia('(orientation: portrait)').matches) return 'portrait';
    if (matchMedia('(orientation: landscape)').matches) return 'landscape';
  }
  const t = (typeof screen !== 'undefined' && screen.orientation && screen.orientation.type) || '';
  if (t.startsWith('portrait')) return 'portrait';
  return 'landscape';
}

let _webcamReorientTimer = null;
function updateFitMode(){
  const alignY = 0.0;
  const effectiveMode = (fitMode === 'contain' && aspectLock !== 'free') ? 'cover' : fitMode;
  pipeline.setFitMode(effectiveMode, alignY, tileCols, tileRows);
}

function updateFitUI(){
  updateFitMode();
  tileOptionsRow.classList.toggle('hidden', fitMode !== 'tile');
}
function applyOrientationLayout(){
  const o = getOrientation();
  document.body.classList.toggle('portrait', o === 'portrait');
  document.body.classList.toggle('landscape', o === 'landscape');
  resize();
  updateFitMode();
  if (typeof source !== 'undefined' && source instanceof WebcamSource){
    clearTimeout(_webcamReorientTimer);
    _webcamReorientTimer = setTimeout(() => {
      if (source instanceof WebcamSource) source.setOrientation(o);
    }, 250);
  }
}

if (typeof screen !== 'undefined' && screen.orientation && screen.orientation.addEventListener){
  screen.orientation.addEventListener('change', applyOrientationLayout);
}
if (typeof matchMedia === 'function'){
  const mq = matchMedia('(orientation: portrait)');
  if (mq.addEventListener) mq.addEventListener('change', applyOrientationLayout);
  else if (mq.addListener) mq.addListener(applyOrientationLayout);
}
window.addEventListener('resize', applyOrientationLayout);
applyOrientationLayout();

// ---------- UI wiring ----------
const $ = id => document.getElementById(id);

const intensityEl = $('intensity'), intensityOut = $('intensityOut');
const chaosRateEl = $('chaosRate'), chaosRateOut = $('chaosRateOut');
const maxFxEl = $('maxFx'), maxFxOut = $('maxFxOut');
const seedEl = $('seed');
const fpsEl = $('fps');
const activeFxEl = $('activeFx');
const aspectLockEl = $('aspectLock');
const resolutionCapEl = $('resolutionCap');
const fitModeEl = $('fitMode');
const tileOptionsRow = $('tileOptions');
const tileColsEl = $('tileCols');
const tileRowsEl = $('tileRows');
const recBtn = $('recBtn');
const downloadBtn = $('downloadBtn');
const exportMp4Btn = $('exportMp4Btn');
const recStatus = $('recStatus');
const gifBtn = $('gifBtn');
const gifDuration = $('gifDuration');
const gifStatus = $('gifStatus');
const snapshotBtn = $('snapshotBtn');
const presetNameEl = $('presetName');
const presetSelect = $('presetSelect');
const savePresetBtn = $('savePresetBtn');
const loadPresetBtn = $('loadPresetBtn');
const deletePresetBtn = $('deletePresetBtn');
const sharePresetBtn = $('sharePresetBtn');
const proceduralRow = $('proceduralRow');
const uploadRow = $('uploadRow');
const videoControlsRow = $('videoControlsRow');
const videoPlayBtn = $('videoPlayBtn');
const videoRewindBtn = $('videoRewindBtn');
const videoSeekBar = $('videoSeekBar');
const videoTime = $('videoTime');
const videoAudioBtn = $('videoAudioBtn');
const videoVolumeSlider = $('videoVolumeSlider');
const webcamRow = $('webcamRow');
const flipCamBtn = $('flipCamBtn');
const mirrorBtn = $('mirrorBtn');
const pauseBtn = $('pauseBtn');
const lockChainBtn = $('lockChainBtn');
const effectsList = $('effectsList');
const enableAllEffectsBtn = $('enableAllEffects');
const disableAllEffectsBtn = $('disableAllEffects');
const randomizeTogglesBtn = $('randomizeToggles');
const randomizeParamsBtn = $('randomizeParams');
const resetPostAdjustmentsBtn = $('resetPostAdjustments');
const postExposureEl = $('postExposure'), postExposureOut = $('postExposureOut');
const postContrastEl = $('postContrast'), postContrastOut = $('postContrastOut');
const postSaturationEl = $('postSaturation'), postSaturationOut = $('postSaturationOut');
const postVibranceEl = $('postVibrance'), postVibranceOut = $('postVibranceOut');
const groupOriginalCb = $('groupOriginal');
const groupAnalogueCb = $('groupAnalogue');
const groupBentCb = $('groupBent');
const groupStudioCb = $('groupStudio');

function currentPostAdjustments(){
  return {
    exposure: +postExposureEl.value,
    contrast: +postContrastEl.value,
    saturation: +postSaturationEl.value,
    vibrance: +postVibranceEl.value,
  };
}

function syncPostAdjustments(){
  postExposureOut.textContent = (+postExposureEl.value).toFixed(2);
  postContrastOut.textContent = (+postContrastEl.value).toFixed(2);
  postSaturationOut.textContent = (+postSaturationEl.value).toFixed(2);
  postVibranceOut.textContent = (+postVibranceEl.value).toFixed(2);
  pipeline.setPostAdjustments(currentPostAdjustments());
}

function syncOutputs(){
  intensityOut.textContent = (+intensityEl.value).toFixed(2);
  chaosRateOut.textContent = (+chaosRateEl.value).toFixed(2);
  maxFxOut.textContent = maxFxEl.value;
}
syncOutputs();
syncPostAdjustments();

intensityEl.addEventListener('input', syncOutputs);
for (const el of [postExposureEl, postContrastEl, postSaturationEl, postVibranceEl]) {
  el.addEventListener('input', syncPostAdjustments);
}
resetPostAdjustmentsBtn.addEventListener('click', () => {
  postExposureEl.value = 0;
  postContrastEl.value = 1;
  postSaturationEl.value = 1;
  postVibranceEl.value = 1;
  syncPostAdjustments();
});
chaosRateEl.addEventListener('input', () => {
  syncOutputs();
  chaos.setChaosRate(+chaosRateEl.value);
});
maxFxEl.addEventListener('input', () => {
  syncOutputs();
  chaos.setMaxActive(+maxFxEl.value);
});
chaos.setChaosRate(+chaosRateEl.value);
chaos.setMaxActive(+maxFxEl.value);

seedEl.addEventListener('change', () => {
  chaos.setSeed(parseSeed(seedEl.value));
});
$('reseed').addEventListener('click', () => {
  const v = '0x' + Math.floor(Math.random()*0xffffffff).toString(16).toUpperCase().padStart(8,'0');
  seedEl.value = v;
  chaos.setSeed(parseSeed(v));
});

aspectLockEl.addEventListener('change', () => {
  aspectLock = aspectLockEl.value;
  resize();
  updateFitMode();
});
resolutionCapEl.addEventListener('change', () => {
  resolutionCap = resolutionCapEl.value;
  resize();
});

fitModeEl.addEventListener('change', () => {
  fitMode = fitModeEl.value;
  updateFitUI();
});

tileColsEl.addEventListener('change', () => {
  tileCols = +tileColsEl.value;
  updateFitUI();
});

tileRowsEl.addEventListener('change', () => {
  tileRows = +tileRowsEl.value;
  updateFitUI();
});

document.querySelectorAll('input[name="source"]').forEach(r => {
  r.addEventListener('change', () => switchSource(r.value, null));
});

$('proceduralPattern').addEventListener('change', e => {
  if (source instanceof ProceduralSource) source.setPattern(e.target.value);
});

function formatTime(seconds){
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function updateVideoCtrlBtns(){
  if (!(source instanceof VideoSource)) return;
  videoAudioBtn.textContent = source.muted ? '🔇 audio: off' : '🔊 audio: on';
  videoPlayBtn.textContent = source.paused ? '▶ play' : '⏸ pause';
  videoVolumeSlider.value = source.volume;
}

$('fileInput').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (source.stop) source.stop();
  source = file.type.startsWith('video') ? new VideoSource(file) : new ImageSource(file);
  videoControlsRow.classList.toggle('hidden', !(source instanceof VideoSource));
  updateVideoCtrlBtns();
});

let webcamFacing = 'user'; // 'user' = front, 'environment' = back
let webcamMirror = null;   // null = use facingMode default; otherwise sticky override

function updateMirrorBtn(){
  if (!(source instanceof WebcamSource)) return;
  mirrorBtn.textContent = source.mirrored ? '⇋ mirror: on' : '⇋ mirror: off';
}

function switchSource(kind, facingMode){
  if (source.stop) source.stop();
  uploadRow.classList.toggle('hidden', kind !== 'upload');
  videoControlsRow.classList.add('hidden');
  proceduralRow.classList.toggle('hidden', kind !== 'procedural');
  webcamRow.classList.toggle('hidden', kind !== 'webcam');
  if (kind === 'procedural'){
    source = new ProceduralSource();
    source.setPattern($('proceduralPattern').value);
  } else if (kind === 'webcam'){
    webcamFacing = facingMode || webcamFacing;
    source = new WebcamSource(webcamFacing, getOrientation());
    if (webcamMirror !== null) source.setMirror(webcamMirror);
    updateMirrorBtn();
    // Show flip button only when device has multiple cameras
    WebcamSource.flipSupported().then(has => {
      flipCamBtn.style.display = has ? '' : 'none';
    });
  } else {
    // upload — wait for file; fall back to procedural until then
    source = new ProceduralSource();
  }
}

flipCamBtn.addEventListener('click', () => {
  webcamFacing = webcamFacing === 'user' ? 'environment' : 'user';
  flipCamBtn.textContent = webcamFacing === 'user' ? '⇄ flip cam' : '⇄ front cam';
  webcamMirror = null; // reset to per-camera default on flip
  switchSource('webcam', webcamFacing);
});

mirrorBtn.addEventListener('click', () => {
  if (!(source instanceof WebcamSource)) return;
  source.setMirror(!source.mirrored);
  webcamMirror = source.mirrored;
  updateMirrorBtn();
});

videoAudioBtn.addEventListener('click', () => {
  if (!(source instanceof VideoSource)) return;
  source.setMuted(!source.muted);
  updateVideoCtrlBtns();
});

videoPlayBtn.addEventListener('click', () => {
  if (!(source instanceof VideoSource)) return;
  if (source.paused) source.play(); else source.pause();
  updateVideoCtrlBtns();
});

videoRewindBtn.addEventListener('click', () => {
  if (!(source instanceof VideoSource)) return;
  source.seek(0);
});

videoSeekBar.addEventListener('input', () => {
  if (!(source instanceof VideoSource)) return;
  videoSeeking = true;
  source.seek(+videoSeekBar.value);
});
videoSeekBar.addEventListener('change', () => {
  videoSeeking = false;
});

videoVolumeSlider.addEventListener('input', () => {
  if (!(source instanceof VideoSource)) return;
  source.setVolume(+videoVolumeSlider.value);
  updateVideoCtrlBtns();
});

recBtn.addEventListener('click', async () => {
  if (recorder.isRecording()){
    recBtn.disabled = true;
    await recorder.stop();
    recBtn.disabled = false;
    recBtn.classList.remove('recording');
    recBtn.textContent = '● REC';
    recStatus.textContent = 'saved';
  } else {
    recBtn.disabled = true;
    const audioTrack = (source instanceof VideoSource && !source.muted) ? source.audioTrack() : null;
    try { await recorder.start(audioTrack); }
    finally { recBtn.disabled = false; }
    recBtn.classList.add('recording');
    recBtn.textContent = '■ STOP';
    exportMp4Btn.disabled = true;
    recStatus.textContent = 'recording...';
  }
});

const fallbackHintEl = $('mp4FallbackHint');

// Show the slow-ffmpeg hint only when we're certain we'll fall through to
// the ffmpeg path. For 'webcodecs' we DON'T pre-hide WEBM, because Firefox
// can claim WebCodecs support and then fail at actual encode time — driving
// UI from detection alone leaves users with slow MP4 and no fast escape.
// We update the buttons based on the recording's REAL container instead.
detectRecorderMode().then(mode => {
  if (mode === 'native-mp4'){
    // Reliable: every native-mp4 recording will be mp4. Hide WEBM up front.
    downloadBtn.style.display = 'none';
  } else if (mode === 'webm-ffmpeg'){
    if (fallbackHintEl) fallbackHintEl.style.display = '';
  }
  // 'webcodecs' case: leave both buttons visible, decide after the recording.
});

recorder.onFinished = () => {
  downloadBtn.disabled = !recorder.hasRecording();
  exportMp4Btn.disabled = !recorder.hasRecording();
  recStatus.textContent = 'saved';
  // Trust-but-verify: pick UI based on what actually got recorded.
  const container = recorder.recordedContainer();
  if (container === 'mp4'){
    downloadBtn.style.display = 'none';
    if (fallbackHintEl) fallbackHintEl.style.display = 'none';
  } else if (container === 'webm'){
    // WebCodecs failed (or we were on the ffmpeg tier all along). Restore
    // WEBM as the fast option and warn that MP4 will be slow.
    downloadBtn.style.display = '';
    if (fallbackHintEl) fallbackHintEl.style.display = '';
  }
};

downloadBtn.addEventListener('click', () => {
  const ok = recorder.download(seedEl.value.replace(/\s+/g, '_'));
  if (ok) {
    recStatus.textContent = 'downloaded';
  }
});

exportMp4Btn.addEventListener('click', async () => {
  if (!recorder.hasRecording()) return;
  exportMp4Btn.disabled = true;
  const base = seedEl.value.replace(/\s+/g, '_');
  recStatus.textContent = 'mp4 loading core...';
  try {
    const ok = await recorder.exportMp4(base, (progress) => {
      recStatus.textContent = `mp4 ${Math.round(progress * 100)}%`;
    }, (status) => {
      recStatus.textContent = status;
    });
    if (ok) recStatus.textContent = 'mp4 downloaded';
  } catch (err) {
    console.error('mp4 export failed', err);
    recStatus.textContent = 'mp4 failed';
  } finally {
    exportMp4Btn.disabled = !recorder.hasRecording();
  }
});

$('panelToggle').addEventListener('click', () => {
  $('panel').classList.toggle('hidden');
});

// ---------- GIF export ----------
let gifRecording = false;
gifBtn.addEventListener('click', async () => {
  if (gifRecording) return;
  gifRecording = true;
  gifBtn.classList.add('recording');
  gifBtn.textContent = '⏳ GIF';
  const duration = +gifDuration.value;
  const seed = seedEl.value.replace(/\s+/g, '_');
  try {
    const blob = await gifExporter.record({
      fps: 12,
      duration,
      quality: 8,
      maxWidth: 480,
      onProgress: p => { gifStatus.textContent = (p * 100).toFixed(0) + '%'; },
      onStatus: s => { gifStatus.textContent = s; },
    });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `glitch-${seed}-${ts}.gif`);
    gifStatus.textContent = 'saved!';
  } catch (err) {
    console.error('gif failed', err);
    gifStatus.textContent = 'failed';
  } finally {
    gifRecording = false;
    gifBtn.classList.remove('recording');
    gifBtn.textContent = '● GIF';
    setTimeout(() => { gifStatus.textContent = ''; }, 3000);
  }
});

// ---------- PNG snapshot ----------
snapshotBtn.addEventListener('click', () => {
  canvas.toBlob(blob => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `glitch-snap-${ts}.png`);
  }, 'image/png');
});

// ---------- Presets ----------
function refreshPresetDropdown() {
  const all = listPresets();
  const names = Object.keys(all).sort();
  presetSelect.innerHTML = '<option value="">— load preset —</option>';
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    presetSelect.appendChild(opt);
  }
}
refreshPresetDropdown();

function randomGlitchyName() {
  const prefixes = ['VOID','NULL','CORRUPT','STATIC','DRIFT','CHAOS','GLITCH','SIGNAL','NOISE','ERROR','BLEED','FLUX'];
  const suffixes = ['LOOP','FRAME','PULSE','BURST','TRACE','CORE','DECAY','WAVE','BURN','GHOST'];
  const hex = () => Math.floor(Math.random()*0x100).toString(16).toUpperCase().padStart(2,'0');
  const p = prefixes[Math.floor(Math.random()*prefixes.length)];
  const s = suffixes[Math.floor(Math.random()*suffixes.length)];
  return `${p}_${s}_${hex()}${hex()}`;
}

presetNameEl.value = randomGlitchyName();

function currentSourceKind() {
  return document.querySelector('input[name="source"]:checked')?.value || 'webcam';
}

function collectState() {
  return captureState({
    seed: seedEl.value,
    intensity: intensityEl.value,
    chaosRate: chaosRateEl.value,
    maxFx: maxFxEl.value,
    effectConfig: chaos.effectConfig,
    activeGroups: [...chaos.groupConfig].filter(([_,v]) => v).map(([k]) => k),
    source: currentSourceKind(),
    proceduralPattern: $('proceduralPattern').value,
    chainLocked,
    webcamFacing,
    gifDuration: +gifDuration.value,
    lockedPasses: chaos.lockedPasses,
    aspectLock,
    resolutionCap,
    fitMode,
    tileCols,
    tileRows,
    postAdjustments: currentPostAdjustments(),
  });
}

function applyState(state) {
  if (state.seed != null) { seedEl.value = state.seed; chaos.setSeed(parseSeed(state.seed)); }
  if (state.intensity != null) { intensityEl.value = state.intensity; }
  if (state.chaosRate != null) { chaosRateEl.value = state.chaosRate; chaos.setChaosRate(+state.chaosRate); }
  if (state.maxFx != null) { maxFxEl.value = state.maxFx; chaos.setMaxActive(+state.maxFx); }
  if (state.postAdjustments) {
    const p = state.postAdjustments;
    if (p.exposure != null) postExposureEl.value = p.exposure;
    if (p.contrast != null) postContrastEl.value = p.contrast;
    if (p.saturation != null) postSaturationEl.value = p.saturation;
    if (p.vibrance != null) postVibranceEl.value = p.vibrance;
    syncPostAdjustments();
  }
  const allGroups = [...new Set(EFFECTS.map(fx => fx.group).filter(Boolean))];
  const groups = state.activeGroups || ['original'];
  for (const g of allGroups){
    const active = groups.includes(g);
    chaos.setGroupEnabled(g, active);
    const cb = document.querySelector(`input[data-group="${g}"]`);
    if (cb) cb.checked = active;
    const wrapper = document.querySelector(`.fxGroup[data-group="${g}"]`);
    if (wrapper) wrapper.style.display = active ? '' : 'none';
  }
  if (state.effects) {
    for (const fx of state.effects) {
      chaos.setEffectConfig(fx.name, { enabled: fx.enabled, amount: fx.amount, weight: fx.weight, params: fx.params || {} });
      const cb = effectsList.querySelector(`input[data-fx="${fx.name}"][data-kind="enabled"]`);
      if (cb) cb.checked = fx.enabled;
      const amt = effectsList.querySelector(`input[data-fx="${fx.name}"][data-kind="amount"]`);
      if (amt) { amt.value = fx.amount; const o = amt.parentElement.querySelector('output'); if (o) o.textContent = (+fx.amount).toFixed(2); }
      const wgt = effectsList.querySelector(`input[data-fx="${fx.name}"][data-kind="weight"]`);
      if (wgt) { wgt.value = fx.weight; const o = wgt.parentElement.querySelector('output'); if (o) o.textContent = (+fx.weight).toFixed(2); }
      // Restore named param sliders
      const paramOverrides = fx.params || {};
      for (const [pi, val] of Object.entries(paramOverrides)) {
        const pslider = effectsList.querySelector(`input[data-fx="${fx.name}"][data-kind="param"][data-param="${pi}"]`);
        if (pslider) { pslider.value = val; const o = pslider.parentElement.querySelector('output'); if (o) o.textContent = (+val).toFixed(2); }
      }
    }
  }
  if (state.source && state.source !== 'upload') {
    const radio = document.querySelector(`input[name="source"][value="${state.source}"]`);
    if (radio) radio.checked = true;
    if (state.source === 'procedural' && state.proceduralPattern) {
      $('proceduralPattern').value = state.proceduralPattern;
    }
    if (state.source === 'webcam' && state.webcamFacing) webcamFacing = state.webcamFacing;
    switchSource(state.source, state.webcamFacing || null);
  }
  if (state.gifDuration != null) gifDuration.value = state.gifDuration;
  if (state.aspectLock && ASPECT_RATIOS[state.aspectLock] !== undefined) {
    aspectLock = state.aspectLock;
    aspectLockEl.value = aspectLock;
  }
  if (state.resolutionCap && RES_CAPS[state.resolutionCap] !== undefined) {
    resolutionCap = state.resolutionCap;
    resolutionCapEl.value = resolutionCap;
  }
  if (state.tileCols != null) {
    tileCols = state.tileCols;
    tileColsEl.value = tileCols;
  }
  if (state.tileRows != null) {
    tileRows = state.tileRows;
    tileRowsEl.value = tileRows;
  }
  if (state.fitMode) {
    fitMode = state.fitMode;
    fitModeEl.value = fitMode;
    updateFitUI();
  }
  resize();
  if (state.chainLocked != null) {
    if (state.chainLocked && state.lockedPasses?.length) {
      // Restore the exact pass snapshot — reproduces the same visual
      chainLocked = true;
      lockChainBtn.textContent = 'unlock chain';
      chaos.restoreLockedPasses(state.lockedPasses);
    } else if (state.chainLocked) {
      // No saved passes (old preset) — defer until chaos engine populates
      chainLocked = false;
      lockChainBtn.textContent = 'lock chain';
      chaos.setLocked(false);
      setTimeout(() => {
        chainLocked = true;
        lockChainBtn.textContent = 'unlock chain';
        chaos.setLocked(true, performance.now() / 1000);
      }, 400);
    } else {
      chainLocked = false;
      lockChainBtn.textContent = 'lock chain';
      chaos.setLocked(false);
    }
  }
  syncOutputs();
}

savePresetBtn.addEventListener('click', () => {
  const name = presetNameEl.value.trim();
  if (!name) { presetNameEl.focus(); return; }
  savePreset(name, collectState());
  refreshPresetDropdown();
  presetSelect.value = name;
  presetNameEl.value = randomGlitchyName();
});

loadPresetBtn.addEventListener('click', () => {
  const name = presetSelect.value;
  if (!name) return;
  const all = listPresets();
  if (all[name]) applyState(all[name]);
});

deletePresetBtn.addEventListener('click', () => {
  const name = presetSelect.value;
  if (!name) return;
  deletePreset(name);
  refreshPresetDropdown();
});

sharePresetBtn.addEventListener('click', () => {
  const hash = stateToHash(collectState());
  const url = window.location.origin + window.location.pathname + hash;
  navigator.clipboard.writeText(url).then(() => {
    sharePresetBtn.textContent = '✓ copied!';
    setTimeout(() => { sharePresetBtn.textContent = '⇗ copy share link'; }, 2000);
  }).catch(() => {
    prompt('Copy this link:', url);
  });
});

// Auto-load preset from URL hash on startup
const hashState = stateFromHash();
if (hashState) {
  // defer until effect controls are mounted
  requestAnimationFrame(() => {
    applyState(hashState);
    window.history.replaceState(null, '', window.location.pathname);
  });
}

// ---------- tooltip box ----------
const tooltipBox = document.createElement('div');
tooltipBox.className = 'tooltip-box hidden';
document.body.appendChild(tooltipBox);

let tooltipTarget = null;

function buildTooltipHTML(fxMeta){
  let html = `<strong>${fxMeta.name}</strong><br><br>${fxMeta.desc || ''}`;
  html += `<br><br><span class="param-name">amt</span> — overall intensity when this effect activates`;
  html += `<br><span class="param-name">freq</span> — how often this effect is randomly selected`;
  if (fxMeta.controls && fxMeta.controls.length){
    html += `<br><br><strong>Parameters:</strong>`;
    for (const ctrl of fxMeta.controls){
      html += `<br><span class="param-name">${ctrl.label}</span> — ${ctrl.desc || ''}`;
    }
  } else if (fxMeta.paramDescs){
    html += `<br><br><strong>Parameters:</strong>`;
    for (let i = 0; i < fxMeta.paramDescs.length; i++){
      html += `<br><span class="param-name">param ${i}</span> — ${fxMeta.paramDescs[i]}`;
    }
  }
  return html;
}

function showTooltip(trigger){
  const name = trigger.dataset.fx;
  const fxMeta = EFFECTS.find(f => f.name === name);
  if (!fxMeta) return;
  tooltipBox.innerHTML = buildTooltipHTML(fxMeta);
  tooltipBox.classList.remove('hidden');
  tooltipTarget = trigger;
  // Position anchored to trigger, clamping within viewport
  const rect = trigger.getBoundingClientRect();
  const tooltipW = 340;
  const tooltipH = tooltipBox.offsetHeight || 200;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + tooltipW > window.innerWidth) left = window.innerWidth - tooltipW - 10;
  if (left < 10) left = 10;
  if (top + tooltipH > window.innerHeight) top = rect.top - tooltipH - 6;
  if (top < 10) top = 10;
  tooltipBox.style.left = left + 'px';
  tooltipBox.style.top = top + 'px';
  trigger.classList.add('active');
}

function hideTooltip(trigger){
  tooltipBox.classList.add('hidden');
  tooltipTarget = null;
  if (trigger) trigger.classList.remove('active');
}

document.addEventListener('click', (e) => {
  if (tooltipTarget && !tooltipTarget.contains(e.target) && !tooltipBox.contains(e.target)){
    hideTooltip(tooltipTarget);
  }
});

window.addEventListener('scroll', () => {
  if (tooltipTarget) hideTooltip(tooltipTarget);
}, { passive: true });

function mountEffectControls(){
  effectsList.innerHTML = '';
  const groups = {};
  for (const fx of EFFECTS){
    const g = fx.group || 'original';
    if (!groups[g]) groups[g] = [];
    groups[g].push(fx);
  }

  for (const [groupName, fxList] of Object.entries(groups)){
    const wrapper = document.createElement('div');
    wrapper.className = 'fxGroup';
    wrapper.dataset.group = groupName;

    for (const fx of fxList){
      const card = document.createElement('div');
      card.className = 'fxCard';
      const amountDefault = fx.defaultAmount ?? 1;
      const weightDefault = fx.defaultWeight ?? 1;
      let inner = `<div class="fxTop"><label><input type="checkbox" data-fx="${fx.name}" data-kind="enabled" checked><span class="fxName">${fx.name}</span></label><span class="tooltip-trigger" data-fx="${fx.name}" title="Show details">\u24D8</span></div>`;
      inner += `<label class="slider"><span>amt</span><input type="range" min="0" max="2" step="0.01" value="${amountDefault}" data-fx="${fx.name}" data-kind="amount"><output>${amountDefault.toFixed(2)}</output></label>`;
      inner += `<label class="slider"><span>freq</span><input type="range" min="0" max="3" step="0.01" value="${weightDefault}" data-fx="${fx.name}" data-kind="weight"><output>${weightDefault.toFixed(2)}</output></label>`;
      if (fx.controls){
        for (const ctrl of fx.controls){
          inner += `<label class="slider paramSlider"><span>${ctrl.label}</span><input type="range" min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step}" value="${ctrl.default}" data-fx="${fx.name}" data-kind="param" data-param="${ctrl.param}"><output>${ctrl.default.toFixed(2)}</output></label>`;
        }
      }
      card.innerHTML = inner;
      wrapper.appendChild(card);
    }

    effectsList.appendChild(wrapper);
  }

  // Tooltip: hover on ⓘ icons
  effectsList.addEventListener('mouseover', (e) => {
    const trigger = e.target.closest('.tooltip-trigger');
    if (trigger) showTooltip(trigger);
  });
  effectsList.addEventListener('mouseout', (e) => {
    const trigger = e.target.closest('.tooltip-trigger');
    if (trigger) hideTooltip(trigger);
  });
  // Touch: tap to toggle
  effectsList.addEventListener('click', (e) => {
    const trigger = e.target.closest('.tooltip-trigger');
    if (!trigger) return;
    if (tooltipTarget === trigger) {
      hideTooltip(trigger);
    } else {
      if (tooltipTarget) hideTooltip(tooltipTarget);
      showTooltip(trigger);
    }
    e.preventDefault();
    e.stopPropagation();
  });

  effectsList.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.fx || !t.dataset.kind) return;
    const name = t.dataset.fx;
    const kind = t.dataset.kind;
    if (kind === 'enabled'){
      chaos.setEffectConfig(name, { enabled: t.checked });
      return;
    }
    const value = +t.value;
    const out = t.parentElement.querySelector('output');
    if (out) out.textContent = value.toFixed(2);
    if (kind === 'amount'){ chaos.setEffectConfig(name, { amount: value }); return; }
    if (kind === 'weight'){ chaos.setEffectConfig(name, { weight: value }); return; }
    if (kind === 'param'){
      const paramIdx = +t.dataset.param;
      const current = chaos.effectConfig.get(name);
      const params = { ...(current?.params || {}) };
      params[paramIdx] = value;
      chaos.setEffectConfig(name, { params });
      return;
    }
  });
}
mountEffectControls();
if (groupStudioCb && !groupStudioCb.checked){
  const studioFx = document.querySelector('.fxGroup[data-group="studio"]');
  if (studioFx) studioFx.style.display = 'none';
}

// ---------- group toggles ----------
groupOriginalCb.addEventListener('change', () => {
  const active = groupOriginalCb.checked;
  chaos.setGroupEnabled('original', active);
  const wrapper = document.querySelector('.fxGroup[data-group="original"]');
  if (wrapper) wrapper.style.display = active ? '' : 'none';
});

groupAnalogueCb.addEventListener('change', () => {
  const active = groupAnalogueCb.checked;
  chaos.setGroupEnabled('analogue', active);
  const wrapper = document.querySelector('.fxGroup[data-group="analogue"]');
  if (wrapper) wrapper.style.display = active ? '' : 'none';
});

groupBentCb.addEventListener('change', () => {
  const active = groupBentCb.checked;
  chaos.setGroupEnabled('bent', active);
  const wrapper = document.querySelector('.fxGroup[data-group="bent"]');
  if (wrapper) wrapper.style.display = active ? '' : 'none';
});

groupStudioCb.addEventListener('change', () => {
  const active = groupStudioCb.checked;
  chaos.setGroupEnabled('studio', active);
  const wrapper = document.querySelector('.fxGroup[data-group="studio"]');
  if (wrapper) wrapper.style.display = active ? '' : 'none';
});

randomizeTogglesBtn.addEventListener('click', () => {
  const checks = effectsList.querySelectorAll('input[data-kind="enabled"]');
  let enabledCount = 0;
  checks.forEach((el) => {
    const on = Math.random() > 0.35;
    el.checked = on;
    if (on) enabledCount++;
    chaos.setEffectConfig(el.dataset.fx, { enabled: on });
  });
  // Keep at least one effect enabled.
  if (enabledCount === 0 && checks.length) {
    const fallback = checks[Math.floor(Math.random() * checks.length)];
    fallback.checked = true;
    chaos.setEffectConfig(fallback.dataset.fx, { enabled: true });
  }
});

enableAllEffectsBtn.addEventListener('click', () => {
  const checks = effectsList.querySelectorAll('input[data-kind="enabled"]');
  if (!checks.length) return;
  checks.forEach((el) => {
    el.checked = true;
    chaos.setEffectConfig(el.dataset.fx, { enabled: true });
  });
});

disableAllEffectsBtn.addEventListener('click', () => {
  const checks = effectsList.querySelectorAll('input[data-kind="enabled"]');
  if (!checks.length) return;
  checks.forEach((el) => {
    el.checked = false;
    chaos.setEffectConfig(el.dataset.fx, { enabled: false });
  });
});

randomizeParamsBtn.addEventListener('click', () => {
  const sliders = effectsList.querySelectorAll('input[data-kind="amount"], input[data-kind="weight"], input[data-kind="param"]');
  sliders.forEach((el) => {
    const kind = el.dataset.kind;
    let value;
    if (kind === 'amount') value = 0.1 + Math.random() * 1.9;
    else if (kind === 'weight') value = Math.random() * 3.0;
    else value = Math.random() * +el.max;
    el.value = value.toFixed(2);
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = (+el.value).toFixed(2);
    if (kind === 'amount') chaos.setEffectConfig(el.dataset.fx, { amount: +el.value });
    else if (kind === 'weight') chaos.setEffectConfig(el.dataset.fx, { weight: +el.value });
    else if (kind === 'param'){
      const paramIdx = +el.dataset.param;
      const current = chaos.effectConfig.get(el.dataset.fx);
      const params = { ...(current?.params || {}) };
      params[paramIdx] = value;
      chaos.setEffectConfig(el.dataset.fx, { params });
    }
  });
});

// ---------- main loop ----------
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fpsT = 0;
let paused = false;
let frozenFrame = null;
let chainLocked = false;
let videoSeeking = false;

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'unpause' : 'pause';
  if (!paused) {
    last = performance.now();
    frozenFrame = null;
  }
});

lockChainBtn.addEventListener('click', () => {
  chainLocked = !chainLocked;
  lockChainBtn.textContent = chainLocked ? 'unlock chain' : 'lock chain';
  chaos.setLocked(chainLocked, performance.now() / 1000);
});

function frame(){
  const now = performance.now();
  const dt = (now - last) / 1000;
  if (!paused) last = now;
  const t = now / 1000;

  if (!paused) {
    if (source.ready()){
      pipeline.uploadSource(source.frame(t));
    } else if (source.frame) {
      // prime with whatever is there (procedural always ready); for not-ready video/img, skip
    }

    if (source instanceof VideoSource && source.ready() && !videoSeeking) {
      const dur = source.duration();
      const ct = source.currentTime();
      if (isFinite(dur) && dur > 0 && isFinite(ct)) {
        videoSeekBar.max = dur;
        videoSeekBar.value = ct;
        videoTime.textContent = formatTime(ct) + ' / ' + formatTime(dur);
      }
    }

    chaos.update(t);
    const passes = chaos.passes(t);
    frozenFrame = {
      passes,
      time: t,
      seed: (chaos.seed % 100000) / 100000,
      globalIntensity: +intensityEl.value,
    };
  }

  if (frozenFrame) {
    pipeline.render(frozenFrame);
  }

  // FPS
  if (!paused) {
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5){
      const fps = fpsFrames / fpsAcc;
      fpsEl.textContent = fps.toFixed(0).padStart(3) + ' fps';
      fpsAcc = 0; fpsFrames = 0;
    }
  } else {
    fpsEl.textContent = 'PAUSED';
  }
  activeFxEl.textContent = chaos.describe();

  if (recorder.isRecording()){
    const s = recorder.elapsedSeconds();
    recStatus.textContent = `REC ${s.toFixed(1)}s`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
