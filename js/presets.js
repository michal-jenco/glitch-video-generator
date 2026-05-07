// Preset system: save/load named configs to localStorage + URL-hash sharing.
// A preset captures all the knobs: seed, intensity, chaosRate, maxFx, per-effect config.

const STORAGE_KEY = 'glitch_presets_v1';

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
export function captureState({ seed, intensity, chaosRate, maxFx, effectConfig, source, proceduralPattern, chainLocked, webcamFacing, gifDuration }) {
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
    effects: [...effectConfig.entries()].map(([name, cfg]) => ({ name, ...cfg })),
  };
}

// URL hash encode / decode — URL-safe base64 (no +/= in the hash)
export function stateToHash(state) {
  const { savedAt, ...rest } = state;
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(rest))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return '#p=' + b64;
}

export function stateFromHash(hash = window.location.hash) {
  if (!hash.startsWith('#p=')) return null;
  try {
    let b64 = hash.slice(3).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch { return null; }
}
