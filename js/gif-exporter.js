// GIF capture from the WebGL canvas using gif.js.
// Samples frames via setTimeout (safe because pipeline sets preserveDrawingBuffer:true),
// downscales to maxWidth to keep file sizes sane, then encodes in background workers.

let gifJsLoaded = false;

async function loadGifJs() {
  if (gifJsLoaded || window.GIF) { gifJsLoaded = true; return; }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/gif.js/gif.js', import.meta.url).href;
    s.onload = () => { gifJsLoaded = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export class GifExporter {
  constructor(canvas){ this.canvas = canvas; }

  // Returns a Blob (image/gif).
  // opts: { fps=12, duration=3, quality=8, maxWidth=480, onProgress, onStatus }
  async record({ fps = 12, duration = 3, quality = 8, maxWidth = 480, onProgress, onStatus } = {}) {
    await loadGifJs();

    const cw = this.canvas.width, ch = this.canvas.height;
    const scale = Math.min(1, maxWidth / cw);
    const w = Math.round(cw * scale), h = Math.round(ch * scale);

    const offscreen = document.createElement('canvas');
    offscreen.width = w; offscreen.height = h;
    const ctx = offscreen.getContext('2d');

    const workerScript = new URL('../vendor/gif.js/gif.worker.js', import.meta.url).href;
    const totalFrames = Math.max(2, Math.round(fps * duration));
    const frameDelay = Math.round(1000 / fps);
    const msPerFrame = (duration * 1000) / totalFrames;

    const gif = new window.GIF({ workers: 2, quality, width: w, height: h, workerScript, repeat: 0 });

    if (onStatus) onStatus(`capturing ${totalFrames} frames…`);

    for (let i = 0; i < totalFrames; i++) {
      ctx.drawImage(this.canvas, 0, 0, w, h);
      gif.addFrame(ctx, { copy: true, delay: frameDelay });
      if (onProgress) onProgress(i / totalFrames * 0.5);
      await new Promise(r => setTimeout(r, msPerFrame));
    }

    if (onStatus) onStatus('encoding gif…');

    return new Promise((resolve, reject) => {
      gif.on('progress', p => { if (onProgress) onProgress(0.5 + p * 0.5); });
      gif.on('finished', blob => resolve(blob));
      gif.on('abort', () => reject(new Error('gif aborted')));
      gif.render();
    });
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
