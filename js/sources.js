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
  constructor(){
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this._ready = false;
    this.stream = null;
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
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
  ready(){ return this._ready && this.video.readyState >= 2; }
  frame(){ return this.video; }
  stop(){
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.video.srcObject = null;
  }
}
