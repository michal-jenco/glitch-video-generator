// Three-tier MP4 recording strategy:
//   1. MediaRecorder with native H.264 mp4 mime (Chromium >=129, Safari 17+)
//   2. WebCodecs VideoEncoder + mp4-muxer (Firefox >=130, older Chrome/Safari)
//   3. MediaRecorder webm + ffmpeg.wasm transcode (last-resort, slow)

import { WebCodecsRecorder, webcodecsMp4Supported } from './webcodecs-recorder.js';

const RECORDER_CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.42E01F', ext: 'mp4', container: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.4D401F', ext: 'mp4', container: 'mp4' },
  { mime: 'video/mp4;codecs=h264',        ext: 'mp4', container: 'mp4' },
  { mime: 'video/mp4',                    ext: 'mp4', container: 'mp4' },
  { mime: 'video/webm;codecs=vp9',        ext: 'webm', container: 'webm' },
  { mime: 'video/webm;codecs=vp8',        ext: 'webm', container: 'webm' },
  { mime: 'video/webm',                   ext: 'webm', container: 'webm' },
];

function pickRecorderFormat(){
  for (const c of RECORDER_CANDIDATES){
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return null;
}

// Whether the browser will record native MP4 via MediaRecorder.
export function nativeMp4Supported(){
  const f = pickRecorderFormat();
  return !!(f && f.container === 'mp4');
}

// Probe both tiers async; cache the best mode. UI waits on this at startup
// so by the time anyone hits REC the path is locked in.
//   'native-mp4'  -> MediaRecorder mp4
//   'webcodecs'   -> WebCodecsRecorder
//   'webm-ffmpeg' -> MediaRecorder webm, ffmpeg on export
let modePromise = null;
export function detectRecorderMode(){
  if (modePromise) return modePromise;
  modePromise = (async () => {
    if (nativeMp4Supported()) return 'native-mp4';
    if (await webcodecsMp4Supported()) return 'webcodecs';
    return 'webm-ffmpeg';
  })();
  return modePromise;
}

export class Recorder {
  constructor(canvas){
    this.canvas = canvas;
    this.recorder = null;
    this.webcodecsRec = null;
    this.chunks = [];
    this.startedAt = 0;
    this.lastBlob = null;
    this.lastObjectUrl = null;
    this.lastTimestamp = null;
    this.recordedFormat = null; // { mime, ext, container } of the active capture
    this.onFinished = null;
    this.ffmpeg = null;
    this.ffmpegLoaded = false;
    this.mode = 'webm-ffmpeg'; // overwritten by detectRecorderMode() at startup
  }

  isRecording(){
    if (this.webcodecsRec?.isRecording()) return true;
    return this.recorder && this.recorder.state === 'recording';
  }

  recordedContainer(){ return this.recordedFormat?.container || null; }

  async start(){
    if (this.isRecording()) return;
    this.mode = await detectRecorderMode();

    if (this.mode === 'webcodecs'){
      this.webcodecsRec = new WebCodecsRecorder(this.canvas);
      this.recordedFormat = { mime: 'video/mp4', ext: 'mp4', container: 'mp4' };
      this.startedAt = performance.now();
      this.lastDurationSec = 0;
      try {
        await this.webcodecsRec.start();
      } catch (e) {
        console.error('webcodecs start failed, falling back to webm', e);
        this.webcodecsRec = null;
        this.mode = 'webm-ffmpeg';
        // fall through to MediaRecorder path below
      }
      if (this.webcodecsRec) return;
    }

    const stream = this.canvas.captureStream(60);
    const fmt = pickRecorderFormat();
    if (!fmt){ alert('MediaRecorder not supported in this browser'); return; }
    this.recordedFormat = fmt;
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 12_000_000 });
    this.recorder.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => this._finishMediaRecorder();
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.lastDurationSec = 0;
  }

  async stop(){
    if (this.webcodecsRec?.isRecording()){
      this.lastDurationSec = (performance.now() - this.startedAt) / 1000;
      this.lastTimestamp = new Date().toISOString().replace(/[:.]/g,'-');
      try {
        const blob = await this.webcodecsRec.stop();
        if (this.lastObjectUrl) URL.revokeObjectURL(this.lastObjectUrl);
        this.lastBlob = blob;
        this.lastObjectUrl = URL.createObjectURL(blob);
      } catch (e) {
        console.error('webcodecs stop failed', e);
        this.lastBlob = null;
      }
      this.webcodecsRec = null;
      if (typeof this.onFinished === 'function') this.onFinished(this.lastBlob);
      return;
    }
    if (!this.recorder || this.recorder.state !== 'recording') return;
    this.lastDurationSec = (performance.now() - this.startedAt) / 1000;
    this.recorder.stop();
  }

  elapsedSeconds(){
    if (this.webcodecsRec?.isRecording()) return this.webcodecsRec.elapsedSeconds();
    if (!this.recorder || this.recorder.state !== 'recording') return 0;
    return (performance.now() - this.startedAt) / 1000;
  }

  _finishMediaRecorder(){
    const blobType = this.recordedFormat?.container === 'mp4' ? 'video/mp4' : 'video/webm';
    this.lastBlob = new Blob(this.chunks, { type: blobType });
    this.lastTimestamp = new Date().toISOString().replace(/[:.]/g,'-');
    if (this.lastObjectUrl) URL.revokeObjectURL(this.lastObjectUrl);
    this.lastObjectUrl = URL.createObjectURL(this.lastBlob);
    if (typeof this.onFinished === 'function') this.onFinished(this.lastBlob);
  }

  hasRecording(){
    return !!this.lastBlob;
  }

  download(seed = 'capture'){
    if (!this.lastBlob || !this.lastObjectUrl) return false;
    const ext = this.recordedFormat?.ext || 'webm';
    const a = document.createElement('a');
    a.href = this.lastObjectUrl;
    a.download = `glitch-${seed}-${this.lastTimestamp || 'recording'}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  async exportMp4(seed = 'capture', onProgress = null, onStatus = null){
    if (!this.lastBlob) return false;

    // Already recorded as MP4 natively — just download the blob.
    if (this.recordedFormat?.container === 'mp4'){
      if (onProgress) onProgress(1);
      if (onStatus) onStatus('mp4 ready');
      return this.download(seed);
    }

    if (onStatus) onStatus('mp4 loading core...');
    const ffmpeg = await this._getFfmpeg(onProgress);
    const inputName = 'input.webm';
    const outputName = 'output.mp4';
    const inputData = new Uint8Array(await this.lastBlob.arrayBuffer());

    await ffmpeg.writeFile(inputName, inputData);
    if (onStatus) onStatus('mp4 encoding...');
    await ffmpeg.exec([
      '-i', inputName,
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-r', '30',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '30',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      outputName,
    ]);

    const out = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    const blob = new Blob([out], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `glitch-${seed}-${this.lastTimestamp || 'recording'}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (onStatus) onStatus('mp4 downloaded');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }

  // ffmpeg.wasm's `progress` is bogus when input lacks duration metadata
  // (which MediaRecorder webm always does). Derive it from `time` (current
  // encoding pos in microseconds) and the recorded wall-clock duration.
  _estimateProgress(progress, time){
    const dur = this.lastDurationSec;
    if (dur > 0 && Number.isFinite(time) && time >= 0) {
      return Math.max(0, Math.min(1, time / (dur * 1_000_000)));
    }
    return Number.isFinite(progress) && progress >= 0 && progress <= 1 ? progress : 0;
  }

  async _getFfmpeg(onProgress = null){
    this._onProgress = onProgress;
    if (this.ffmpeg && this.ffmpegLoaded) return this.ffmpeg;

    const { FFmpeg } = await import('../vendor/ffmpeg/index.js');

    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress, time }) => {
      const cb = this._onProgress;
      if (cb) cb(this._estimateProgress(progress, time));
    });

    // Derive the vendor path relative to this module so it works on any
    // hosting subpath (e.g. GitHub Pages /glitch-video-generator/).
    const ffmpegBase = new URL('../vendor/ffmpeg', import.meta.url).href;
    const v = 'v2';
    await ffmpeg.load({
      classWorkerURL: `${ffmpegBase}/worker.js?${v}`,
      coreURL: `${ffmpegBase}/ffmpeg-core.js?${v}`,
      wasmURL: `${ffmpegBase}/ffmpeg-core.wasm?${v}`,
    });

    this.ffmpeg = ffmpeg;
    this.ffmpegLoaded = true;
    return ffmpeg;
  }
}
