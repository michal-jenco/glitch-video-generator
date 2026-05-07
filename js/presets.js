// Preset system: save/load named configs to localStorage + URL-hash sharing.
// A preset captures all the knobs: seed, intensity, chaosRate, maxFx, per-effect config.

import { EFFECTS } from './shaders.js';

const STORAGE_KEY = 'glitch_presets_v1';
const FX_NAMES = EFFECTS.map(fx => fx.name);
const FX_INDEX = new Map(FX_NAMES.map((n, i) => [n, i]));
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

export function listPresets() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

export function savePreset(name, data) {
  const all = listPresets();
  all[name] = { ...data, savedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function deletePreset(name) {
  const all = listPresets();
  delete all[name];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

// Serialise state into a plain object
export function captureState({ seed, intensity, chaosRate, maxFx, effectConfig, source, proceduralPattern, chainLocked, webcamFacing, gifDuration, lockedPasses }) {
  return {
    seed,
    intensity: +intensity,
    chaosRate: +chaosRate,
    maxFx: +maxFx,
    source,
    proceduralPattern,
    chainLocked: !!chainLocked,
    webcamFacing: webcamFacing || 'user',
    gifDuration: +gifDuration || 3,
    lockedPasses: chainLocked ? (lockedPasses || null) : null,
    effects: [...effectConfig.entries()].map(([name, cfg]) => ({ name, ...cfg })),
  };
}

// Compact state for URL hash. Short keys, effect-name → index, drop defaults,
// round floats. Bumps schema to v2; v1 (verbose) still decodes for old links.
function compactState(state) {
  const out = { v: 2, s: state.seed };
  if (state.intensity != null) out.i = r2(+state.intensity);
  if (state.chaosRate != null) out.c = r2(+state.chaosRate);
  if (state.maxFx != null) out.m = +state.maxFx;
  if (state.source && state.source !== 'webcam') out.src = state.source;
  if (state.source === 'procedural' && state.proceduralPattern) out.p = state.proceduralPattern;
  if (state.chainLocked) out.cl = 1;
  if (state.webcamFacing === 'environment') out.wf = 'e';
  if (state.gifDuration && +state.gifDuration !== 3) out.gd = +state.gifDuration;

  // Effects: emit only those differing from defaults (enabled, amt=1, wgt=1).
  // Tuple [idx, enabled, amount, weight] with trailing defaults trimmed.
  const fx = [];
  for (const e of state.effects || []) {
    const idx = FX_INDEX.get(e.name);
    if (idx == null) continue;
    const en = e.enabled ? 1 : 0;
    const a = r2(+e.amount);
    const w = r2(+e.weight);
    if (en === 1 && a === 1 && w === 1) continue;
    const t = [idx, en, a, w];
    while (t.length > 2 && t[t.length - 1] === 1) t.pop();
    fx.push(t);
  }
  if (fx.length) out.fx = fx;

  if (state.chainLocked && state.lockedPasses?.length) {
    out.lp = state.lockedPasses.map(p => {
      const idx = FX_INDEX.get(p.name) ?? 0;
      const [a, b, c, d] = p.params || [0, 0, 0, 0];
      return [idx, r3(a), r3(b), r3(c), r3(d),
              r3(p.intensity), r3(p.born), r3(p.life), r3(p.fadeIn), r3(p.fadeOut)];
    });
  }
  return out;
}

function expandState(c) {
  const state = {
    seed: c.s,
    intensity: c.i ?? 1,
    chaosRate: c.c ?? 0.5,
    maxFx: c.m ?? 4,
    source: c.src ?? 'webcam',
    proceduralPattern: c.p,
    chainLocked: !!c.cl,
    webcamFacing: c.wf === 'e' ? 'environment' : 'user',
    gifDuration: c.gd ?? 3,
    effects: FX_NAMES.map(name => ({ name, enabled: true, amount: 1, weight: 1 })),
  };
  for (const t of c.fx || []) {
    const [idx, en = 1, a = 1, w = 1] = t;
    const e = state.effects[idx];
    if (e) { e.enabled = !!en; e.amount = a; e.weight = w; }
  }
  if (c.lp) {
    state.lockedPasses = c.lp.map(arr => {
      const [idx, p0, p1, p2, p3, intensity, born, life, fadeIn, fadeOut] = arr;
      return {
        name: FX_NAMES[idx],
        params: [p0, p1, p2, p3],
        intensity, born, life, fadeIn, fadeOut,
      };
    });
  }
  return state;
}

// URL hash encode / decode — URL-safe base64 (no +/= in the hash)
export function stateToHash(state) {
  const { savedAt, ...rest } = state;
  const compact = compactState(rest);
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(compact))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return '#p=' + b64;
}

export function stateFromHash(hash = window.location.hash) {
  if (!hash.startsWith('#p=')) return null;
  try {
    // Instagram's in-app browser appends ?igsh=... after the hash, which
    // corrupts the base64. Take only the leading run of base64-url chars.
    const payload = hash.slice(3).match(/^[A-Za-z0-9_\-]+/)?.[0] ?? '';
    if (!payload) return null;
    let b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const obj = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return obj && obj.v === 2 ? expandState(obj) : obj;
  } catch { return null; }
}
