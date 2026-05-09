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
uniform float uParam4;
uniform float uParam5;

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

// object-fit: cover — crop the source to match dst aspect (no squish)
const FX_FIT_COVER = HEAD + `
uniform vec2 uSrcResolution;
void main(){
  vec2 dst = uResolution;
  vec2 src = uSrcResolution;
  vec2 scale = vec2(1.0);
  if (src.x > 0.0 && src.y > 0.0 && dst.x > 0.0 && dst.y > 0.0) {
    float dstA = dst.x / dst.y;
    float srcA = src.x / src.y;
    scale = (srcA > dstA) ? vec2(dstA / srcA, 1.0) : vec2(1.0, srcA / dstA);
  }
  vec2 uv = 0.5 + (vUv - 0.5) * scale;
  outColor = texture(uTex, uv);
}
`;

// object-fit: contain — letterbox to show full source (no cropping)
// uParam0 controls vertical alignment: 0 = center, 1 = top, -1 = bottom
const FX_FIT_CONTAIN = HEAD + `
uniform vec2 uSrcResolution;
void main(){
  vec2 dst = uResolution;
  vec2 src = uSrcResolution;
  vec2 scale = vec2(1.0);
  if (src.x > 0.0 && src.y > 0.0 && dst.x > 0.0 && dst.y > 0.0) {
    float dstA = dst.x / dst.y;
    float srcA = src.x / src.y;
    scale = (srcA > dstA) ? vec2(1.0, srcA / dstA) : vec2(dstA / srcA, 1.0);
  }
  float alignY = uParam0;
  vec2 offset = vec2((1.0 - scale.x) * 0.5, (1.0 - scale.y) * (0.5 - alignY * 0.5));
  vec2 uv = vUv * scale + offset;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    outColor = texture(uTex, uv);
  }
}
`;

// object-fit: tile — repeat source across uParam0 cols × uParam1 rows
const FX_FIT_TILE = HEAD + `
uniform vec2 uSrcResolution;
void main(){
  float cols = floor(uParam0 + 0.5);
  float rows = floor(uParam1 + 0.5);
  if (cols < 1.0) cols = 1.0;
  if (rows < 1.0) rows = 1.0;
  vec2 uv = fract(vUv * vec2(cols, rows));
  outColor = texture(uTex, uv);
}
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

// 21. Solarize / threshold chaos
const FX_SOLARIZE = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float t = mix(0.25, 0.85, uParam0);
  c = mix(c, 1.0 - c, step(t, c));
  c += (hash23(vUv*uResolution + floor(uTime*30.0)).rgb - 0.5) * 0.12 * uIntensity;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 22. Vertical line drift with per-column offsets
const FX_LINESHIFT = HEAD + `
void main(){
  float col = floor(vUv.x * (30.0 + uParam0 * 200.0));
  float off = (hash11(col + floor(uTime*8.0)+uSeed)-0.5) * 0.2 * uIntensity;
  vec2 uv = vec2(vUv.x, fract(vUv.y + off));
  outColor = texture(uTex, uv);
}
`;

// 23. Polar tunnel warp
const FX_TUNNEL = HEAD + `
void main(){
  vec2 p = vUv - 0.5;
  float r = length(p);
  float a = atan(p.y, p.x);
  vec2 uv = vec2(
    fract(a / 6.28318 + uTime * (0.05 + 0.2*uParam0)),
    fract((1.0 / max(0.03, r)) * 0.12 + uTime * (0.08 + 0.3*uParam1))
  );
  vec3 c = texture(uTex, uv).rgb;
  c = mix(texture(uTex, vUv).rgb, c, uIntensity);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 24. Bitflip-style channel scrambling
const FX_BITFLIP = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float cell = floor(vUv.x*80.0) + floor(vUv.y*80.0)*97.0 + floor(uTime*20.0);
  float r = hash11(cell + uSeed);
  if (r > 1.0 - 0.75*uIntensity){
    c = c.bgr;
    c = floor(c * mix(255.0, 8.0, uParam0)) / mix(255.0, 8.0, uParam0);
  }
  if (r < 0.08*uIntensity){
    c.rg = c.gr;
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 25. Swirl burst around center
const FX_SWIRL = HEAD + `
void main(){
  vec2 p = vUv - 0.5;
  float r = length(p);
  float ang = (1.0-r) * (0.8 + 6.0*uParam0) * uIntensity;
  float s = sin(ang), c = cos(ang);
  mat2 R = mat2(c,-s,s,c);
  vec2 uv = R * p + 0.5;
  outColor = texture(uTex, uv);
}
`;

// 26. Chroma ghost trails
const FX_GHOSTRGB = HEAD + `
void main(){
  vec2 o1 = vec2(0.006, 0.0) * (0.5 + uParam0) * uIntensity;
  vec2 o2 = vec2(-0.004, 0.003) * (0.5 + uParam1) * uIntensity;
  vec3 base = texture(uTex, vUv).rgb;
  vec3 g1 = texture(uPrev, vUv + o1).rgb;
  vec3 g2 = texture(uPrev, vUv + o2).rgb;
  vec3 c = vec3(g1.r, base.g, g2.b);
  outColor = vec4(max(base, c), 1.0);
}
`;

// 27. NTSC — full composite video encode/decode cycle: dot crawl + cross-color rainbow
const FX_NTSC = HEAD + `
vec3 yiq2rgb(vec3 yiq){
  return mat3(1.0,1.0,1.0, 0.956,-0.272,-1.106, 0.621,-0.647,1.703) * yiq;
}
vec3 rgb2yiq(vec3 c){
  return mat3(0.299,0.596,0.212, 0.587,-0.274,-0.523, 0.114,-0.322,0.311) * c;
}
void main(){
  vec3 col = texture(uTex, vUv).rgb;
  float line = floor(vUv.y * uResolution.y);
  float phase = line * 3.14159265 + uTime * (6.0 + uParam4 * 16.0);
  float crawl = sin(vUv.x * uResolution.x * 0.2 + phase) * mix(0.0, 0.35, uParam0 * uIntensity);
  float rainbow = sin(phase * 0.25) * mix(0.0, 0.4, uParam1 * uIntensity);
  vec3 yiq = rgb2yiq(col);
  float chromaScale = mix(1.0, 0.05, uParam2 * uIntensity);
  yiq.yz = yiq.yz * chromaScale + vec2(crawl, crawl * 0.6 + rainbow);
  col = yiq2rgb(yiq);
  float bleed = mix(0.0, 0.2, uParam4 * uIntensity);
  col += vec3(bleed * sin(vUv.y * 200.0 + uTime * 20.0));
  col = clamp(col, 0.0, 1.0);
  outColor = vec4(mix(texture(uTex, vUv).rgb, col, uIntensity), 1.0);
}
`;

// 28. Posterize — hardware ADC/DAC bit truncation (not multiply/divide)
const FX_POSTERIZE = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float bits = floor(mix(2.0, 8.0, 1.0 - uParam0));
  float levels = pow(2.0, bits);
  vec3 posterized = floor(c * levels) / (levels - 1.0);
  float dither = (hash23(vUv * uResolution + floor(uTime * 120.0)).r - 0.5) * mix(0.0, 0.05, uParam1);
  outColor = vec4(mix(c, posterized + dither, uIntensity), 1.0);
}
`;

// 29. Chroma dropout — random scanlines revert to grayscale
const FX_CHROMADROP = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float row = floor(vUv.y * uResolution.y);
  float seed = hash11(row * 3.7 + floor(uTime * 20.0) * 0.73 + uSeed);
  float dropRate = mix(0.005, 0.5, uParam0 * uIntensity);
  if (seed < dropRate){
    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    float edgeSoft = mix(0.5, 4.0, 1.0 - uParam2);
    float dist = abs(vUv.y * uResolution.y - row) * edgeSoft;
    float f = smoothstep(0.0, 1.0, dist);
    float dropLen = mix(1.0, 12.0, uParam1);
    float rowsAway = abs(vUv.y * uResolution.y - row);
    float inDrop = rowsAway < dropLen ? 1.0 : 0.0;
    c = mix(vec3(luma), c, mix(1.0, f, uIntensity) * (1.0 - inDrop * 0.7));
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 30. Color fringing — animated per-scanline RGB offsets
const FX_COLORFRINGE = HEAD + `
void main(){
  float row = floor(vUv.y * uResolution.y);
  float t = uTime * mix(0.5, 5.0, uParam3);
  float rOff = mix(-0.02, 0.02, uParam0) * sin(row * 0.5 + t) * uIntensity;
  float gOff = mix(-0.02, 0.02, uParam1) * cos(row * 0.7 + t * 1.3) * uIntensity;
  float bOff = mix(-0.02, 0.02, uParam2) * sin(row * 0.3 - t * 0.8) * uIntensity;
  float r = texture(uTex, vUv + vec2(rOff, 0.0)).r;
  float g = texture(uTex, vUv + vec2(gOff, 0.0)).g;
  float b = texture(uTex, vUv + vec2(bOff, 0.0)).b;
  outColor = vec4(r, g, b, 1.0);
}
`;

// 31. VHS head switching band — bottom-of-frame distortion
const FX_HEANSWITCH = HEAD + `
void main(){
  vec2 uv = vUv;
  float bandPos = 1.0 - mix(0.02, 0.08, uParam0) - hash11(floor(uTime * 3.0) + uSeed) * 0.01;
  float bandHeight = mix(0.01, 0.06, uParam0);
  float dist = (vUv.y - bandPos) / bandHeight;
  float inBand = smoothstep(1.0, 0.0, abs(dist));
  float noiseVal = (hash21(vUv * uResolution + floor(uTime * 60.0)) - 0.5) * mix(0.0, 0.3, uParam1 * uIntensity);
  float displacement = inBand * (noiseVal + mix(0.0, 0.08, uParam2 * uIntensity) * sin(vUv.y * 200.0));
  uv.x += displacement;
  vec3 c = texture(uTex, uv).rgb;
  vec3 noiseCol = hash23(vUv * uResolution + floor(uTime * 30.0)) * 0.5;
  c = mix(c, mix(c, noiseCol, 0.6), inBand * uIntensity);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 32. VHS tracking error — rolling displaced band
const FX_TRACKING = HEAD + `
void main(){
  vec2 uv = vUv;
  float bandCenter = fract(uTime * mix(0.05, 0.25, uParam2));
  float bandWidth = mix(0.05, 0.35, uParam0);
  float dist = abs(vUv.y - bandCenter) / bandWidth;
  float inBand = smoothstep(1.0, 0.0, dist) * smoothstep(0.0, 0.15, dist);
  float noiseVal = (hash21(floor(vUv * vec2(40.0, 1.0)) + floor(uTime * 15.0)) - 0.5) * mix(0.0, 0.35, uParam1 * uIntensity);
  uv.x += inBand * noiseVal;
  vec3 c = texture(uTex, uv).rgb;
  c = mix(c, c * 0.7 + hash23(vUv * uResolution + floor(uTime * 20.0)) * 0.3, inBand * uIntensity);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 33. VHS edge enhancement — unsharp mask with overshoot ringing
const FX_EDGEBOOST = HEAD + `
void main(){
  vec2 px = 1.0 / uResolution;
  float kernel = mix(1.0, 5.0, uParam1);
  vec3 c = texture(uTex, vUv).rgb;
  vec3 blur = vec3(0.0);
  for (float x = -kernel; x <= kernel; x += 1.0){
    for (float y = -kernel; y <= kernel; y += 1.0){
      blur += texture(uTex, vUv + px * vec2(x, y)).rgb;
    }
  }
  blur /= ((kernel * 2.0 + 1.0) * (kernel * 2.0 + 1.0));
  float gain = mix(0.0, 2.5, uParam0 * uIntensity);
  float overshoot = mix(0.0, 0.5, uParam2 * uIntensity);
  vec3 sharp = c + (c - blur) * gain;
  vec3 halo = (c - blur) * overshoot;
  vec3 result = sharp + halo;
  result = max(vec3(0.0), min(vec3(1.0), result));
  outColor = vec4(mix(c, result, uIntensity), 1.0);
}
`;

// 34. Phosphor persistence — luminance-weighted ghost burn from previous frame
const FX_PHOSPHOR = HEAD + `
void main(){
  vec3 cur = texture(uTex, vUv).rgb;
  vec3 prev = texture(uPrev, vUv).rgb;
  float lum = dot(cur, vec3(0.299, 0.587, 0.114));
  float threshold = mix(0.05, 0.6, uParam1);
  float decay = mix(0.01, 0.5, uParam0) * (1.0 + (1.0 - lum) * mix(0.5, 3.0, uParam2));
  float w = lum > threshold ? exp(-decay * (1.0 / 60.0)) : 0.0;
  outColor = vec4(max(cur, prev * w), 1.0);
}
`;

// 35. Degaussing ripple — radial RGB rainbow warp from a point
const FX_DEGAUSS = HEAD + `
void main(){
  vec2 center = vec2(hash11(uSeed + 0.1) * 0.6 + 0.2, hash11(uSeed + 0.2) * 0.6 + 0.2);
  float phase = fract(uTime * mix(0.5, 3.0, uParam3));
  float wavelength = mix(0.5, 4.0, uParam0);
  float amplitude = mix(0.0, 0.12, uParam1 * uIntensity) * sin(phase * 10.0) * max(0.0, 1.0 - phase * 2.0);
  float spread = mix(0.3, 2.5, uParam2);
  vec2 delta = vUv - center;
  float dist = length(delta);
  float wave = sin(dist * 30.0 * wavelength - phase * 8.0) * amplitude * exp(-dist * spread * 3.0);
  float r = texture(uTex, vUv + delta * wave * 1.3).r;
  float g = texture(uTex, vUv + delta * wave * 0.9).g;
  float b = texture(uTex, vUv + delta * wave * 1.6).b;
  outColor = vec4(r, g, b, 1.0);
}
`;

// 36. Beam convergence error — RGB misalignment worse at corners
const FX_BEAMCONV = HEAD + `
void main(){
  vec2 c = vUv - 0.5;
  float cornerDist = dot(c, c) * mix(0.5, 4.0, uParam2);
  float rOff = cornerDist * mix(0.0, 0.03, uParam0 * uIntensity);
  float gOff = cornerDist * mix(0.0, 0.03, uParam1 * uIntensity);
  rOff += sin(uTime * 0.5 + uSeed) * 0.002 * uIntensity;
  gOff += cos(uTime * 0.6 + uSeed) * 0.002 * uIntensity;
  float r = texture(uTex, vUv + vec2(rOff, 0.0)).r;
  float g = texture(uTex, vUv + vec2(gOff, 0.0)).g;
  float b = texture(uTex, vUv).b;
  outColor = vec4(r, g, b, 1.0);
}
`;

// 37. Vertical hold failure — frame snap or rolling sync tear
const FX_VHOLD = HEAD + `
void main(){
  float offset = 0.0;
  float tearLine = 0.0;
  float rollMode = mix(0.0, 1.0, uParam1);
  float jitterAmt = mix(0.002, 0.08, uParam0 * uIntensity);
  if (rollMode > 0.5){
    float rollSpeed = mix(0.5, 3.0, uParam0);
    offset = fract(uTime * rollSpeed + uSeed);
    offset += (hash11(floor(uTime * 10.0)) - 0.5) * 0.02 * uIntensity;
    tearLine = fract(offset * 3.0 + uTime * 0.1);
  } else {
    offset = (hash11(floor(uTime * 5.0) + uSeed) - 0.5) * jitterAmt;
    tearLine = fract(vUv.y * 20.0 + uTime);
  }
  vec2 uv = fract(vUv + vec2(0.0, offset));
  float inTear = smoothstep(0.0, 0.01, abs(uv.y - tearLine)) * uParam2 * uIntensity;
  vec3 c = texture(uTex, uv).rgb;
  c = mix(c, c.brg, inTear);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 38. RF noise / analog snow — temporal noise with sync banding
const FX_STATICFX = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float grain = hash21(vUv * uResolution + floor(uTime * 60.0));
  float snow = mix(0.0, 0.5, uParam0 * uIntensity);
  float n = (grain - 0.5) * snow;
  float syncFreq = uResolution.y * 0.02;
  float banding = 1.0 + mix(0.0, 0.3, uParam1 * uIntensity) * sin(vUv.y * syncFreq * 2.0 * 3.14159265);
  float streak = step(0.97, hash11(floor(vUv.y * 100.0) + floor(uTime * 40.0)));
  float streakVal = streak * (hash21(vec2(vUv.x * 200.0, floor(vUv.y * 100.0))) - 0.5) * mix(0.0, 0.6, uParam2 * uIntensity);
  float grainSize = mix(2.0, 8.0, uParam3);
  vec2 gUv = floor(vUv * uResolution / grainSize);
  float bigGrain = hash21(gUv + floor(uTime * 30.0));
  n += (bigGrain - 0.5) * snow * 0.3;
  n = n * banding + streakVal;
  outColor = vec4(mix(c, c + n, uIntensity), 1.0);
}
`;

// 39. Halation — CRT glass scatter glow around bright areas
const FX_HALATION = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec2 px = 1.0 / uResolution;
  float radius = mix(2.0, 15.0, uParam0);
  vec3 glow = vec3(0.0);
  float count = 0.0;
  for (float x = -6.0; x <= 6.0; x += 1.0){
    for (float y = -6.0; y <= 6.0; y += 1.0){
      float dist = length(vec2(x, y));
      float w = exp(-dist * dist * 0.5 / max(0.1, radius));
      vec3 s = texture(uTex, vUv + px * vec2(x, y) * radius * 0.5).rgb;
      float sl = dot(s, vec3(0.299, 0.587, 0.114));
      float sw = sl * w;
      glow += s * sw;
      count += sw;
    }
  }
  glow = count > 0.0 ? glow / count : vec3(0.0);
  float intensity = mix(0.05, 0.9, uParam1 * uIntensity);
  c = mix(c, c + glow * intensity, uIntensity);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 40. Shadow mask — visible RGB phosphor pattern overlay
const FX_SHADOWMASK = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  vec2 p = vUv * uResolution * mix(0.5, 3.0, uParam2);
  float maskStrength = mix(0.05, 0.6, uParam1 * uIntensity);
  vec3 maskDark = vec3(1.0 - maskStrength);
  vec3 maskLight = vec3(1.0);
  if (uParam0 <= 0.5){
    float stripe = fract(p.x * 0.33333);
    if (stripe < 0.333) c.r *= maskLight.r; else c.r *= maskDark.r;
    if (stripe >= 0.333 && stripe < 0.666) c.g *= maskLight.g; else c.g *= maskDark.g;
    if (stripe >= 0.666) c.b *= maskLight.b; else c.b *= maskDark.b;
    float line = step(0.5, fract(p.y * 0.5));
    c *= mix(maskDark.r, maskLight.r, line);
  } else {
    vec2 dotP = floor(p * vec2(1.0, 0.5));
    dotP.x += dotP.y * 3.0;
    float slot = fract(dotP.x * 0.16666);
    if (slot < 0.333) c.r *= maskLight.r; else c.r *= maskDark.r;
    if (slot >= 0.333 && slot < 0.666) c.g *= maskLight.g; else c.g *= maskDark.g;
    if (slot >= 0.666) c.b *= maskLight.b; else c.b *= maskDark.b;
  }
  outColor = vec4(mix(texture(uTex, vUv).rgb, c, uIntensity), 1.0);
}
`;

// 41. Pincushion — animated CRT geometry bowing
const FX_PINCUSHION = HEAD + `
void main(){
  vec2 c = vUv - 0.5;
  float bow = mix(0.0, 0.25, uParam0 * uIntensity) * (0.5 + 0.5 * sin(uTime * mix(0.3, 2.0, uParam2) + uSeed));
  float r2 = dot(c, c);
  vec2 warp = c * (1.0 + bow * r2) + 0.5;
  if (warp.x < 0.0 || warp.x > 1.0 || warp.y < 0.0 || warp.y > 1.0){
    float cornerDark = mix(0.0, 0.85, uParam1 * uIntensity);
    outColor = vec4(vec3(0.0), 1.0);
  } else {
    vec3 col = texture(uTex, warp).rgb;
    float vignette = 1.0 - (1.0 - smoothstep(0.6, 0.0, 1.0 - r2 * 2.0)) * mix(0.0, 0.8, uParam1 * uIntensity);
    col *= vignette;
    outColor = vec4(col, 1.0);
  }
}
`;

// 42. Scanline beam profile — brightness-dependent beam width
const FX_SCANBEAM = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float scanY = fract(vUv.y * uResolution.y);
  float beamMin = mix(0.1, 1.0, uParam0);
  float beamMax = mix(0.5, 6.0, uParam1);
  float beamWidth = mix(beamMin, beamMax, lum * mix(0.5, 2.0, uParam3));
  float scanline = 1.0 - pow(abs((1.0 - scanY) - 0.5) * 2.0, beamWidth);
  float gapDark = mix(0.0, 0.9, uParam2 * uIntensity);
  scanline = mix(1.0 - gapDark, 1.0, scanline);
  outColor = vec4(mix(c, c * scanline, uIntensity), 1.0);
}
`;

// 43. Frame wiggle — low-frequency sway from deflection instability
const FX_WIGGLE = HEAD + `
void main(){
  float xAmp = mix(0.0, 0.015, uParam0 * uIntensity);
  float yAmp = mix(0.0, 0.012, uParam1 * uIntensity);
  float speed = mix(0.3, 3.0, uParam2);
  float sx = sin(uTime * speed * 0.7 + uSeed) * xAmp + sin(uTime * speed * 1.3 + uSeed * 0.7) * xAmp * 0.6;
  float sy = cos(uTime * speed * 0.5 + uSeed * 1.1) * yAmp + cos(uTime * speed * 0.9 + uSeed * 0.3) * yAmp * 0.4;
  outColor = texture(uTex, vUv + vec2(sx, sy));
}
`;

// 44. Isolated cathode bloom — thresholded bright-region blur + additive blend
const FX_BLOOMFX = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float threshold = mix(0.3, 0.9, uParam0);
  float knee = mix(0.05, 0.5, uParam3);
  float extracted = smoothstep(threshold - knee, threshold + knee, lum);
  vec2 px = 1.0 / uResolution;
  float radius = mix(0.002, 0.03, uParam1);
  vec3 bloom = vec3(0.0);
  float count = 0.0;
  for (float x = -4.0; x <= 4.0; x += 1.0){
    for (float y = -4.0; y <= 4.0; y += 1.0){
      float dist = length(vec2(x, y));
      float w = exp(-dist * dist / (1.0 + radius * 60.0));
      vec3 s = texture(uTex, vUv + px * vec2(x, y) * (1.0 + radius * 2.0)).rgb;
      float sl = dot(s, vec3(0.299, 0.587, 0.114));
      float sw = smoothstep(threshold - knee, threshold + knee, sl) * w;
      bloom += s * sw;
      count += sw;
    }
  }
  bloom = count > 0.0 ? bloom / count : vec3(0.0);
  float intensity = mix(0.1, 1.2, uParam2 * uIntensity);
  outColor = vec4(c + bloom * intensity, 1.0);
}
`;

// 45. NTSC subcarrier phase drift — per-line hue rotation desynchronization
const FX_SCANPHASE = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float row = floor(vUv.y * uResolution.y);
  float drift = sin(uTime * 0.4 + row * 0.15) * mix(0.0, 0.15, uParam0 * uIntensity);
  drift += sin(uTime * 0.7 + row * 0.09) * mix(0.0, 0.08, uParam1 * uIntensity);
  float hue = drift + uTime * mix(0.0, 0.5, uParam2) * uIntensity;
  vec3 hsv = rgb2hsv(c);
  hsv.x = fract(hsv.x + hue);
  vec3 shifted = hsv2rgb(hsv);
  float flicker = 1.0 + sin(uTime * 30.0 + row * 3.0) * mix(0.0, 0.15, uParam1 * uIntensity);
  shifted *= flicker;
  outColor = vec4(mix(c, shifted, uIntensity), 1.0);
}
`;

// 46. Dissolve — image vertically dissolves into horizontal noise bands that scroll
const FX_DISSOLVE = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float bandPos = fract(uTime * mix(0.05, 0.3, uParam2) + uSeed);
  float bandWidth = mix(0.04, 0.5, uParam0);
  float dist = abs(vUv.y - bandPos) / bandWidth;
  float inZone = smoothstep(1.0, 0.6, dist) * smoothstep(0.0, 0.4, dist);
  float n = hash21(vUv * uResolution + floor(uTime * 60.0));
  float noiseFill = mix(n, hash11(vUv.x * 200.0 + uTime * 30.0), 0.5);
  vec3 noiseCol = vec3(noiseFill) * mix(0.3, 1.5, uParam1);
  vec3 dissolved = mix(c, noiseCol, inZone * uIntensity);
  dissolved = mix(dissolved, dissolved.bgr * 0.8 + noiseCol * 0.2, inZone * uParam1 * uIntensity);
  outColor = vec4(clamp(dissolved, 0.0, 1.0), 1.0);
}
`;

// 47. Color bars — injected chroma carrier creates psychedelic horizontal color bands
const FX_COLORBARS = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float row = floor(vUv.y * uResolution.y);
  float bandCount = mix(4.0, 40.0, uParam0);
  float band = floor(row / (uResolution.y / bandCount));
  float hue = fract(band * 0.17 + uTime * mix(0.1, 1.5, uParam2) + lum * mix(0.0, 2.0, uParam3));
  float intensity = mix(0.0, 1.0, uParam1 * uIntensity) * (0.5 + 0.5 * sin(row * 0.3 + uTime * 3.0));
  vec3 barColor = hsv2rgb(vec3(hue, 0.9, 1.0));
  float modulation = sin(row * 0.5 + uTime * 8.0) * mix(0.0, 0.5, uParam3);
  c = mix(c, clamp(barColor * (lum + 0.5) + modulation, 0.0, 1.0), intensity);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 48. Channel swap — horizontal strips get RGB channels randomly remixed
const FX_CHANNELSWAP = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float stripCount = mix(3.0, 20.0, uParam0);
  float strip = floor(vUv.y * stripCount);
  float r = hash11(strip * 13.7 + floor(uTime * mix(0.5, 8.0, uParam2)) + uSeed);
  int mode = int(r * 5.0);
  float blend = mix(0.0, 1.0, uParam1 * uIntensity) * step(0.5, hash11(strip + floor(uTime * 3.0) * 2.7));
  vec3 swapped;
  if (mode == 0) swapped = c.rgb;
  else if (mode == 1) swapped = c.gbr;
  else if (mode == 2) swapped = c.brg;
  else if (mode == 3) swapped = c.bgr;
  else swapped = 1.0 - c.rgb;
  c = mix(c, swapped, blend);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;





















// 50. Luma crush + chroma blowout — extreme contrast + neon saturation
const FX_CRUSHBLOW = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  vec3 hsv = rgb2hsv(c);
  float crush = mix(0.0, 1.0, uParam0 * uIntensity);
  float knee = mix(0.02, 0.3, uParam3);
  hsv.z = smoothstep(0.0, knee, hsv.z) * smoothstep(1.0, 1.0 - knee, hsv.z) * (1.0 + crush * 0.3);
  hsv.z = hsv.z * (1.0 + crush) - crush * 0.3;
  hsv.z = clamp(hsv.z, 0.0, 1.0);
  hsv.y = clamp(hsv.y * (1.0 + mix(0.0, 3.0, uParam1 * uIntensity)), 0.0, 1.0);
  hsv.x = fract(hsv.x + mix(0.0, 0.3, uParam2 * uIntensity));
  c = hsv2rgb(hsv);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 51. Slice shift — horizontal bands get displacement + independent color treatment
const FX_SLICESHIFT = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float bands = mix(4.0, 30.0, uParam0);
  float band = floor(vUv.y * bands + uTime * mix(0.3, 3.0, uParam3));
  float r = hash11(band + uSeed + floor(uTime * 2.0));
  float trigger = step(1.0 - uIntensity * 0.8, r);
  float off = (hash11(band * 2.3 + uSeed) - 0.5) * mix(0.0, 0.7, uParam1) * trigger;
  vec2 uv = vec2(clamp(vUv.x + off, 0.0, 1.0), vUv.y);
  vec3 shifted = texture(uTex, uv).rgb;
  float hueShift = hash11(band * 7.1 + uSeed + floor(uTime * 0.5)) * mix(0.0, 0.5, uParam2);
  vec3 hsv = rgb2hsv(shifted);
  hsv.x = fract(hsv.x + hueShift * uIntensity * trigger);
  hsv.y = clamp(hsv.y * (1.0 + hueShift * uIntensity * trigger), 0.0, 1.0);
  shifted = hsv2rgb(hsv);
  outColor = vec4(clamp(mix(c, shifted, trigger * uIntensity), 0.0, 1.0), 1.0);
}
`;

// 52. Noise wipe — structured noise wall rolls across the frame dissolving everything
const FX_NOISEWIPE = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float wipePos = fract(uTime * mix(0.05, 0.35, uParam2) + uSeed * 0.1);
  float edgeWidth = mix(0.03, 0.2, uParam0);
  float behindWipe = smoothstep(wipePos - edgeWidth, wipePos, vUv.y);
  float n1 = hash21(floor(vUv * uResolution / mix(2.0, 12.0, uParam3)) + floor(uTime * 30.0));
  float n2 = hash11(floor(vUv.y * uResolution.y * 0.1) + floor(uTime * 15.0));
  float n3 = sin(vUv.y * uResolution.y * 0.05 + uTime * 10.0) * 0.5 + 0.5;
  float noiseVal = (n1 - 0.5) * 0.6 + (n2 - 0.5) * 0.3 + (n3 - 0.5) * 0.1;
  vec3 noiseCol = vec3(noiseVal) * mix(0.5, 1.8, uParam1);
  float corruption = hash21(vec2(floor(vUv.x * 20.0), floor(vUv.y * 10.0)) + floor(uTime * 20.0));
  noiseCol = mix(noiseCol, noiseCol.bgr, corruption * behindWipe * uIntensity);
  c = mix(c, noiseCol, behindWipe * uIntensity);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 53. Chroma smear plus — heavy horizontal chroma blur + per-row vertical displacement
const FX_CHROMASMEARPLUS = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float row = floor(vUv.y * uResolution.y);
  float yOff = (hash11(row + floor(uTime * 4.0) + uSeed) - 0.5) * mix(0.0, 0.15, uParam2 * uIntensity);
  vec2 uv = vUv;
  uv.y = clamp(vUv.y + yOff, 0.0, 1.0);
  float smearRadius = mix(2.0, 25.0, uParam0);
  float smearWidth = mix(0.002, 0.06, uParam0 * uIntensity);
  vec3 smear = vec3(0.0);
  float count = 0.0;
  for (float x = -smearRadius; x <= smearRadius; x += 1.0){
    float w = exp(-x * x / (smearRadius * smearRadius * 0.1));
    smear += texture(uTex, clamp(uv + vec2(x * smearWidth * 0.3, 0.0), 0.0, 1.0)).rgb * w;
    count += w;
  }
  smear = count > 0.0 ? smear / count : vec3(0.0);
  float lum = dot(smear, vec3(0.299, 0.587, 0.114));
  float chromaKeep = mix(1.0, 0.0, uParam1 * uIntensity);
  vec3 sharpLuma = vec3(lum);
  vec3 result = sharpLuma + (smear - sharpLuma) * chromaKeep;
  result = clamp(result, 0.0, 1.0);
  outColor = vec4(result, 1.0);
}
`;

// 54. Hue spread — per-scanline hue rotation random walk creating horizontal gradients
const FX_HUESPREAD = HEAD + `
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float row = floor(vUv.y * uResolution.y);
  float seed = uSeed;
  float hue = 0.0;
  for (float r = 0.0; r <= row; r += 1.0){
    hue += (hash11(r * 1.7 + seed + floor(uTime * 0.2)) - 0.5) * 0.1;
  }
  hue = hue * mix(0.0, 3.0, uParam0 * uIntensity);
  float drift = sin(uTime * 0.3 + seed) * mix(0.0, 0.4, uParam1 * uIntensity);
  float saturation = mix(1.0, 2.5, uParam2 * uIntensity);
  vec3 hsv = rgb2hsv(c);
  hsv.x = fract(hsv.x + hue + drift);
  hsv.y = clamp(hsv.y * saturation, 0.0, 1.0);
  c = hsv2rgb(hsv);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// 55. Frame rip — frame buffer tearing with time displacement
const FX_FRAMERIP = HEAD + `
void main(){
  vec3 cur = texture(uTex, vUv).rgb;
  float tearCount = mix(1.0, 8.0, uParam0);
  float result = 0.0;
  for (float t = 0.0; t < tearCount; t += 1.0){
    float tearY = hash11(t * 3.3 + floor(uTime * mix(1.0, 10.0, uParam2)) + uSeed);
    float tearWidth = mix(0.005, 0.06, uParam1);
    float tearProximity = 1.0 - smoothstep(0.0, tearWidth, abs(vUv.y - tearY));
    float offset = (hash11(t * 7.1 + uTime * 0.5) - 0.5) * mix(0.0, 0.4, uParam1 * uIntensity);
    vec2 ripUv = vec2(fract(vUv.x + offset * tearProximity), vUv.y);
    vec3 ripped = texture(uTex, ripUv).rgb;
    float corr = hash11(t * 9.3 + uTime) * tearProximity;
    ripped = mix(ripped, ripped.brg, corr * uIntensity);
    result = max(result, tearProximity);
    cur = mix(cur, ripped, tearProximity * uIntensity);
  }
  outColor = vec4(cur, 1.0);
}
`;

export const EFFECTS = [
  { name: 'rgb_split',   src: FX_RGB, group: 'original',
    desc: 'Chromatic aberration: red and blue channels are pulled apart with a time-varying wobble, creating color-fringed edges.',
    paramDescs: ['Displacement strength — how far R and B channels spread apart', 'Direction angle derived from seed', 'Wobble frequency — oscillation intensity over time', '(unused)'] },
  { name: 'datamosh',    src: FX_DATAMOSH, group: 'original',
    desc: 'Motion smear / datamosh: per-block jitter mixes the previous frame with the current one, keeping or smearing blocks.',
    paramDescs: ['Block jitter intensity', 'Keep/smear threshold bias', 'Horizontal displacement scale', '(unused)'] },
  { name: 'pixsort',     src: FX_PIXSORT, group: 'original',
    desc: 'Pixel-sort-ish: per-row threshold based on luminosity triggers horizontal smear; bright pixels are replaced with a horizontally offset sample.',
    paramDescs: ['Sort threshold range', 'Horizontal smear amount', '(unused)', '(unused)'] },
  { name: 'vhs',         src: FX_VHS, group: 'original',
    desc: 'VHS noise: horizontal line jitter, chroma bleed (R/B offsets), scanline darkening, tape noise, and a vertical tracking band.',
    paramDescs: ['Jitter intensity', 'Chroma bleed amount', 'Tape noise intensity', '(unused)'] },
  { name: 'slice',       src: FX_SLICE, group: 'original',
    desc: 'Block displacement: divides the screen into horizontal bands; random bands are shifted horizontally based on a trigger threshold.',
    paramDescs: ['Number of horizontal bands', 'Band scroll speed', '(unused)', '(unused)'] },
  { name: 'feedback',    src: FX_FEEDBACK, group: 'original',
    desc: 'Feedback zoom/rotate: affine warps the previous frame (rotation + scale + translate), blended with the current frame via max().',
    paramDescs: ['Rotation angle', 'Zoom factor', 'Horizontal pan offset', 'Vertical pan offset'] },
  { name: 'wave',        src: FX_WAVE, group: 'original',
    desc: 'Sine wave warp: slit-scan displacement using sine waves in both X and Y directions.',
    paramDescs: ['Horizontal wave frequency', 'Vertical wave frequency', '(unused)', '(unused)'] },
  { name: 'color',       src: FX_COLOR, group: 'original',
    desc: 'HSV manipulation: hue rotation, saturation boost, posterization/bit-crush (floor quantization), optional inversion.',
    paramDescs: ['Hue shift amount', 'Saturation multiplier', 'Posterization step count', 'Invert toggle (triggers above 0.7)'] },
  { name: 'crt',         src: FX_CRT, group: 'original',
    desc: 'CRT barrel distortion + vignette + cheap 4-tap bloom: curves the image, darkens edges, and adds a subtle glow around bright areas.',
    paramDescs: ['Barrel distortion strength', 'Vignette intensity', 'Bloom brightness', '(unused)'] },
  { name: 'mosaic',      src: FX_MOSAIC, group: 'original',
    desc: 'Pixelation mosaic: downsamples the image by quantizing UV coordinates to a grid of variable block size.',
    paramDescs: ['Block size (higher = smaller blocks)', '(unused)', '(unused)', '(unused)'] },
  { name: 'ascii',       src: FX_ASCII, group: 'original',
    desc: 'ASCII-style rendering: divides the screen into cells, computes luminance, and draws dots scaled by brightness.',
    paramDescs: ['Cell density (higher = more cells)', '(unused)', '(unused)', '(unused)'] },
  { name: 'jpegblocks',  src: FX_BLOCKS, group: 'original',
    desc: 'Fake JPEG/DCT block corruption: random blocks are displaced and tinted, simulating damaged compression blocks.',
    paramDescs: ['Block size (higher = smaller blocks)', '(unused)', '(unused)', '(unused)'] },
  { name: 'interlace',   src: FX_INTERLACE, group: 'original',
    desc: 'Interlace tearing: odd rows drift sideways with a sine-based offset; odd rows are also dimmed.',
    paramDescs: ['Drift frequency', '(unused)', '(unused)', '(unused)'] },
  { name: 'voronoi',     src: FX_VORONOI, group: 'original',
    desc: 'Voronoi shatter: computes a Voronoi diagram on the fly and displaces UVs by cell center offsets.',
    paramDescs: ['Cell density (higher = more cells)', '(unused)', '(unused)', '(unused)'] },
  { name: 'band',        src: FX_BAND, group: 'original',
    desc: 'Tracking band roll: a horizontal band sweeps down with noise fill and red/blue channel swap inside the band.',
    paramDescs: ['Band height', 'Noise density inside band', '(unused)', '(unused)'] },
  { name: 'echo',        src: FX_ECHO, group: 'original',
    desc: 'Echo/motion trails: blends the previous frame (slightly offset) with the current one via max() blend.',
    paramDescs: ['Blend opacity', 'Trail offset distance', '(unused)', '(unused)'] },
  { name: 'edge',        src: FX_EDGE, group: 'original',
    desc: 'Sobel edge detection: 3x3 luminance kernel finds edges, colors them, and blends with the base image.',
    paramDescs: ['Red edge intensity', 'Green edge intensity', 'Blue edge intensity', '(unused)'] },
  { name: 'barcode',     src: FX_BARCODE, group: 'original',
    desc: 'Glitch text bars: horizontal bands turn certain columns into solid bars based on a PRNG pattern.',
    paramDescs: ['Column density', '(unused)', '(unused)', '(unused)'] },
  { name: 'strobe',      src: FX_STROBE, group: 'original',
    desc: 'Time freeze/strobe: at intervals determined by configurable frequency, blends the previous frame with the current one.',
    paramDescs: ['Strobe frequency', '(unused)', '(unused)', '(unused)'] },
  { name: 'solarize',    src: FX_SOLARIZE, group: 'original',
    desc: 'Solarize: threshold-based inversion plus per-pixel hash noise, creating the classic darkroom solarization look.',
    paramDescs: ['Inversion threshold', '(unused)', '(unused)', '(unused)'] },
  { name: 'lineshift',   src: FX_LINESHIFT, group: 'original',
    desc: 'Vertical line drift: per-column Y offsets make vertical lines shift up and down.',
    paramDescs: ['Column density (higher = more columns)', '(unused)', '(unused)', '(unused)'] },
  { name: 'tunnel',      src: FX_TUNNEL, group: 'original',
    desc: 'Polar tunnel warp: converts UVs to polar coordinates, animates angle and radius, mixes with source.',
    paramDescs: ['Radial animation speed', 'Depth scroll speed', '(unused)', '(unused)'] },
  { name: 'bitflip',     src: FX_BITFLIP, group: 'original',
    desc: 'Bitflip channel scrambling: per-block PRNG toggles between swapping channels (BGR) and quantizing to low bit depths.',
    paramDescs: ['Bit depth for quantization', 'Block scramble probability', '(unused)', '(unused)'] },
  { name: 'swirl',       src: FX_SWIRL, group: 'original',
    desc: 'Swirl burst: radial swirl around the screen center; rotation amount increases toward center.',
    paramDescs: ['Swirl strength', '(unused)', '(unused)', '(unused)'] },
  { name: 'ghostrgb',    src: FX_GHOSTRGB, group: 'original',
    desc: 'Chroma ghost trails: samples the previous frame at two different offsets, composites R/G/B from different sources.',
    paramDescs: ['Ghost offset X scale', 'Ghost offset Y scale', '(unused)', '(unused)'] },

  { name: 'ntsc',        src: FX_NTSC, group: 'analogue',
    desc: 'NTSC composite artifacts: full composite video encode/decode cycle with dot crawl checkerboard patterns and cross-color rainbow banding on sharp edges.',
    controls: [
      { label: 'Dot Crawl',  param: 0, min: 0, max: 1, step: 0.01, default: 0.65, desc: 'Strength of the moving checkerboard pattern on colored edges from chroma/luma crosstalk' },
      { label: 'Rainbow',    param: 1, min: 0, max: 1, step: 0.01, default: 0.55, desc: 'Cross-color rainbow banding intensity on sharp luminance transitions' },
      { label: 'Chroma Blur',param: 2, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Horizontal chroma bandwidth limit — smears color info across the scanline' },
      { label: 'Phase Drift',param: 3, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Per-scanline color phase variation creating subtle hue flickering' },
      { label: 'Luma Bleed', param: 4, min: 0, max: 1, step: 0.01, default: 0.2, desc: 'Luminance signal leaking into chroma channels causing brightness-modulated color noise' },
    ] },
  { name: 'posterize',   src: FX_POSTERIZE, group: 'analogue',
    desc: 'Hardware-style ADC/DAC bit truncation: quantizes color channels to coarse bands the way 1980s video hardware did.',
    controls: [
      { label: 'Bit Depth',  param: 0, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Number of bits kept per channel — lower = fewer colors, coarser bands (2–8 bits)' },
      { label: 'Dither',     param: 1, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Per-pixel noise dithering to soften harsh quantization steps' },
    ] },
  { name: 'chromadrop',  src: FX_CHROMADROP, group: 'analogue',
    desc: 'Chroma dropout: random scanlines lose color saturation entirely and revert to grayscale, simulating failing chroma decoder chips or tape degradation.',
    controls: [
      { label: 'Drop Rate',  param: 0, min: 0, max: 1, step: 0.01, default: 0.35, desc: 'Probability of chroma loss per scanline — higher = more lines affected' },
      { label: 'Line Length',param: 1, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'How many consecutive scanlines the dropout spans' },
      { label: 'Edge Softness',param: 2, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'How soft the transition is between color and grayscale at dropout boundaries' },
    ] },
  { name: 'colorfringe', src: FX_COLORFRINGE, group: 'analogue',
    desc: 'Living chromatic aberration: RGB channels get animated per-scanline offsets that shift differently across the screen, breathing with independent sine waves.',
    controls: [
      { label: 'R-Shift',    param: 0, min: 0, max: 1, step: 0.01, default: 0.7, desc: 'Red channel horizontal offset amplitude' },
      { label: 'G-Shift',    param: 1, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Green channel horizontal offset amplitude' },
      { label: 'B-Shift',    param: 2, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'Blue channel horizontal offset amplitude' },
      { label: 'Speed',      param: 3, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Animation speed of the per-scanline offset oscillation' },
    ] },
  { name: 'headswitch',  src: FX_HEANSWITCH, group: 'analogue',
    desc: 'VHS head switching band: the bottom few scanlines of the frame are distorted with horizontal displacement, color corruption, and noise — exactly where VHS playback heads alternate.',
    controls: [
      { label: 'Band Height',param: 0, min: 0, max: 1, step: 0.01, default: 0.45, desc: 'How many scanlines at the bottom of the frame are affected' },
      { label: 'Noise',      param: 1, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'Noise intensity inside the head switching band' },
      { label: 'Displacement',param: 2, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Horizontal shift amount applied to the distorted scanlines' },
    ] },
  { name: 'tracking',    src: FX_TRACKING, group: 'analogue',
    desc: 'VHS tracking error: a horizontal band of offset/displaced video rolls vertically with soft feathered edges and noise fill, simulating dirty VCR heads or worn tape.',
    controls: [
      { label: 'Band Width', param: 0, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Height of the tracking error band' },
      { label: 'Noise',      param: 1, min: 0, max: 1, step: 0.01, default: 0.7, desc: 'Noise intensity within the tracking band' },
      { label: 'Speed',      param: 2, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Vertical scroll speed of the tracking band' },
    ] },
  { name: 'edgeboost',   src: FX_EDGEBOOST, group: 'analogue',
    desc: 'VHS edge enhancement / sharpening halo: unsharp mask with overshoot ringing creating the characteristic bright/dark halos at high-contrast transitions.',
    controls: [
      { label: 'Sharpness',  param: 0, min: 0, max: 1, step: 0.01, default: 0.7, desc: 'Edge enhancement gain — higher = sharper edges with stronger halos' },
      { label: 'Kernel Size',param: 1, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Blur kernel radius for the unsharp mask — larger = wider halos' },
      { label: 'Overshoot',  param: 2, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Ringing overshoot intensity — creates the bright/dark fringe at edges' },
    ] },
  { name: 'phosphor',    src: FX_PHOSPHOR, group: 'analogue',
    desc: 'Phosphor persistence / ghost burn: bright pixels from the previous frame leave a decaying luminance-weighted trail, simulating CRT phosphor afterglow.',
    controls: [
      { label: 'Decay Rate', param: 0, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'How quickly the phosphor trail fades — lower = longer persistent trails' },
      { label: 'Threshold',  param: 1, min: 0, max: 1, step: 0.01, default: 0.2, desc: 'Minimum brightness required for a pixel to leave a trail' },
      { label: 'Trail Length',param: 2, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Trail persistence multiplier — higher = brighter pixels leave much longer ghosting' },
    ] },
  { name: 'degauss',     src: FX_DEGAUSS, group: 'analogue',
    desc: 'Magnetic degaussing burst: a radial RGB rainbow ripple warps outward from a point, each channel displaced at a different amplitude — simulating a degauss coil pulse.',
    controls: [
      { label: 'Wavelength', param: 0, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Ripple frequency — more rings in the burst' },
      { label: 'Amplitude',  param: 1, min: 0, max: 1, step: 0.01, default: 0.8, desc: 'Displacement intensity of the color distortion' },
      { label: 'Spread',     param: 2, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'How far the ripple spreads from its origin point' },
      { label: 'Speed',      param: 3, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Animation speed of the degaussing ripple' },
    ] },
  { name: 'beamconv',    src: FX_BEAMCONV, group: 'analogue',
    desc: 'Electron beam convergence error: R/G/B electron beams misalign progressively toward screen corners (worse at edges, like real CRTs) with slow breathing displacement.',
    controls: [
      { label: 'Red Misalign',param: 0, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Red channel convergence error — how far red drifts from center' },
      { label: 'Grn Misalign',param: 1, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Green channel convergence error — how far green drifts from center' },
      { label: 'Corner Bias', param: 2, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'How much worse convergence gets at screen corners vs center' },
    ] },
  { name: 'vhold',       src: FX_VHOLD, group: 'analogue',
    desc: 'Vertical hold / sync failure: the frame snaps vertically or enters a rolling state where rows progressively shift, creating the classic CRT vertical roll with a visible tearing sync bar.',
    controls: [
      { label: 'Jitter Amt', param: 0, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Vertical displacement amount — how far the frame jumps' },
      { label: 'Roll Mode',  param: 1, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Probability of full vertical rolling vs discrete frame snapping' },
      { label: 'Tear Intens',param: 2, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'Intensity of the tearing/sync bar at the roll boundary' },
    ] },
  { name: 'static',      src: FX_STATICFX, group: 'analogue',
    desc: 'RF noise / analog TV snow: temporal white noise modulated by horizontal banding at ~15.7 kHz scanline spacing, with optional horizontal streak artifacts.',
    controls: [
      { label: 'Snow',       param: 0, min: 0, max: 1, step: 0.01, default: 0.55, desc: 'Overall snow / noise intensity' },
      { label: 'Banding',    param: 1, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Horizontal sync banding pattern strength' },
      { label: 'Streaks',    param: 2, min: 0, max: 1, step: 0.01, default: 0.2, desc: 'Probability and intensity of horizontal noise streaks' },
      { label: 'Grain Size', param: 3, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Noise grain size — higher = larger, blockier noise particles' },
    ] },
  { name: 'halation',    src: FX_HALATION, group: 'analogue',
    desc: 'CRT glass scatter halo: a wide, subtle soft glow around very bright areas from photon spread inside the thick CRT glass — wider radius but lower intensity than bloom.',
    controls: [
      { label: 'Glow Radius',param: 0, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Spread of the glass scatter — larger = wider, softer glow' },
      { label: 'Brightness', param: 1, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Overall intensity of the glow around bright areas' },
      { label: 'Threshold',  param: 2, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'Minimum brightness required for a pixel to emit glow' },
    ] },
  { name: 'shadowmask',  src: FX_SHADOWMASK, group: 'analogue',
    desc: 'CRT phosphor mask overlay: visible RGB subpixel pattern — aperture grille (Sony Trinitron vertical stripes) or shadow mask (offset RGB dot triads).',
    controls: [
      { label: 'Mask Type',  param: 0, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Mask style — below 0.5 = aperture grille (vertical stripes), above 0.5 = shadow mask (dot triads)' },
      { label: 'Strength',   param: 1, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Visibility of the phosphor mask pattern' },
      { label: 'Scale',      param: 2, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Size of the mask pattern relative to screen resolution' },
    ] },
  { name: 'pincushion',  src: FX_PINCUSHION, group: 'analogue',
    desc: 'Dynamic CRT geometry instability: image edges bow in and out with animated distortion coefficients and corner vignetting, like a CRT that needs service.',
    controls: [
      { label: 'Bow Amount', param: 0, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'How strongly the image bows inward (pincushion) or outward (barrel)' },
      { label: 'Corner Dark',param: 1, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Vignette intensity at the corners during bowing' },
      { label: 'Anim Speed', param: 2, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'How fast the geometry coefficients animate/drift' },
    ] },
  { name: 'scanbeam',    src: FX_SCANBEAM, group: 'analogue',
    desc: 'Brightness-dependent scanline beam profile: bright areas have a wider electron beam (thicker visible scanlines), dark areas have thin beams, with adjustable inter-scanline gap darkness.',
    controls: [
      { label: 'Beam Min',   param: 0, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Minimum scanline beam width (for dark pixels)' },
      { label: 'Beam Max',   param: 1, min: 0, max: 1, step: 0.01, default: 0.7, desc: 'Maximum scanline beam width (for bright pixels)' },
      { label: 'Gap Dark',   param: 2, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'How dark the space between scanlines gets' },
      { label: 'Brightness', param: 3, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'Overall beam brightness — scales the effect contrast' },
    ] },
  { name: 'wiggle',      src: FX_WIGGLE, group: 'analogue',
    desc: 'Frame wobble/breathing: subtle whole-frame displacement with low-frequency sine waves at slightly mismatched frequencies, simulating CRT deflection circuit instability.',
    controls: [
      { label: 'X-Amplitude',param: 0, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Horizontal wobble displacement amount' },
      { label: 'Y-Amplitude',param: 1, min: 0, max: 1, step: 0.01, default: 0.2, desc: 'Vertical wobble displacement amount' },
      { label: 'Speed',      param: 2, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Wobble oscillation frequency' },
    ] },
  { name: 'bloom',       src: FX_BLOOMFX, group: 'analogue',
    desc: 'Isolated cathode bloom: thresholded bright regions are blurred with a multi-tap Gaussian kernel and additively blended back — a proper glow pipeline.',
    controls: [
      { label: 'Threshold',  param: 0, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Minimum brightness required for bloom contribution' },
      { label: 'Radius',     param: 1, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Bloom blur radius — how far the glow spreads' },
      { label: 'Intensity',  param: 2, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Bloom brightness when blended back into the image' },
      { label: 'Knee',       param: 3, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'Softness of the brightness threshold transition' },
    ] },
  { name: 'scanphase',   src: FX_SCANPHASE, group: 'analogue',
    desc: 'NTSC subcarrier phase drift: per-line hue rotation slowly desynchronizes, creating color flickering and shifting across the screen as the color subcarrier drifts.',
    controls: [
      { label: 'Drift Amt',  param: 0, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'Slow per-scanline hue drift amount' },
      { label: 'Flicker',    param: 1, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'High-frequency hue flickering intensity per scanline' },
      { label: 'Hue Rotate', param: 2, min: 0, max: 1, step: 0.01, default: 0.2, desc: 'Global hue rotation speed' },
    ] },
  { name: 'dissolve',     src: FX_DISSOLVE, group: 'bent',
    desc: 'Image dissolution: the frame breaks apart into horizontal noise bands that scroll vertically, dissolving the picture into static with color corruption at the edges of each band.',
    controls: [
      { label: 'Band Width', param: 0, min: 0, max: 1, step: 0.01, default: 0.35, desc: 'How much of the frame the dissolution band covers' },
      { label: 'Noise Intensity', param: 1, min: 0, max: 1, step: 0.01, default: 0.7, desc: 'How aggressive the noise replacement is inside the band' },
      { label: 'Scroll Speed', param: 2, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Vertical scrolling speed of the dissolution band' },
    ] },
  { name: 'colorbars',    src: FX_COLORBARS, group: 'bent',
    desc: 'Injected chroma carrier: wild psychedelic horizontal color bands modulated by the underlying image brightness — like feeding an audio signal into the color subcarrier pin.',
    controls: [
      { label: 'Band Count',  param: 0, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Number of horizontal color bands (4–40)' },
      { label: 'Intensity',   param: 1, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'How strongly the color bars overlay the source' },
      { label: 'Color Speed', param: 2, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'How fast the color bands shift through the spectrum' },
      { label: 'Modulation',  param: 3, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Image content influence on the color band generation' },
    ] },
  { name: 'channelswap',  src: FX_CHANNELSWAP, group: 'bent',
    desc: 'Horizontal-segmented RGB channel remixing: the frame is divided into strips and each strip gets a random channel swap — red becomes green, green becomes blue, etc. Creates wild color palette explosions.',
    controls: [
      { label: 'Strip Count', param: 0, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'How many horizontal strips the frame is divided into' },
      { label: 'Swap Intensity', param: 1, min: 0, max: 1, step: 0.01, default: 0.7, desc: 'How strongly the channels are remixed per strip' },
      { label: 'Swap Speed', param: 2, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'How often the channel mapping changes per strip' },
    ] },
  { name: 'crushblow',    src: FX_CRUSHBLOW, group: 'bent',
    desc: 'Luma crush + chroma blowout: pushes contrast to extremes (crushed blacks, blown whites) while simultaneously boosting saturation to neon levels. Classic circuit-bent enhancer behavior.',
    controls: [
      { label: 'Contrast Crush', param: 0, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'How extreme the contrast push is — higher = more crushed/blown' },
      { label: 'Saturation Boost', param: 1, min: 0, max: 1, step: 0.01, default: 0.7, desc: 'How much the color saturation is pushed past normal' },
      { label: 'Hue Push', param: 2, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Global hue shift applied during the blowout' },
      { label: 'Knee Softness', param: 3, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'How soft the transition is at the crush edges' },
    ] },
  { name: 'sliceshift',   src: FX_SLICESHIFT, group: 'bent',
    desc: 'Sliced displacement with color treatment: horizontal bands get randomly displaced sideways AND independently hue-rotated and saturated, creating densely layered color-shifted motion.',
    controls: [
      { label: 'Slice Count', param: 0, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Number of horizontal band slices' },
      { label: 'Displacement', param: 1, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'How far bands are shifted horizontally' },
      { label: 'Color Shift', param: 2, min: 0, max: 1, step: 0.01, default: 0.7, desc: 'Hue and saturation manipulation per slice' },
      { label: 'Scroll Speed', param: 3, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'How fast bands scroll vertically' },
    ] },
  { name: 'noisewipe',    src: FX_NOISEWIPE, group: 'bent',
    desc: 'Noise cascade wipe: a wall of structured noise rolls across the frame from top to bottom, dissolving everything behind it with colored static and channel corruption.',
    controls: [
      { label: 'Edge Width', param: 0, min: 0, max: 1, step: 0.01, default: 0.3, desc: 'How soft the transition edge of the wipe is' },
      { label: 'Noise Power', param: 1, min: 0, max: 1, step: 0.01, default: 0.8, desc: 'Intensity of the noise that replaces the image' },
      { label: 'Wipe Speed', param: 2, min: 0, max: 1, step: 0.01, default: 0.35, desc: 'How fast the noise wall moves down the frame' },
      { label: 'Grain Size', param: 3, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Noise grain scale — larger = blockier noise' },
    ] },
  { name: 'chromasmearplus', src: FX_CHROMASMEARPLUS, group: 'bent',
    desc: 'Chroma smear with vertical displacement: color bleeds horizontally across the entire scanline while the whole row is also displaced vertically — the characteristic look of a failing TBC in an analog video chain.',
    controls: [
      { label: 'Smear Width', param: 0, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'How far color bleeds horizontally across the scanline' },
      { label: 'Chroma Loss', param: 1, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'How much chroma information is lost vs preserved' },
      { label: 'Vert Shift', param: 2, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Per-row vertical displacement amount' },
    ] },
  { name: 'huespread',    src: FX_HUESPREAD, group: 'bent',
    desc: 'Horizontal hue gradients: each scanline gets a slightly different hue rotation, doing a random walk from the top of the frame. Neighboring lines have similar but not identical hues — like the color subcarrier phase has completely desynchronized.',
    controls: [
      { label: 'Spread Amount', param: 0, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'How far the hue random walk diverges from top to bottom' },
      { label: 'Drift', param: 1, min: 0, max: 1, step: 0.01, default: 0.4, desc: 'Time-based hue drift on top of the random walk' },
      { label: 'Saturation', param: 2, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'Saturation multiplier applied alongside the hue spread' },
    ] },
  { name: 'framerip',     src: FX_FRAMERIP, group: 'bent',
    desc: 'Frame buffer tearing: parts of the frame rip horizontally — one side shows the current frame, the other shows a displaced version, with jagged tearing boundaries that have color corruption. Multiple tears can happen simultaneously.',
    controls: [
      { label: 'Tear Count', param: 0, min: 0, max: 1, step: 0.01, default: 0.35, desc: 'How many simultaneous frame tears occur' },
      { label: 'Tear Strength', param: 1, min: 0, max: 1, step: 0.01, default: 0.6, desc: 'Width and displacement of each tear' },
      { label: 'Tear Speed', param: 2, min: 0, max: 1, step: 0.01, default: 0.5, desc: 'How fast the tearing positions change' },
    ] },
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
    this.programs.fitCover = program(gl, VERT, FX_FIT_COVER);
    this.programs.fitContain = program(gl, VERT, FX_FIT_CONTAIN);
    this.programs.fitTile = program(gl, VERT, FX_FIT_TILE);
    this.srcW = 1; this.srcH = 1;
    this._fitProg = this.programs.fitContain;
    this._fitAlignY = 0.0;
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
      const w = source.videoWidth || source.naturalWidth || source.width || 0;
      const h = source.videoHeight || source.naturalHeight || source.height || 0;
      if (w > 0 && h > 0) { this.srcW = w; this.srcH = h; }
    } catch (e) {
      // source not ready yet
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  setFitMode(mode, alignY, tileCols, tileRows){
    const map = { contain: 'fitContain', cover: 'fitCover', stretch: 'copy', tile: 'fitTile' };
    this._fitProg = this.programs[map[mode]] || this.programs.fitContain;
    this._fitAlignY = alignY != null ? alignY : 0.0;
    this._fitMode = mode;
    this._tileCols = tileCols != null ? tileCols : 4;
    this._tileRows = tileRows != null ? tileRows : 4;
  }

  // passes: array of { name, params: [p0..p3], intensity }
  render({ passes, time, seed, globalIntensity }){
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.bindVertexArray(this.vao);

    // pass 0: copy source -> fbA with selected fit mode
    let read = this.fbA, write = this.fbB;
    {
      const prog = this._fitProg;
      let fitParams;
      if (this._fitMode === 'tile') {
        fitParams = [this._tileCols, this._tileRows, 0, 0];
      } else {
        fitParams = [this._fitAlignY, 0, 0, 0];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, read.fb);
      gl.viewport(0, 0, read.w, read.h);
      gl.useProgram(prog);
      this._setCommon(prog, time, seed, globalIntensity, fitParams);
      gl.uniform2f(gl.getUniformLocation(prog, 'uSrcResolution'), this.srcW, this.srcH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.fbHistory.tex);
      gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'uPrev'), 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

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
    gl.uniform1f(u('uParam4'), params[4]||0);
    gl.uniform1f(u('uParam5'), params[5]||0);
  }
}
