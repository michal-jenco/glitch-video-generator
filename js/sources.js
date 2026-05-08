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
    this.url = URL.createObjectURL(file);
    this.video.src = this.url;
    this._ready = false;
    this.video.addEventListener('canplay', () => { this._ready = true; this.video.play().catch(()=>{}); });
  }
  ready(){ return this._ready && this.video.readyState >= 2; }
  frame(){ return this.video; }
  stop(){ this.video.pause(); URL.revokeObjectURL(this.url); }
}

export class WebcamSource {
  // facingMode: 'user' (front) | 'environment' (back)
  constructor(facingMode = 'user'){
    this.facingMode = facingMode;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this._ready = false;
    this.stream = null;
    this.mirrorCanvas = document.createElement('canvas');
    this.mirrorCtx = this.mirrorCanvas.getContext('2d');
    const constraints = { video: { width: 1280, height: 720, facingMode }, audio: false };
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        this.stream = stream;
        this.video.srcObject = stream;
        this.video.addEventListener('loadedmetadata', () => {
          this.video.play().catch(()=>{});
          this._ready = true;
        });
      })
      .catch(err => {
        console.error('webcam', err);
        alert('Webcam denied or unavailable: ' + err.message);
      });
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
  frame(){
    if (!this.ready()) return this.video;
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
