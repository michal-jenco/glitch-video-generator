// Procedural sources rendered into an offscreen 2D canvas; that canvas
// becomes the "source" texture for the WebGL pipeline.

export class Procedural {
  constructor(w=1280, h=720){
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.pattern = 'random';
    this.startedAt = performance.now();
    this.currentPattern = 'noise';
    this.lastSwap = 0;
  }

  resize(w,h){
    this.canvas.width = w; this.canvas.height = h;
  }

  setPattern(p){
    this.pattern = p;
    if (p !== 'random') this.currentPattern = p;
  }

  _pick(){
    const opts = ['noise','bars','text','grid','circles','plasma'];
    return opts[Math.floor(Math.random()*opts.length)];
  }

  draw(time){
    if (this.pattern === 'random'){
      if (time - this.lastSwap > 3 + Math.random()*4){
        this.currentPattern = this._pick();
        this.lastSwap = time;
      }
    }
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    switch (this.currentPattern){
      case 'noise':   return this._noise(ctx, W, H, time);
      case 'bars':    return this._bars(ctx, W, H, time);
      case 'text':    return this._text(ctx, W, H, time);
      case 'grid':    return this._grid(ctx, W, H, time);
      case 'circles': return this._circles(ctx, W, H, time);
      case 'plasma':  return this._plasma(ctx, W, H, time);
    }
  }

  _noise(ctx, W, H, t){
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let i=0;i<d.length;i+=4){
      const v = (Math.random()*255)|0;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = `hsla(${(t*60)%360},80%,55%,0.25)`;
    ctx.fillRect(0,0,W,H);
  }

  _bars(ctx, W, H, t){
    const colors = ['#fff','#ff0','#0ff','#0f0','#f0f','#f00','#00f','#000'];
    const bw = W / colors.length;
    for (let i=0;i<colors.length;i++){
      ctx.fillStyle = colors[i];
      ctx.fillRect(i*bw, 0, bw+1, H);
    }
    // moving overlay
    ctx.fillStyle = `rgba(255,255,255,0.15)`;
    const y = ((t*200) % H);
    ctx.fillRect(0, y, W, 30);
  }

  _text(ctx, W, H, t){
    ctx.fillStyle = '#000';
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#0f0';
    ctx.font = `bold ${Math.floor(H*0.07)}px ui-monospace, monospace`;
    const lines = [
      'SYS> ERR 0xDEADBEEF',
      'BUFFER OVERFLOW @ 0x40C0FFEE',
      'KERNEL PANIC :: NOT SYNCING',
      '01001000 01000101 01001100 01001100 01001111',
      '████░░░░ INITIALIZING ░░░░████',
      '※ ※ ※ NULL POINTER EXCEPTION ※ ※ ※',
      '⌬ TRANSMISSION CORRUPTED ⌬',
      'SEG FAULT // CORE DUMPED',
      '> _',
    ];
    const lh = Math.floor(H*0.1);
    const off = (t*120) % lh;
    for (let i=-1;i<lines.length+1;i++){
      const y = i*lh - off + lh*0.8;
      ctx.fillText(lines[((i%lines.length)+lines.length)%lines.length], 20, y);
    }
  }

  _grid(ctx, W, H, t){
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
    const s = 40 + Math.sin(t)*15;
    ctx.strokeStyle = `hsl(${(t*40)%360},80%,60%)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x=0;x<W;x+=s){ ctx.moveTo(x,0); ctx.lineTo(x,H); }
    for (let y=0;y<H;y+=s){ ctx.moveTo(0,y); ctx.lineTo(W,y); }
    ctx.stroke();
    // pulse spots
    for (let i=0;i<4;i++){
      ctx.fillStyle = `hsla(${(t*100+i*90)%360},90%,60%,0.4)`;
      ctx.beginPath();
      ctx.arc(W*((i*0.27+t*0.1)%1), H*((i*0.41+t*0.07)%1), 80+Math.sin(t*2+i)*40, 0, Math.PI*2);
      ctx.fill();
    }
  }

  _circles(ctx, W, H, t){
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
    for (let i=0;i<24;i++){
      const a = i*0.7 + t;
      const x = W/2 + Math.cos(a)*W*0.3*(0.5+0.5*Math.sin(t+i));
      const y = H/2 + Math.sin(a*1.3)*H*0.3;
      ctx.fillStyle = `hsla(${(i*30+t*60)%360},90%,60%,0.7)`;
      // Canvas arc throws if radius is negative; clamp prevents render-loop stalls.
      const radius = Math.max(2, 30 + Math.sin(t*3+i)*40);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI*2);
      ctx.fill();
    }
  }

  _plasma(ctx, W, H, t){
    // low-res then upscale
    const w = 160, h = 90;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y=0;y<h;y++){
      for (let x=0;x<w;x++){
        const v = Math.sin(x*0.1 + t) + Math.sin(y*0.1 + t*1.3)
                + Math.sin((x+y)*0.08 + t*0.7) + Math.sin(Math.sqrt(x*x+y*y)*0.1 - t);
        const i = (y*w+x)*4;
        d[i]   = 128+127*Math.sin(v*1.0);
        d[i+1] = 128+127*Math.sin(v*1.7+1.0);
        d[i+2] = 128+127*Math.sin(v*2.3+2.0);
        d[i+3] = 255;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, W, H);
  }
}
