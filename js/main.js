import { Pipeline } from './shaders.js';
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
const recStatus = $('recStatus');
const proceduralRow = $('proceduralRow');
const uploadRow = $('uploadRow');

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
  r.addEventListener('change', () => switchSource(r.value));
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

function switchSource(kind){
  if (source.stop) source.stop();
  uploadRow.classList.toggle('hidden', kind !== 'upload');
  proceduralRow.classList.toggle('hidden', kind !== 'procedural');
  if (kind === 'procedural'){
    source = new ProceduralSource();
    source.setPattern($('proceduralPattern').value);
  } else if (kind === 'webcam'){
    source = new WebcamSource();
  } else {
    // upload — wait for file; fall back to procedural until then
    source = new ProceduralSource();
  }
}

recBtn.addEventListener('click', () => {
  if (recorder.isRecording()){
    recorder.stop();
    recBtn.classList.remove('recording');
    recBtn.textContent = '● REC';
    recStatus.textContent = 'saved';
    downloadBtn.disabled = !recorder.hasRecording();
  } else {
    recorder.start();
    recBtn.classList.add('recording');
    recBtn.textContent = '■ STOP';
    recStatus.textContent = 'recording...';
  }
});

downloadBtn.addEventListener('click', () => {
  const ok = recorder.download(seedEl.value.replace(/\s+/g, '_'));
  if (ok) {
    recStatus.textContent = 'downloaded';
  }
});

$('panelToggle').addEventListener('click', () => {
  $('panel').classList.toggle('hidden');
});

// ---------- main loop ----------
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fpsT = 0;

function frame(){
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  const t = now / 1000;

  if (source.ready()){
    pipeline.uploadSource(source.frame(t));
  } else if (source.frame) {
    // prime with whatever is there (procedural always ready); for not-ready video/img, skip
  }

  chaos.update(t);
  const passes = chaos.passes(t);
  pipeline.render({
    passes,
    time: t,
    seed: (chaos.seed % 100000) / 100000,
    globalIntensity: +intensityEl.value,
  });

  // FPS
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5){
    const fps = fpsFrames / fpsAcc;
    fpsEl.textContent = fps.toFixed(0).padStart(3) + ' fps';
    fpsAcc = 0; fpsFrames = 0;
  }
  activeFxEl.textContent = chaos.describe();

  if (recorder.isRecording()){
    const s = recorder.elapsedSeconds();
    recStatus.textContent = `REC ${s.toFixed(1)}s`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
