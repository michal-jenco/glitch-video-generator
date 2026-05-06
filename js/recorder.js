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
  }

  stop(){
    if (!this.isRecording()) return;
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
}
