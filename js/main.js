import { Pipeline, EFFECTS } from './shaders.js';
import { ChaosEngine, parseSeed } from './glitch.js';
import { ProceduralSource, ImageSource, VideoSource, WebcamSource } from './sources.js';
import { Recorder } from './recorder.js';

const canvas = document.getElementById('stage');
const pipeline = new Pipeline(canvas);
const chaos = new ChaosEngine({ seed: parseSeed('0xCAFEBABE') });
const recorder = new Recorder(canvas);

let source = new ProceduralSource();
source.setPattern('random');

// ---------- resize ----------
function resize(){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h){
    canvas.width = w; canvas.height = h;
    pipeline.resize(w, h);
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
const recBtn = $('recBtn');
const downloadBtn = $('downloadBtn');
const exportMp4Btn = $('exportMp4Btn');
const recStatus = $('recStatus');
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
      recStatus.textContent = `mp4 ${(progress * 100).toFixed(0)}%`;
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
