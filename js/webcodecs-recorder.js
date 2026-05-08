// WebCodecs-based MP4 recorder. Used as the middle tier between native
// MediaRecorder MP4 (best) and the ffmpeg.wasm transcode path (slow).
// Pipes canvas frames into VideoEncoder (hardware H.264 on most platforms)
// and packs the bitstream with mp4-muxer.

import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer.mjs';

// Codec string format: avc1.PPCCLL where LL is the AVC level. Level caps:
//   3.1 (1F) - 720p          4.0 (28) - 1080p
//   5.0 (32) - 4K@30         5.1 (33) - 4K          5.2 (34) - 4K@60
// Try high levels first so any reasonable resolution (incl. portrait 1080p
// or DPI-doubled mobile canvases) configures in one shot.
const AVC_CODECS = [
  'avc1.640034', // High Profile, Level 5.2
  'avc1.640033', // High Profile, Level 5.1
  'avc1.640028', // High Profile, Level 4.0
  'avc1.4D4034', // Main Profile, Level 5.2
  'avc1.42E034', // Baseline, Level 5.2
  'avc1.42E01F', // Baseline, Level 3.1 (last resort)
];
const TARGET_FPS = 60;
const KEYFRAME_INTERVAL_FRAMES = 60; // every ~1s at 60fps
const BITRATE = 12_000_000;

// Cache so we don't probe repeatedly.
let cachedSupport = null;

// Do a full end-to-end probe: configure an encoder, push a single test
// frame, flush, and see if a chunk with decoderConfig actually comes out.
// `isConfigSupported` alone lies on Firefox — it returns true even when
// the OS lacks an AVC encoder, so configure() succeeds but the first
// encode() never produces output. The end-to-end check catches this.
export async function webcodecsMp4Supported(){
  if (cachedSupport != null) return cachedSupport;
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return (cachedSupport = false);
  }
  for (const codec of AVC_CODECS){
    try {
      const cfg = await VideoEncoder.isConfigSupported({
        codec, width: 320, height: 240, bitrate: BITRATE, framerate: TARGET_FPS,
      });
      if (!cfg?.supported) continue;

      let gotChunk = false;
      let gotDecoderConfig = false;
      const enc = new VideoEncoder({
        output: (_chunk, meta) => {
          gotChunk = true;
          if (meta?.decoderConfig) gotDecoderConfig = true;
        },
        error: () => { /* swallow; outer catch handles */ },
      });
      enc.configure(cfg.config || { codec, width: 320, height: 240, bitrate: BITRATE, framerate: TARGET_FPS });

      // 320x240 RGBA frame so we don't depend on a canvas being ready.
      const buf = new Uint8ClampedArray(320 * 240 * 4);
      const probeFrame = new VideoFrame(buf, {
        format: 'RGBA', codedWidth: 320, codedHeight: 240, timestamp: 0,
      });
      enc.encode(probeFrame, { keyFrame: true });
      probeFrame.close();
      await enc.flush();
      enc.close();

      if (gotChunk && gotDecoderConfig) return (cachedSupport = true);
    } catch { /* try next codec */ }
  }
  return (cachedSupport = false);
}

async function pickCodec(width, height){
  for (const codec of AVC_CODECS){
    try {
      const r = await VideoEncoder.isConfigSupported({
        codec, width, height, bitrate: BITRATE, framerate: TARGET_FPS,
      });
      if (r?.supported) return r.config || { codec, width, height, bitrate: BITRATE, framerate: TARGET_FPS };
    } catch { /* try next */ }
  }
  return null;
}

export class WebCodecsRecorder {
  constructor(canvas){
    this.canvas = canvas;
    this._reset();
  }

  _reset(){
    this.encoder = null;
    this.muxer = null;
    this.rafId = 0;
    this.frameCount = 0;
    this.startedAt = 0;
    this.recording = false;
    this.error = null;
    this.width = 0;
    this.height = 0;
  }

  isRecording(){ return this.recording; }

  async start(){
    if (this.recording) return;
    const w = this.canvas.width, h = this.canvas.height;
    if (w < 2 || h < 2) throw new Error('canvas not sized');

    const config = await pickCodec(w, h);
    if (!config) throw new Error('no supported H.264 config for this canvas size');

    this.muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: w, height: h, frameRate: TARGET_FPS },
      fastStart: 'in-memory',
    });

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
      error: (e) => { this.error = e; },
    });
    this.encoder.configure(config);

    this.width = w;
    this.height = h;
    this.startedAt = performance.now();
    this.frameCount = 0;
    this.recording = true;
    this._pumpFrame();
  }

  _pumpFrame(){
    if (!this.recording) return;
    // VideoFrame from canvas. timestamp must be in microseconds, monotonic.
    const ts = Math.round((performance.now() - this.startedAt) * 1000);
    let frame;
    try {
      frame = new VideoFrame(this.canvas, { timestamp: ts });
    } catch (e) {
      this.error = e;
      this.recording = false;
      return;
    }
    const keyFrame = this.frameCount % KEYFRAME_INTERVAL_FRAMES === 0;
    try {
      this.encoder.encode(frame, { keyFrame });
    } catch (e) {
      this.error = e;
    }
    frame.close();
    this.frameCount++;
    this.rafId = requestAnimationFrame(() => this._pumpFrame());
  }

  elapsedSeconds(){
    if (!this.recording) return 0;
    return (performance.now() - this.startedAt) / 1000;
  }

  async stop(){
    if (!this.recording) return null;
    this.recording = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    try {
      await this.encoder.flush();
    } catch (e) {
      this.error = e;
    }
    this.encoder.close();
    this.muxer.finalize();
    const buffer = this.muxer.target.buffer;
    const blob = new Blob([buffer], { type: 'video/mp4' });
    const err = this.error;
    this._reset();
    if (err) throw err;
    return blob;
  }
}
