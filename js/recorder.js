// MediaRecorder wrapper around canvas.captureStream.

export class Recorder {
  constructor(canvas){
    this.canvas = canvas;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.lastBlob = null;
    this.lastObjectUrl = null;
    this.lastTimestamp = null;
    this.onFinished = null;
    this.ffmpeg = null;
    this.ffmpegLoaded = false;
  }

  isRecording(){ return this.recorder && this.recorder.state === 'recording'; }

  start(){
    if (this.isRecording()) return;
    const stream = this.canvas.captureStream(60);
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    let mime = '';
    for (const c of candidates){ if (MediaRecorder.isTypeSupported(c)){ mime = c; break; } }
    if (!mime){ alert('MediaRecorder/webm not supported in this browser'); return; }
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    this.recorder.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => this._finish();
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.lastDurationSec = 0;
  }

  stop(){
    if (!this.isRecording()) return;
    this.lastDurationSec = (performance.now() - this.startedAt) / 1000;
    this.recorder.stop();
  }

  elapsedSeconds(){
    if (!this.isRecording()) return 0;
    return (performance.now() - this.startedAt) / 1000;
  }

  _finish(){
    this.lastBlob = new Blob(this.chunks, { type: 'video/webm' });
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
    const a = document.createElement('a');
    a.href = this.lastObjectUrl;
    a.download = `glitch-${seed}-${this.lastTimestamp || 'recording'}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  async exportMp4(seed = 'capture', onProgress = null, onStatus = null){
    if (!this.lastBlob) return false;

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
