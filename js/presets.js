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

// URL hash encode / decode (no name included — just the params)
export function stateToHash(state) {
  const { savedAt, ...rest } = state;
  return '#p=' + btoa(unescape(encodeURIComponent(JSON.stringify(rest))));
}

export function stateFromHash(hash = window.location.hash) {
  if (!hash.startsWith('#p=')) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(hash.slice(3))))); }
  catch { return null; }
}
