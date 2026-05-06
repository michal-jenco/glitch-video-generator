// WebGL2 ping-pong pipeline + a fat library of glitch fragment shaders.
// Each effect is a fragment shader. The chaos engine picks an ordered stack
// of these per frame and we render passes into FBOs, sampling the previous
// final frame as uPrev for feedback effects.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform vec2  uResolution;
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform float uParam0;
uniform float uParam1;
uniform float uParam2;
uniform float uParam3;

float hash11(float x){ return fract(sin(x*127.1)*43758.5453); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
vec3  hash23(vec2 p){
  return fract(sin(vec3(
    dot(p, vec2(127.1,311.7)),
    dot(p, vec2(269.5,183.3)),
    dot(p, vec2(113.5,271.9))
  ))*43758.5453);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash21(i);
  float b = hash21(i+vec2(1,0));
  float c = hash21(i+vec2(0,1));
  float d = hash21(i+vec2(1,1));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.,-1./3.,2./3.,-1.);
  vec4 p = mix(vec4(c.bg,K.wz), vec4(c.gb,K.xy), step(c.b,c.g));
  vec4 q = mix(vec4(p.xyw,c.r), vec4(c.r,p.yzx), step(p.x,c.r));
  float d = q.x - min(q.w,q.y);
  float e = 1e-10;
  return vec3(abs(q.z + (q.w - q.y)/(6.*d+e)), d/(q.x+e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.,2./3.,1./3.,3.);
  vec3 p = abs(fract(c.xxx + K.xyz)*6. - K.www);
  return c.z * mix(K.xxx, clamp(p-K.xxx,0.,1.), c.y);
}
`;

// passthrough copy
const FX_COPY = HEAD + `
void main(){ outColor = texture(uTex, vUv); }
`;

// 1. RGB chromatic aberration / channel split
const FX_RGB = HEAD + `
void main(){
  vec2 c = vUv - 0.5;
  float a = uIntensity * (0.01 + 0.04*uParam0);
  float wob = sin(uTime*3.0 + uSeed)*0.5 + 0.5;
  vec2 dir = vec2(cos(uSeed*7.0), sin(uSeed*5.0));
  float r = texture(uTex, vUv + dir*a*(0.6+wob)).r;
  float g = texture(uTex, vUv).g;
  float b = texture(uTex, vUv - dir*a*(0.5+wob*0.4)).b;
  outColor = vec4(r,g,b,1.0);
}
`;

// 2. Datamosh (use uPrev with motion-ish smear)
const FX_DATAMOSH = HEAD + `
void main(){
  vec2 uv = vUv;
  vec2 jitter = (hash23(floor(vUv*vec2(40.0,80.0))+floor(uTime*8.0)).xy-0.5)*uIntensity*0.08;
  vec4 cur = texture(uTex, uv);
  vec4 prev = texture(uPrev, uv + jitter);
  float keep = step(0.2 + 0.6*(1.0-uIntensity), hash21(floor(vUv*30.0)+floor(uTime*4.0)));
  outColor = mix(prev*0.95, cur, keep);
}
`;

// 3. Pixel-sort-ish (per-row threshold based shimmer + horizontal smear)
const FX_PIXSORT = HEAD + `
void main(){
  float row = floor(vUv.y * uResolution.y);
  float thresh = 0.3 + 0.4*hash11(row + floor(uTime*2.0)+uSeed);
  vec4 base = texture(uTex, vUv);
  float lum = dot(base.rgb, vec3(0.299,0.587,0.114));
  if (lum > thresh) {
    float n = hash11(row + floor(uTime*5.0));
    float off = (n - 0.5) * uIntensity * 0.4;
    base = texture(uTex, vec2(vUv.x + off, vUv.y));
  }
  outColor = base;
}
`;

// 4. Scanlines + VHS noise + tracking jitter
const FX_VHS = HEAD + `
void main(){
  float jitter = (hash11(floor(vUv.y*uResolution.y*0.7)+floor(uTime*30.0))-0.5);
  vec2 uv = vUv + vec2(jitter*uIntensity*0.04, 0.0);
  vec3 col = texture(uTex, uv).rgb;
  // chroma bleed
  col.r = texture(uTex, uv + vec2(0.004,0)).r;
  col.b = texture(uTex, uv - vec2(0.004,0)).b;
  // scanline
  float sl = 0.85 + 0.15*sin(vUv.y*uResolution.y*3.14159);
  col *= sl;
  // tape noise
  float n = hash21(vUv*uResolution + uTime*120.0);
  col += (n-0.5) * uIntensity * 0.25;
  // tracking band
  float band = smoothstep(0.0,0.02,abs(fract(vUv.y - uTime*0.13) - 0.5)-0.45);
  col = mix(col*0.4 + vec3(n*0.5), col, 1.0-band*uIntensity);
  outColor = vec4(col,1.0);
}
`;

// 5. Block displacement / horizontal slicing
const FX_SLICE = HEAD + `
void main(){
  float bands = 6.0 + floor(uParam0*30.0);
  float band = floor(vUv.y * bands + uTime*uParam1);
  float r = hash11(band + uSeed + floor(uTime*3.0));
  float trigger = step(1.0 - uIntensity*0.7, r);
  float off = (hash11(band*2.3 + uSeed) - 0.5) * uIntensity * 0.5 * trigger;
  outColor = texture(uTex, vec2(vUv.x + off, vUv.y));
}
`;

// 6. Feedback zoom/rotate (uPrev affine warp)
const FX_FEEDBACK = HEAD + `
void main(){
  float a = (uParam0-0.5) * 0.2 * uIntensity;
  float z = 1.0 + (uParam1-0.5) * 0.06 * uIntensity;
  vec2 c = vUv - 0.5;
  mat2 R = mat2(cos(a),-sin(a),sin(a),cos(a));
  vec2 uv = R * c / z + 0.5 + vec2(uParam2-0.5, uParam3-0.5)*0.02*uIntensity;
  vec3 p = texture(uPrev, uv).rgb * (0.92 + 0.06*uIntensity);
  vec3 cur = texture(uTex, vUv).rgb;
  outColor = vec4(max(cur, p), 1.0);
}
`;

// 7. Sine wave warp / slit-scan time-displacement
const FX_WAVE = HEAD + `
void main(){
  float fx = sin(vUv.y*40.0*uParam0 + uTime*4.0)*0.02*uIntensity;
  float fy = sin(vUv.x*30.0*uParam1 + uTime*3.0)*0.015*uIntensity;
  outColor = texture(uTex, vUv + vec2(fx,fy));
}
`;

// 8. Hue rotation / posterize / bit-crush / inversion
const FX_COLOR = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  vec3 hsv = rgb2hsv(c);
  hsv.x = fract(hsv.x + uParam0 * uIntensity);
  hsv.y = clamp(hsv.y * (0.6 + uParam1*1.5), 0.0, 1.0);
  c = hsv2rgb(hsv);
  float steps = mix(32.0, 3.0, uIntensity*uParam2);
  c = floor(c*steps)/steps;
  if (uParam3 > 0.7) c = 1.0 - c;
  outColor = vec4(c,1.0);
}
`;

// 9. CRT barrel + vignette + bloom-ish
const FX_CRT = HEAD + `
vec2 barrel(vec2 uv, float k){
  vec2 c = uv-0.5;
  float r2 = dot(c,c);
  return c*(1.0 + k*r2) + 0.5;
}
void main(){
  vec2 uv = barrel(vUv, 0.25*uIntensity);
  if (uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ outColor=vec4(0,0,0,1); return; }
  vec3 c = texture(uTex, uv).rgb;
  // bloom: cheap 4-tap
  vec3 b = vec3(0);
  float r = 0.004 + 0.01*uIntensity;
  b += texture(uTex, uv+vec2(r,0)).rgb;
  b += texture(uTex, uv+vec2(-r,0)).rgb;
  b += texture(uTex, uv+vec2(0,r)).rgb;
  b += texture(uTex, uv+vec2(0,-r)).rgb;
  c += max(b*0.25 - 0.5, 0.0)*uIntensity;
  // vignette
  float v = smoothstep(0.9,0.4,length(vUv-0.5));
  c *= mix(1.0, v, uIntensity*0.6);
  outColor = vec4(c,1.0);
}
`;

// 10. Pixelation mosaic
const FX_MOSAIC = HEAD + `
void main(){
  float s = mix(2.0, 200.0, 1.0 - uIntensity*uParam0);
  vec2 uv = (floor(vUv*s)+0.5)/s;
  outColor = texture(uTex, uv);
}
`;

// 11. ASCII-style downsample (luminance to dot pattern)
const FX_ASCII = HEAD + `
void main(){
  float s = mix(40.0, 200.0, 1.0-uParam0);
  vec2 cell = floor(vUv*vec2(s, s*0.5));
  vec2 uv = (cell + 0.5)/vec2(s, s*0.5);
  vec3 c = texture(uTex, uv).rgb;
  float lum = dot(c, vec3(0.299,0.587,0.114));
  vec2 p = fract(vUv*vec2(s, s*0.5)) - 0.5;
  float d = length(p);
  float dot_ = step(d, 0.05 + lum*0.45);
  outColor = vec4(c * dot_ + (1.0-dot_)*0.0, 1.0);
}
`;

// 12. Fake JPEG / DCT block corruption
const FX_BLOCKS = HEAD + `
void main(){
  float bs = mix(8.0, 32.0, uParam0);
  vec2 cell = floor(vUv*uResolution/bs);
  float r = hash21(cell + floor(uTime*2.0) + uSeed);
  if (r > 1.0 - uIntensity*0.4) {
    vec2 jump = (hash23(cell+uSeed).xy - 0.5) * 0.3 * uIntensity;
    outColor = texture(uTex, vUv + jump);
    // tint the corrupted block
    outColor.rgb = mix(outColor.rgb, hash23(cell), 0.3*uIntensity);
  } else {
    outColor = texture(uTex, vUv);
  }
}
`;

// 13. Interlace tearing
const FX_INTERLACE = HEAD + `
void main(){
  float row = floor(vUv.y * uResolution.y);
  float odd = mod(row, 2.0);
  float drift = sin(uTime*2.0 + uSeed) * 0.02 * uIntensity;
  vec2 uv = vec2(vUv.x + odd*drift, vUv.y);
  vec3 c = texture(uTex, uv).rgb;
  c *= mix(1.0, 0.6 + 0.4*odd, uIntensity*0.4);
  outColor = vec4(c,1.0);
}
`;

// 14. Kaleidoscope
const FX_KALEIDO = HEAD + `
void main(){
  float seg = floor(3.0 + uParam0*9.0);
  vec2 c = vUv - 0.5;
  float r = length(c);
  float a = atan(c.y, c.x);
  float twoPi = 6.28318;
  a = mod(a, twoPi/seg);
  a = abs(a - twoPi/seg*0.5);
  vec2 uv = vec2(cos(a), sin(a))*r + 0.5;
  outColor = texture(uTex, uv);
}
`;

// 15. Voronoi shatter
const FX_VORONOI = HEAD + `
void main(){
  float s = mix(8.0, 40.0, uParam0);
  vec2 p = vUv*s;
  vec2 i = floor(p), f = fract(p);
  float md = 8.0;
  vec2 mc = vec2(0);
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){
    vec2 g = vec2(float(x),float(y));
    vec2 o = hash23(i+g + floor(uTime)).xy;
    vec2 r = g + o - f;
    float d = dot(r,r);
    if (d<md){md=d; mc=i+g+o;}
  }
  vec2 jump = (hash23(mc).xy - 0.5) * uIntensity * 0.3;
  outColor = texture(uTex, vUv + jump);
}
`;

// 16. Tracking band roll (big horizontal noisy band crossing screen)
const FX_BAND = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float pos = fract(uTime*0.2 + uSeed);
  float d = abs(vUv.y - pos);
  float band = smoothstep(0.06, 0.0, d);
  float n = hash21(vUv*uResolution + uTime*60.0);
  c = mix(c, vec3(n)*1.2, band*uIntensity);
  c.rb = mix(c.rb, c.br, band*uIntensity*0.6);
  outColor = vec4(c,1.0);
}
`;

// 17. Echo / motion trails (pure feedback blend)
const FX_ECHO = HEAD + `
void main(){
  vec3 cur = texture(uTex, vUv).rgb;
  vec3 prev = texture(uPrev, vUv + vec2(0.002*sin(uTime), -0.003)).rgb;
  outColor = vec4(max(cur, prev*(0.85+0.1*uIntensity)), 1.0);
}
`;

// 18. Edge detect / sobel-ish wireframe
const FX_EDGE = HEAD + `
float lum(vec3 c){return dot(c,vec3(0.299,0.587,0.114));}
void main(){
  vec2 px = 1.0/uResolution;
  float tl=lum(texture(uTex,vUv+px*vec2(-1,-1)).rgb);
  float t =lum(texture(uTex,vUv+px*vec2( 0,-1)).rgb);
  float tr=lum(texture(uTex,vUv+px*vec2( 1,-1)).rgb);
  float l =lum(texture(uTex,vUv+px*vec2(-1, 0)).rgb);
  float r =lum(texture(uTex,vUv+px*vec2( 1, 0)).rgb);
  float bl=lum(texture(uTex,vUv+px*vec2(-1, 1)).rgb);
  float b =lum(texture(uTex,vUv+px*vec2( 0, 1)).rgb);
  float br=lum(texture(uTex,vUv+px*vec2( 1, 1)).rgb);
  float gx = -tl-2.*l-bl+tr+2.*r+br;
  float gy = -tl-2.*t-tr+bl+2.*b+br;
  float g = sqrt(gx*gx+gy*gy);
  vec3 base = texture(uTex, vUv).rgb;
  vec3 edge = vec3(g) * vec3(uParam0, uParam1, uParam2);
  outColor = vec4(mix(base, base+edge*2.0, uIntensity), 1.0);
}
`;

// 19. Glitch text noise (line of garbage)
const FX_BARCODE = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float band = step(0.95, fract(vUv.y*7.0 + uTime*0.5));
  float bar = step(0.5, hash11(floor(vUv.x*200.0)+floor(uTime*8.0)+uSeed));
  c = mix(c, vec3(bar), band*uIntensity*0.9);
  outColor = vec4(c,1.0);
}
`;

// 20. Time freeze / strobe (mixes uPrev hard)
const FX_STROBE = HEAD + `
void main(){
  float strobe = step(0.5, fract(uTime*mix(2.0, 25.0, uParam0)));
  vec3 cur = texture(uTex, vUv).rgb;
  vec3 prev = texture(uPrev, vUv).rgb;
  outColor = vec4(mix(cur, prev, strobe*uIntensity),1.0);
}
`;

export const EFFECTS = [
  { name: 'rgb_split',   src: FX_RGB },
  { name: 'datamosh',    src: FX_DATAMOSH },
  { name: 'pixsort',     src: FX_PIXSORT },
  { name: 'vhs',         src: FX_VHS },
  { name: 'slice',       src: FX_SLICE },
  { name: 'feedback',    src: FX_FEEDBACK },
  { name: 'wave',        src: FX_WAVE },
  { name: 'color',       src: FX_COLOR },
  { name: 'crt',         src: FX_CRT },
  { name: 'mosaic',      src: FX_MOSAIC },
  { name: 'ascii',       src: FX_ASCII },
  { name: 'jpegblocks',  src: FX_BLOCKS },
  { name: 'interlace',   src: FX_INTERLACE },
  { name: 'kaleido',     src: FX_KALEIDO },
  { name: 'voronoi',     src: FX_VORONOI },
  { name: 'band',        src: FX_BAND },
  { name: 'echo',        src: FX_ECHO },
  { name: 'edge',        src: FX_EDGE },
  { name: 'barcode',     src: FX_BARCODE },
  { name: 'strobe',      src: FX_STROBE },
];

function compile(gl, type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
    const log = gl.getShaderInfoLog(s);
    console.error('shader compile error:', log, '\n', src);
    throw new Error('shader compile: ' + log);
  }
  return s;
}

function program(gl, vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export class Pipeline {
  constructor(canvas){
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.canvas = canvas;

    // fullscreen quad
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    // compile programs once
    this.programs = {};
    this.programs.copy = program(gl, VERT, FX_COPY);
    for (const fx of EFFECTS) {
      this.programs[fx.name] = program(gl, VERT, fx.src);
    }

    // ping-pong + history
    this.fbA = this._makeFBO(2,2);
    this.fbB = this._makeFBO(2,2);
    this.fbHistory = this._makeFBO(2,2); // last final frame for uPrev
    this.srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.resize(canvas.width, canvas.height);
  }

  _makeFBO(w,h){
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }

  resize(w,h){
    const gl = this.gl;
    for (const fbo of [this.fbA, this.fbB, this.fbHistory]) {
      gl.bindTexture(gl.TEXTURE_2D, fbo.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      fbo.w = w; fbo.h = h;
    }
  }

  uploadSource(source){
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (e) {
      // source not ready yet
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  // passes: array of { name, params: [p0..p3], intensity }
  render({ passes, time, seed, globalIntensity }){
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.bindVertexArray(this.vao);

    // pass 0: copy source -> fbA
    let read = this.fbA, write = this.fbB;
    this._drawTo(read, this.programs.copy, this.srcTex, this.fbHistory.tex, time, seed, globalIntensity, [0,0,0,0]);

    for (let i=0; i<passes.length; i++){
      const pass = passes[i];
      const prog = this.programs[pass.name] || this.programs.copy;
      this._drawTo(write, prog, read.tex, this.fbHistory.tex, time, seed,
                   pass.intensity * globalIntensity, pass.params);
      const tmp = read; read = write; write = tmp;
    }

    // final to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,W,H);
    gl.useProgram(this.programs.copy);
    this._setCommon(this.programs.copy, time, seed, globalIntensity, [0,0,0,0]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, read.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.fbHistory.tex);
    gl.uniform1i(gl.getUniformLocation(this.programs.copy,'uTex'), 0);
    gl.uniform1i(gl.getUniformLocation(this.programs.copy,'uPrev'), 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // copy final read into history for next frame's uPrev
    this._drawTo(this.fbHistory, this.programs.copy, read.tex, this.fbHistory.tex, time, seed, 1.0, [0,0,0,0]);
  }

  _drawTo(target, prog, srcTex, prevTex, time, seed, intensity, params){
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0,0,target.w,target.h);
    gl.useProgram(prog);
    this._setCommon(prog, time, seed, intensity, params);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.uniform1i(gl.getUniformLocation(prog,'uTex'), 0);
    gl.uniform1i(gl.getUniformLocation(prog,'uPrev'), 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _setCommon(prog, time, seed, intensity, params){
    const gl = this.gl;
    const u = (n) => gl.getUniformLocation(prog, n);
    gl.uniform2f(u('uResolution'), this.canvas.width, this.canvas.height);
    gl.uniform1f(u('uTime'), time);
    gl.uniform1f(u('uSeed'), seed);
    gl.uniform1f(u('uIntensity'), intensity);
    gl.uniform1f(u('uParam0'), params[0]||0);
    gl.uniform1f(u('uParam1'), params[1]||0);
    gl.uniform1f(u('uParam2'), params[2]||0);
    gl.uniform1f(u('uParam3'), params[3]||0);
  }
}
