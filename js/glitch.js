// Chaos engine. Maintains a small stack of currently-active effects, swaps
// them in/out on a Poisson-ish timer, and occasionally fires "burst" events
// (1–3 frames of extreme parameters).

import { EFFECTS } from './shaders.js';

// Mulberry32 deterministic PRNG so a seed reproduces the chaos sequence
function makeRng(seed){
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseSeed(str){
  if (!str) return Math.floor(Math.random()*0xffffffff);
  const t = str.trim();
  if (/^0x/i.test(t)) return parseInt(t, 16) >>> 0;
  if (/^\d+$/.test(t)) return parseInt(t, 10) >>> 0;
  // hash string
  let h = 2166136261 >>> 0;
  for (let i=0;i<t.length;i++){ h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class ChaosEngine {
  constructor({ seed = 0xCAFEBABE, maxActive = 3, chaosRate = 0.5 } = {}){
    this.setSeed(seed);
    this.maxActive = maxActive;
    this.chaosRate = chaosRate;
    this.active = []; // {name, params:[], intensity, born, life, fadeIn, fadeOut}
    this.lastSwap = 0;
    this.burstUntil = 0;
    this.burstName = null;
    this.locked = false;
    this.lockedPasses = null;
    this.effectConfig = new Map(EFFECTS.map(fx => [fx.name, {
      enabled: true,
      weight: 1,
      amount: 1,
    }]));
  }

  setSeed(seed){
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    this.active = [];
    this.lastSwap = 0;
    this.burstUntil = 0;
  }

  setMaxActive(n){ this.maxActive = Math.max(1, Math.min(10, n|0)); }
  setChaosRate(r){ this.chaosRate = Math.max(0, Math.min(1, r)); }
  setLocked(locked, time = 0){
    this.locked = !!locked;
    if (this.locked){
      this.lockedPasses = this._computePasses(time);
    } else {
      this.lockedPasses = null;
    }
  }
  setEffectConfig(name, cfg = {}){
    const prev = this.effectConfig.get(name) || { enabled: true, weight: 1, amount: 1 };
    const next = {
      enabled: cfg.enabled ?? prev.enabled,
      weight: Math.max(0, cfg.weight ?? prev.weight),
      amount: Math.max(0, cfg.amount ?? prev.amount),
    };
    this.effectConfig.set(name, next);
    if (!next.enabled) {
      // Drop already-running instances immediately when an effect is untoggled.
      this.active = this.active.filter(e => e.name !== name);
      if (this.burstName === name) this.burstName = null;
    }
  }

  _enabledEffects(){
    const list = [];
    for (const fx of EFFECTS){
      const cfg = this.effectConfig.get(fx.name);
      if (!cfg || !cfg.enabled || cfg.weight <= 0) continue;
      list.push({ fx, cfg });
    }
    return list;
  }

  _pickWeighted(enabled){
    let total = 0;
    for (const e of enabled) total += e.cfg.weight;
    if (total <= 0) return enabled[Math.floor(this.rng() * enabled.length)];
    let r = this.rng() * total;
    for (const e of enabled){
      r -= e.cfg.weight;
      if (r <= 0) return e;
    }
    return enabled[enabled.length - 1];
  }

  _newEffect(time){
    const enabled = this._enabledEffects();
    if (!enabled.length) return null;
    const choice = this._pickWeighted(enabled);
    const fx = choice.fx;
    const cfg = choice.cfg;
    const life = 0.8 + this.rng()*5.0;
    return {
      name: fx.name,
      params: [this.rng(), this.rng(), this.rng(), this.rng()],
      intensity: (0.4 + this.rng()*0.6) * cfg.amount,
      born: time,
      life,
      fadeIn: 0.2 + this.rng()*0.4,
      fadeOut: 0.3 + this.rng()*0.6,
    };
  }

  update(time){
    if (this.locked) return;

    // Remove effects that got disabled via UI while they were already active.
    this.active = this.active.filter(e => {
      const cfg = this.effectConfig.get(e.name);
      return cfg && cfg.enabled;
    });

    // expire
    this.active = this.active.filter(e => time - e.born < e.life);

    // fill
    while (this.active.length < this.maxActive){
      const next = this._newEffect(time);
      if (!next) break;
      this.active.push(next);
    }

    // swap-in jitter on chaos timer
    const swapInterval = Math.max(0.15, 1.5 - this.chaosRate*1.4);
    if (time - this.lastSwap > swapInterval) {
      this.lastSwap = time;
      if (this.rng() < 0.3 + this.chaosRate*0.5 && this.active.length){
        // kill a random one early; fill on next tick
        const idx = Math.floor(this.rng()*this.active.length);
        this.active.splice(idx, 1);
      }
      // mutate a random param of a random effect
      if (this.active.length){
        const e = this.active[Math.floor(this.rng()*this.active.length)];
        e.params[Math.floor(this.rng()*4)] = this.rng();
      }
    }

    // bursts: brief extreme override
    if (time > this.burstUntil && this.rng() < 0.003 + this.chaosRate*0.02){
      this.burstUntil = time + 0.05 + this.rng()*0.25;
      const burstChoices = ['strobe','color','jpegblocks','datamosh','band','rgb_split','feedback'];
      const availableBurst = burstChoices.filter(name => {
        const cfg = this.effectConfig.get(name);
        return cfg && cfg.enabled;
      });
      this.burstName = availableBurst.length
        ? availableBurst[Math.floor(this.rng() * availableBurst.length)]
        : null;
    }
  }

  _computePasses(time){
    const out = [];
    for (const e of this.active){
      const age = time - e.born;
      const remain = e.life - age;
      let env = 1.0;
      if (age < e.fadeIn) env = age / e.fadeIn;
      else if (remain < e.fadeOut) env = Math.max(0, remain / e.fadeOut);
      out.push({ name: e.name, params: e.params, intensity: e.intensity * env });
    }
    if (time < this.burstUntil && this.burstName){
      out.push({ name: this.burstName, params: [this.rng(), this.rng(), this.rng(), this.rng()], intensity: 1.0 });
    }
    return out;
  }

  passes(time){
    if (this.locked) return this.lockedPasses || [];
    return this._computePasses(time);
  }

  describe(){
    return this.active.map(e => e.name).join(' › ');
  }
}
