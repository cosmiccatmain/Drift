// Tiny WebAudio synth: everything you touch is in key, so it always sounds good.
let ctx = null, master = null, wet = null, muted = false;
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // major pentatonic over 2+ octaves

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp); comp.connect(ctx.destination);
  // cheap "space": feedback delay
  const d = ctx.createDelay(1); d.delayTime.value = 0.23;
  const fb = ctx.createGain(); fb.gain.value = 0.32;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  wet = ctx.createGain(); wet.gain.value = 0.35;
  wet.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(master);
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.03);
}
export const isMuted = () => muted;

let rootHz = 220;
export function setKey(semi) { rootHz = 196 * Math.pow(2, semi / 12); }

export function note(i, { type = 'sine', gain = 0.22, dur = 0.5, detune = 0, pan = 0 } = {}) {
  if (!ctx || muted) return;
  const idx = ((i % SCALE.length) + SCALE.length) % SCALE.length;
  const f = rootHz * Math.pow(2, SCALE[idx] / 12);
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = g;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); out = p; }
  o.connect(g); out.connect(master); out.connect(wet);
  o.start(t); o.stop(t + dur + 0.05);
}

export function pop(i = 0, pan = 0) {
  if (!ctx || muted) return;
  note(i + 5, { type: 'triangle', gain: 0.2, dur: 0.35, pan });
  // tiny noise click for the "pop" texture
  const t = ctx.currentTime;
  const b = ctx.createBuffer(1, 1200, ctx.sampleRate), d = b.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length) ** 3;
  const s = ctx.createBufferSource(); s.buffer = b;
  const g = ctx.createGain(); g.gain.value = 0.18;
  s.connect(g); g.connect(master); s.start(t);
}

export function like() {
  if (!ctx || muted) return;
  [0, 2, 4, 7].forEach((n, k) => setTimeout(() => note(n + 4, { type: 'sine', gain: 0.18, dur: 0.6 }), k * 55));
}
export function tick() { note(7, { type: 'square', gain: 0.03, dur: 0.05 }); }
export function whoosh() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.22);
}
export function golden() {
  if (!ctx || muted) return;
  [0, 4, 7, 9, 12].forEach((n, k) => setTimeout(() => note(n + 3, { type: 'triangle', gain: 0.16, dur: 0.9 }), k * 70));
}
