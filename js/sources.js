// Source providers. Each exposes:
//   .ready() -> bool
//   .frame() -> a TexImageSource (HTMLImageElement | HTMLVideoElement | HTMLCanvasElement)
//   .stop()  -> cleanup

import { Procedural } from './procedural.js';

export class ProceduralSource {
  constructor(){ this.proc = new Procedural(1280, 720); }
  setPattern(p){ this.proc.setPattern(p); }
  ready(){ return true; }
  frame(time){ this.proc.draw(time); return this.proc.canvas; }
  stop(){}
}

export class ImageSource {
  constructor(file){
    this.img = new Image();
    this._ready = false;
    this.url = URL.createObjectURL(file);
    this.img.onload = () => { this._ready = true; };
    this.img.src = this.url;
  }
  ready(){ return this._ready; }
  frame(){ return this.img; }
  stop(){ URL.revokeObjectURL(this.url); }
}

export class VideoSource {
  constructor(file){
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.loop = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.url = URL.createObjectURL(file);
    this.video.src = this.url;
    this._ready = false;
    // Stay paused on load — user explicitly hits play. Seek to first frame so
    // the canvas shows a still rather than a black frame.
    this.video.addEventListener('loadeddata', () => {
      this._ready = true;
      try { this.video.currentTime = 0; } catch {}
    });
  }
  ready(){ return this._ready && this.video.readyState >= 2; }
  frame(){ return this.video; }
  setMuted(muted){
    this.video.muted = !!muted;
    if (!muted && !this.video.paused) this.video.play().catch(()=>{});
  }
  get muted(){ return this.video.muted; }
  get paused(){ return this.video.paused; }
  play(){ return this.video.play().catch(()=>{}); }
  pause(){ this.video.pause(); }
  // Returns an audio MediaStreamTrack if the file has an audio stream, else null.
  audioTrack(){
    if (typeof this.video.captureStream !== 'function') return null;
    try {
      const stream = this.video.captureStream();
      const tracks = stream.getAudioTracks();
      return tracks.length ? tracks[0] : null;
    } catch { return null; }
  }
  stop(){ this.video.pause(); URL.revokeObjectURL(this.url); }
}

export class WebcamSource {
  // facingMode: 'user' (front) | 'environment' (back)
  constructor(facingMode = 'user', orientation = 'landscape'){
    this.facingMode = facingMode;
    this.mirrored = (facingMode === 'user');
    this._orientation = orientation;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this._ready = false;
    this.stream = null;
    this.mirrorCanvas = document.createElement('canvas');
    this.mirrorCtx = this.mirrorCanvas.getContext('2d');
    this._acquire(orientation);
  }

  static _constraintsFor(facingMode, orientation){
    const long = 1280, short = 720;
    const w = orientation === 'portrait' ? short : long;
    const h = orientation === 'portrait' ? long : short;
    return { video: { width: { ideal: w }, height: { ideal: h }, facingMode }, audio: false };
  }

  _acquire(orientation){
    const constraints = WebcamSource._constraintsFor(this.facingMode, orientation);
    return navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        this.stream = stream;
        this._orientation = orientation;
        this.video.srcObject = stream;
        return new Promise(resolve => {
          const done = () => { this.video.play().catch(()=>{}); this._ready = true; resolve(); };
          if (this.video.readyState >= 1) done();
          else this.video.addEventListener('loadedmetadata', done, { once: true });
        });
      })
      .catch(err => {
        console.error('webcam', err);
        if (!this._ready) alert('Webcam denied or unavailable: ' + err.message);
      });
  }

  async setOrientation(orientation){
    if (orientation === this._orientation) return;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this._ready = false;
    await this._acquire(orientation);
  }

  // Returns true if flipping cameras is likely to work on this device.
  // On mobile, enumerateDevices() is unreliable: Android Chrome/Firefox often
  // expose a single videoinput entry and switch cameras via facingMode, so
  // counting devices hides the button on phones that clearly have two cameras.
  // We treat facingMode support + a touch/mobile heuristic as the primary
  // signal, and fall back to a >1 device count for desktops.
  static async flipSupported(){
    try {
      const supports = navigator.mediaDevices.getSupportedConstraints?.() || {};
      const isMobile = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
        || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
      if (supports.facingMode && isMobile) return true;
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'videoinput').length > 1;
    } catch { return false; }
  }
  ready(){ return this._ready && this.video.readyState >= 2; }
  setMirror(on){ this.mirrored = !!on; }
  frame(){
    if (!this.ready()) return this.video;
    if (!this.mirrored) return this.video;
    const w = this.video.videoWidth || 1280;
    const h = this.video.videoHeight || 720;
    if (this.mirrorCanvas.width !== w || this.mirrorCanvas.height !== h){
      this.mirrorCanvas.width = w;
      this.mirrorCanvas.height = h;
    }
    this.mirrorCtx.save();
    this.mirrorCtx.setTransform(-1, 0, 0, 1, w, 0);
    this.mirrorCtx.drawImage(this.video, 0, 0, w, h);
    this.mirrorCtx.restore();
    return this.mirrorCanvas;
  }
  stop(){
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.video.srcObject = null;
  }
}
