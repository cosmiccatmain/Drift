// ─────────────────────────────────────────────────────────────────────────────
//  DRIFT ENGINE — an on-device recommender
//
//  Pipeline per slot:   candidates → score → diversify (MMR) → pace → serve
//
//  1. Taste model   Every feature of a clip (scene, palette, tempo, density, creator)
//                   holds a Beta(α,β) posterior of "does this person engage with it".
//                   Long-term memory, slowly forgetting (interests drift).
//  2. Session model A fast EMA over the last few clips ("what am I into right now").
//  3. Thompson      We *sample* from each posterior instead of taking the mean, so
//     sampling      uncertain features get tried naturally (explore) and proven ones
//                   win most draws (exploit). Plus a UCB bonus for unseen territory.
//  4. Implicit      Reward comes from behaviour, not buttons: dwell vs loop length,
//     reward        touches, replays, likes, shares, fast skips, "less like this".
//  5. MMR           Greedy re-rank: relevance minus similarity to what you just saw
//                   and what we already picked → no boring runs.
//  6. Pacing        Energy curve (build → release), skip-streak "rescue" mode,
//                   engaged-streak "stretch" mode, and variable-ratio Golden clips.
// ─────────────────────────────────────────────────────────────────────────────

import { mulberry32 } from './content.js';

export const FEATURE_WEIGHTS = { scene: 0.34, palette: 0.24, creator: 0.2, tempo: 0.12, density: 0.1 };
const PRIOR = 1.2;
const FORGET = 0.985;       // per-observation decay of old evidence toward the prior
const SESSION_LR = 0.35;
const RECENT_N = 8;
const TASTE_GAIN = 4.4;     // taste dominates once we know you...
const SESSION_GAIN = 1.6;   // ...and what you're into right now matters too

export const featuresOf = (it) => ({
  scene: 'scene:' + it.scene,
  palette: 'palette:' + it.palette,
  creator: 'creator:' + it.creator,
  tempo: 'tempo:' + it.tempo,
  density: 'density:' + it.density,
});

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// ── Implicit-feedback reward ────────────────────────────────────────────────
// signals: { dwell (s), interactions, liked, shared, replayed, disliked }
export function reward(sig, it) {
  const ratio = sig.dwell / it.loop;
  if (sig.disliked) return { r: 0, w: 2.0, kind: 'dislike' };
  if (sig.dwell < 1.0 && !sig.liked) return { r: 0, w: 1.0, kind: 'skip' };
  let r = 0.5 * (1 - Math.exp(-ratio * 1.4));      // saturating watch-time, up to .5
  r += Math.min(sig.interactions, 6) * 0.05;       // touching = loving, up to .3
  if (sig.liked) r += 0.35;
  if (sig.shared) r += 0.25;
  if (sig.replayed) r += 0.15;
  if (ratio > 1.6) r += 0.1;                       // watched past a full loop
  return { r: clamp(r), w: 0.7 + Math.min(ratio, 2) * 0.3, kind: r > 0.55 ? 'love' : 'ok' };
}

// ── Sampling helpers ────────────────────────────────────────────────────────
function randn(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const betaMean = (p) => p.a / (p.a + p.b);
const betaSd = (p) => Math.sqrt((p.a * p.b) / ((p.a + p.b) ** 2 * (p.a + p.b + 1)));
// Normal approximation of a Beta draw: cheap, and good once a+b > ~4.
const betaSample = (p, rng) => clamp(betaMean(p) + betaSd(p) * randn(rng));

// ── Similarity between clips (used by diversity re-ranking) ──────────────────
function sim(a, b) {
  let s = 0;
  if (a.scene === b.scene) s += FEATURE_WEIGHTS.scene;
  if (a.palette === b.palette) s += FEATURE_WEIGHTS.palette;
  if (a.creator === b.creator) s += FEATURE_WEIGHTS.creator;
  if (a.tempo === b.tempo) s += FEATURE_WEIGHTS.tempo;
  if (a.density === b.density) s += FEATURE_WEIGHTS.density;
  return s;
}

export class DriftEngine {
  constructor(catalog, saved = null, seed = Date.now() >>> 0) {
    this.catalog = catalog;
    this.rng = mulberry32(seed);
    this.post = {};        // key -> {a,b,n}
    this.session = {};     // key -> EMA of (reward - 0.5)
    this.seen = new Set(); // ids shown ever (persisted, capped)
    this.recent = [];      // last shown items (objects), newest last
    this.obs = 0;          // total observations
    this.skipStreak = 0;
    this.loveStreak = 0;
    this.sinceGolden = 4;
    this.lastEnergyDir = 1;
    this.maxLikes = Math.max(...catalog.map((c) => c.likes));
    this.byId = new Map(catalog.map((c) => [c.id, c]));
    if (saved) this.load(saved);
  }

  // ── persistence ───────────────────────────────────────────────────────────
  serialize() {
    return { v: 1, post: this.post, obs: this.obs, seen: [...this.seen].slice(-500) };
  }
  load(s) {
    if (!s || s.v !== 1) return;
    this.post = s.post || {};
    this.obs = s.obs || 0;
    this.seen = new Set(s.seen || []);
  }
  reset() {
    this.post = {}; this.session = {}; this.seen.clear(); this.recent = [];
    this.obs = 0; this.skipStreak = 0; this.loveStreak = 0; this.sinceGolden = 4;
  }

  _p(key) { return (this.post[key] ||= { a: PRIOR, b: PRIOR, n: 0 }); }
  _peek(key) { return this.post[key] || { a: PRIOR, b: PRIOR, n: 0 }; }

  // ── learning ──────────────────────────────────────────────────────────────
  observe(item, sig) {
    const { r, w, kind } = reward(sig, item);
    // forgetting: every posterior drifts back toward the prior a little
    for (const k in this.post) {
      const p = this.post[k];
      p.a = PRIOR + (p.a - PRIOR) * FORGET;
      p.b = PRIOR + (p.b - PRIOR) * FORGET;
    }
    const f = featuresOf(item);
    for (const dim in f) {
      const k = f[dim];
      const p = this._p(k);
      p.a += r * w; p.b += (1 - r) * w; p.n++;
      this.session[k] = (this.session[k] || 0) * (1 - SESSION_LR) + (r - 0.5) * SESSION_LR;
    }
    // session values fade too, so a tangent doesn't stick around
    for (const k in this.session) this.session[k] *= 0.97;

    this.obs++;
    this.seen.add(item.id);
    if (kind === 'skip' || kind === 'dislike') { this.skipStreak++; this.loveStreak = 0; }
    else { this.skipStreak = 0; this.loveStreak = r > 0.5 ? this.loveStreak + 1 : 0; }
    return { r, kind };
  }

  // ── scoring ───────────────────────────────────────────────────────────────
  // Returns the score plus a decomposition used by the "Why this?" explainer.
  _score(it, exploreCoef, mode) {
    const f = featuresOf(it);
    let taste = 0, sess = 0, ucb = 0;
    const contrib = [];
    for (const dim in f) {
      const k = f[dim], w = FEATURE_WEIGHTS[dim];
      const p = this._peek(k);
      const th = betaSample(p, this.rng);
      taste += w * th;
      const s = (this.session[k] || 0) * w;
      sess += s;
      ucb += w * betaSd(p) * 2.2 * exploreCoef;
      contrib.push({ key: k, dim, mean: betaMean(p), sd: betaSd(p), n: p.n, lift: w * (betaMean(p) - 0.5) + s });
    }
    const coldFactor = 1 / (1 + this.obs / 18);
    const pop = (Math.log(1 + it.likes) / Math.log(1 + this.maxLikes)) * 0.18 * coldFactor;
    const novelty = this.seen.has(it.id) ? -1.5 : 0.04;
    let fatigue = 0;
    const last4 = this.recent.slice(-4), last6 = this.recent.slice(-6);
    for (const r of last4) if (r.scene === it.scene) fatigue += 0.06;
    for (const r of last6) if (r.creator === it.creator) fatigue += 0.07;
    if (last4.length && last4[last4.length - 1].palette === it.palette) fatigue += 0.05;

    const score = TASTE_GAIN * taste + SESSION_GAIN * sess + ucb + pop + novelty - fatigue;
    return { score, taste, sess, ucb, pop, fatigue, contrib };
  }

  // Energy target: a slow wave (build → release) shifted by how the person is doing.
  _targetEnergy() {
    const t = this.recent.length;
    let e = 0.5 + 0.28 * Math.sin(t * 0.9);
    if (this.skipStreak >= 2) e -= 0.15; // they're bouncing: calm down, de-risk
    if (this.loveStreak >= 4) e += 0.1;  // they're locked in: raise the stakes
    return clamp(e);
  }

  // Choose the next n clips (not already in `queued`).
  next(n = 1, queued = new Set()) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const it = this._pickOne(queued, out);
      if (!it) break;
      out.push(it);
      queued.add(it.id);
    }
    return out;
  }

  _pickOne(queued, alsoPicked) {
    const exploreCoef = Math.max(0.15, 1 / (1 + this.obs / 25));
    const history = [...this.recent, ...alsoPicked];
    // Mode selection
    let mode = 'exploit';
    const r = this.rng();
    const wantGolden = this.sinceGolden >= 8 && r < 0.3;
    if (this.obs < 7) mode = 'probe';
    else if (this.skipStreak >= 2) mode = 'rescue';
    else if (this.loveStreak >= 4 && r < 0.4) mode = 'stretch';
    else if (r < 0.18) mode = 'explore';

    // 1) Candidate generation: a random slate (cheap, unbiased) of 90 unseen-first clips
    const pool = [];
    for (const it of this.catalog) if (!queued.has(it.id)) pool.push(it);
    if (!pool.length) return null;
    const unseen = pool.filter((c) => !this.seen.has(c.id));
    const base = unseen.length > 40 ? unseen : pool;
    const slate = [];
    const take = Math.min(90, base.length);
    const used = new Set();
    while (slate.length < take) {
      const c = base[(this.rng() * base.length) | 0];
      if (!used.has(c.id)) { used.add(c.id); slate.push(c); }
    }

    // 2) Score
    const eCoef = mode === 'explore' || mode === 'probe' ? exploreCoef * 2.2 : mode === 'rescue' ? 0.05 : exploreCoef;
    const target = this._targetEnergy();
    let scored = slate.map((it) => {
      const s = this._score(it, eCoef, mode);
      s.score += 0.1 * (1 - Math.abs(it.energy - target)); // pacing
      if (mode === 'rescue') s.score += 1.0 * s.taste;      // lean hard on proven taste
      if (mode === 'stretch') {
        // adjacent but not identical: shares a liked creator/palette, different scene
        const top = this._topKeys(4);
        const f = featuresOf(it);
        const shares = Object.values(f).filter((k) => top.has(k)).length;
        if (shares >= 1 && !top.has(f.scene)) s.score += 0.25;
      }
      if (it.golden) s.score += wantGolden ? 0.6 : -0.3; // golden clips are rare on purpose
      return { it, s };
    });

    // cold start: the very first clip is a proven crowd-pleaser (the hook)
    if (this.obs === 0 && this.recent.length === 0 && alsoPicked.length === 0) {
      scored.sort((a, b) => b.it.likes - a.it.likes);
      scored = scored.slice(0, 6);
      const c = scored[(this.rng() * 3) | 0];
      return this._commit(c.it, c.s, 'probe');
    }

    // 3) MMR diversification — greedy over the top 24
    scored.sort((a, b) => b.s.score - a.s.score);
    let top = scored.slice(0, 24);
    const lambda = mode === 'rescue' ? 0.94 : mode === 'explore' || mode === 'probe' ? 0.64 : 0.85;
    let best = null, bestV = -Infinity;
    for (const c of top) {
      let maxSim = 0;
      for (const h of history.slice(-RECENT_N)) maxSim = Math.max(maxSim, sim(c.it, h));
      // hard rule: never 3 of the same scene in a row
      const h2 = history.slice(-2);
      if (h2.length === 2 && h2.every((h) => h.scene === c.it.scene)) continue;
      const v = lambda * c.s.score - (1 - lambda) * maxSim;
      if (v > bestV) { bestV = v; best = c; }
    }
    best ||= top[0];
    let finalMode = mode;
    if (best.it.golden) finalMode = 'golden';
    return this._commit(best.it, best.s, finalMode);
  }

  _topKeys(n) {
    return new Set(
      Object.entries(this.post)
        .filter(([, p]) => p.n >= 2)
        .sort((a, b) => betaMean(b[1]) - betaMean(a[1]))
        .slice(0, n)
        .map(([k]) => k)
    );
  }

  _commit(it, s, mode) {
    this.recent.push(it);
    if (this.recent.length > 24) this.recent.shift();
    this.sinceGolden = it.golden ? 0 : this.sinceGolden + 1;
    // Explanation payload
    const seeking = mode === 'explore' || mode === 'probe';
    let pool = s.contrib.filter((c) => (seeking ? true : c.n > 0));
    if (!seeking) { const pos = pool.filter((c) => c.mean >= 0.5); if (pos.length) pool = pos; }
    // matches → strongest positive lift first; exploration → most uncertain (most to learn) first
    pool.sort((a, b) => (seeking ? b.sd - a.sd : b.lift - a.lift));
    const reasons = pool
      .slice(0, 3)
      .map((c) => ({ key: c.key, dim: c.dim, mean: c.mean, n: c.n, sd: c.sd, lift: c.lift }));
    it.meta = { mode, reasons, score: s.score, ucb: s.ucb, sess: s.sess };
    return it;
  }

  // ── introspection for the UI ──────────────────────────────────────────────
  profile() {
    const groups = { scene: [], palette: [], tempo: [], creator: [], density: [] };
    for (const [k, p] of Object.entries(this.post)) {
      const [dim, val] = k.split(':');
      if (!groups[dim] || p.n < 2) continue;
      groups[dim].push({ val, mean: betaMean(p), sd: betaSd(p), n: p.n, key: k });
    }
    for (const g in groups) groups[g].sort((a, b) => b.mean - a.mean);
    // "How well do we know you": 1 - normalized uncertainty on scene+palette posteriors
    const dims = Object.entries(this.post).filter(([k]) => k.startsWith('scene:') || k.startsWith('palette:'));
    const nominal = betaSd({ a: PRIOR, b: PRIOR });
    let conf = 0;
    if (dims.length) {
      const avgSd = dims.reduce((s, [, p]) => s + betaSd(p), 0) / dims.length;
      conf = Math.pow(clamp(1 - avgSd / nominal), 0.7) * Math.min(1, this.obs / 22);
    }
    return { groups, confidence: conf, obs: this.obs };
  }
}

export const MODE_LABEL = {
  probe: 'Calibrating',
  exploit: 'In your lane',
  explore: 'Exploring',
  rescue: 'Course correct',
  stretch: 'Stretch pick',
  golden: 'Golden clip',
};
