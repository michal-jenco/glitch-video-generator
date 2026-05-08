import { Pipeline, EFFECTS } from './shaders.js';
import { ChaosEngine, parseSeed } from './glitch.js';
import { ProceduralSource, ImageSource, VideoSource, WebcamSource } from './sources.js';
import { Recorder, nativeMp4Supported } from './recorder.js';
import { GifExporter, downloadBlob } from './gif-exporter.js';
import { listPresets, savePreset, deletePreset, captureState, stateToHash, stateFromHash } from './presets.js';

const canvas = document.getElementById('stage');
const pipeline = new Pipeline(canvas);
const chaos = new ChaosEngine({ seed: parseSeed('0xCAFEBABE') });
const recorder = new Recorder(canvas);
const gifExporter = new GifExporter(canvas);

let source = new WebcamSource('user');
// sync row visibility to match the default webcam selection
document.addEventListener('DOMContentLoaded', () => {}, { once: true });
// rows aren't hidden by CSS default — fix initial state inline
// (switchSource handles this on change; we mirror it here for the initial load)
requestAnimationFrame(() => {
  $('proceduralRow').classList.add('hidden');
  $('uploadRow').classList.add('hidden');
  $('webcamRow').classList.remove('hidden');
  WebcamSource.hasMultipleCameras().then(has => {
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

function resize(){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const baseW = window.innerWidth * dpr;
  const baseH = window.innerHeight * dpr;
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
const webcamRow = $('webcamRow');
const flipCamBtn = $('flipCamBtn');
const pauseBtn = $('pauseBtn');
const lockChainBtn = $('lockChainBtn');
const effectsList = $('effectsList');
const enableAllEffectsBtn = $('enableAllEffects');
const disableAllEffectsBtn = $('disableAllEffects');
const randomizeTogglesBtn = $('randomizeToggles');
const randomizeParamsBtn = $('randomizeParams');

function syncOutputs(){
  intensityOut.textContent = (+intensityEl.value).toFixed(2);
  chaosRateOut.textContent = (+chaosRateEl.value).toFixed(2);
  maxFxOut.textContent = maxFxEl.value;
}
syncOutputs();

intensityEl.addEventListener('input', syncOutputs);
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
});
resolutionCapEl.addEventListener('change', () => {
  resolutionCap = resolutionCapEl.value;
  resize();
});

document.querySelectorAll('input[name="source"]').forEach(r => {
  r.addEventListener('change', () => switchSource(r.value, null));
});

$('proceduralPattern').addEventListener('change', e => {
  if (source instanceof ProceduralSource) source.setPattern(e.target.value);
});

$('fileInput').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (source.stop) source.stop();
  source = file.type.startsWith('video') ? new VideoSource(file) : new ImageSource(file);
});

let webcamFacing = 'user'; // 'user' = front, 'environment' = back

function switchSource(kind, facingMode){
  if (source.stop) source.stop();
  uploadRow.classList.toggle('hidden', kind !== 'upload');
  proceduralRow.classList.toggle('hidden', kind !== 'procedural');
  webcamRow.classList.toggle('hidden', kind !== 'webcam');
  if (kind === 'procedural'){
    source = new ProceduralSource();
    source.setPattern($('proceduralPattern').value);
  } else if (kind === 'webcam'){
    webcamFacing = facingMode || webcamFacing;
    source = new WebcamSource(webcamFacing);
    // Show flip button only when device has multiple cameras
    WebcamSource.hasMultipleCameras().then(has => {
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
  switchSource('webcam', webcamFacing);
});

recBtn.addEventListener('click', () => {
  if (recorder.isRecording()){
    recorder.stop();
    recBtn.classList.remove('recording');
    recBtn.textContent = '● REC';
    recStatus.textContent = 'saved';
  } else {
    recorder.start();
    recBtn.classList.add('recording');
    recBtn.textContent = '■ STOP';
    exportMp4Btn.disabled = true;
    recStatus.textContent = 'recording...';
  }
});

// When the browser records native MP4, the WEBM button is meaningless (the
// blob already IS mp4) and the "MP4" button is just an instant download.
const NATIVE_MP4 = nativeMp4Supported();
if (NATIVE_MP4) {
  downloadBtn.style.display = 'none';
} else {
  const hint = $('mp4FallbackHint');
  if (hint) hint.style.display = '';
}

recorder.onFinished = () => {
  downloadBtn.disabled = !recorder.hasRecording();
  exportMp4Btn.disabled = !recorder.hasRecording();
  recStatus.textContent = 'saved';
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
    source: currentSourceKind(),
    proceduralPattern: $('proceduralPattern').value,
    chainLocked,
    webcamFacing,
    gifDuration: +gifDuration.value,
    lockedPasses: chaos.lockedPasses,
    aspectLock,
    resolutionCap,
  });
}

function applyState(state) {
  if (state.seed != null) { seedEl.value = state.seed; chaos.setSeed(parseSeed(state.seed)); }
  if (state.intensity != null) { intensityEl.value = state.intensity; }
  if (state.chaosRate != null) { chaosRateEl.value = state.chaosRate; chaos.setChaosRate(+state.chaosRate); }
  if (state.maxFx != null) { maxFxEl.value = state.maxFx; chaos.setMaxActive(+state.maxFx); }
  if (state.effects) {
    for (const fx of state.effects) {
      chaos.setEffectConfig(fx.name, { enabled: fx.enabled, amount: fx.amount, weight: fx.weight });
      const cb = effectsList.querySelector(`input[data-fx="${fx.name}"][data-kind="enabled"]`);
      if (cb) cb.checked = fx.enabled;
      const amt = effectsList.querySelector(`input[data-fx="${fx.name}"][data-kind="amount"]`);
      if (amt) { amt.value = fx.amount; const o = amt.parentElement.querySelector('output'); if (o) o.textContent = (+fx.amount).toFixed(2); }
      const wgt = effectsList.querySelector(`input[data-fx="${fx.name}"][data-kind="weight"]`);
      if (wgt) { wgt.value = fx.weight; const o = wgt.parentElement.querySelector('output'); if (o) o.textContent = (+fx.weight).toFixed(2); }
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

function mountEffectControls(){
  effectsList.innerHTML = '';
  for (const fx of EFFECTS){
    const card = document.createElement('div');
    card.className = 'fxCard';
    card.innerHTML = `
      <div class="fxTop">
        <label>
          <input type="checkbox" data-fx="${fx.name}" data-kind="enabled" checked>
          <span class="fxName">${fx.name}</span>
        </label>
      </div>
      <label class="slider">
        <span>amt</span>
        <input type="range" min="0" max="2" step="0.01" value="1" data-fx="${fx.name}" data-kind="amount">
        <output>1.00</output>
      </label>
      <label class="slider">
        <span>freq</span>
        <input type="range" min="0" max="3" step="0.01" value="1" data-fx="${fx.name}" data-kind="weight">
        <output>1.00</output>
      </label>
    `;
    effectsList.appendChild(card);
  }

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
    if (kind === 'amount') chaos.setEffectConfig(name, { amount: value });
    if (kind === 'weight') chaos.setEffectConfig(name, { weight: value });
  });
}
mountEffectControls();

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
  const sliders = effectsList.querySelectorAll('input[data-kind="amount"], input[data-kind="weight"]');
  sliders.forEach((el) => {
    const kind = el.dataset.kind;
    const value = kind === 'amount'
      ? 0.1 + Math.random() * 1.9
      : Math.random() * 3.0;
    el.value = value.toFixed(2);
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = (+el.value).toFixed(2);
    if (kind === 'amount') chaos.setEffectConfig(el.dataset.fx, { amount: +el.value });
    if (kind === 'weight') chaos.setEffectConfig(el.dataset.fx, { weight: +el.value });
  });
});

// ---------- main loop ----------
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fpsT = 0;
let paused = false;
let frozenFrame = null;
let chainLocked = false;

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
