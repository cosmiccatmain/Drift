// Seven generative, touch-reactive scenes. Each is a tiny physics/art sim.
// API:  createScene(item, canvas, W, H, dpr) -> { step(dt), pointer(kind,x,y), warm(n), active, destroy() }
import { mulberry32, PALETTES } from './content.js';
import * as A from './audio.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function makeBase(item, canvas, W, H, dpr) {
  const ctx = canvas.getContext('2d');
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pal = PALETTES[item.palette];
  const rgb = pal.map(hex);
  const b = {
    ctx, W, H, rng: mulberry32(item.seed), pal, rgb,
    tempo: { slow: 0.65, mid: 1, fast: 1.5 }[item.tempo],
    dens: item.density === 'dense' ? 1.35 : 0.7,
    scale: Math.max(0.7, Math.min(1.3, W / 390)),
    active: false,
    sfx(fn) { if (b.active) fn(); },
  };
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgba(rgb[0], 1));
  g.addColorStop(1, rgba(mix(rgb[0], rgb[1], 0.16), 1));
  b.bg = g;
  return b;
}

// ═══════════════ 1. CHAIN POP ═══════════════
function popScene(b) {
  const { ctx, rng, rgb, tempo, dens, W, H, scale } = b;
  const orbs = [], rings = [], parts = [];
  let t = 0, auto = 0.5;
  const mk = (y) => {
    const r = (14 + rng() * 30) * scale;
    return { x: r + rng() * (W - 2 * r), y, r, ph: rng() * TAU, vy: -(16 + rng() * 26) * tempo * scale, c: 1 + ((rng() * 3) | 0), at: -1, wake: 0, grow: 1 };
  };
  const N = Math.round(24 * dens);
  for (let i = 0; i < N; i++) orbs.push(mk(H * 0.08 + rng() * H * 0.95));

  const trig = (o, delay) => { if (o.at < 0 && o.wake <= 0) o.at = t + delay; };
  const popO = (o) => {
    o.at = -1; o.wake = 0.5 + rng() * 0.9;
    rings.push({ x: o.x, y: o.y, r: o.r, age: 0, c: o.c });
    for (let k = 0; k < 10; k++) parts.push({ x: o.x, y: o.y, a: rng() * TAU, s: (40 + rng() * 150) * scale, age: 0, life: 0.5 + rng() * 0.5, c: o.c });
    b.sfx(() => A.pop(Math.floor((o.x / W) * 8), (o.x / W) * 2 - 1));
    for (const q of orbs) {
      if (q === o || q.at >= 0 || q.wake > 0) continue;
      const d = Math.hypot(q.x - o.x, q.y - o.y);
      if (d < (o.r + q.r) * 1.35 + 22 * scale && rng() < 0.88) trig(q, 0.07 + d / (700 * scale));
    }
  };
  const hit = (x, y, spawnRing) => {
    let best = null, bd = 1e9;
    for (const o of orbs) {
      if (o.wake > 0) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < o.r + 14 && d < bd) { bd = d; best = o; }
    }
    if (best) { trig(best, 0); return true; }
    if (spawnRing) {
      rings.push({ x, y, r: 6, age: 0, c: 2 });
      for (const o of orbs) { const d = Math.hypot(o.x - x, o.y - y); if (d < 140 * scale && o.wake <= 0) { o.x += ((o.x - x) / (d + 1)) * 16; o.y += ((o.y - y) / (d + 1)) * 16; } }
      b.sfx(() => A.note(3 + ((x / W) * 5 | 0), { type: 'sine', gain: 0.12, dur: 0.4 }));
    }
    return false;
  };

  return {
    step(dt) {
      t += dt;
      auto -= dt;
      if (auto < 0) {
        auto = (0.9 + rng() * 1.1) / tempo;
        const vis = orbs.filter((o) => o.wake <= 0 && o.y > 40 && o.y < H - 40);
        if (vis.length) trig(vis[(rng() * vis.length) | 0], 0);
      }
      for (const o of orbs) {
        if (o.wake > 0) {
          o.wake -= dt;
          if (o.wake <= 0) { o.y = H * (0.12 + rng() * 0.82); o.x = o.r + rng() * (W - 2 * o.r); o.grow = 0; }
          continue;
        }
        if (o.grow < 1) o.grow = Math.min(1, o.grow + dt * 2.2);
        o.y += o.vy * dt;
        o.x += Math.sin(o.ph + t * 1.3) * 9 * dt * scale;
        if (o.y < -o.r * 2) { o.y = H + o.r; o.x = o.r + rng() * (W - 2 * o.r); }
        if (o.at >= 0 && t >= o.at) popO(o);
      }
      // draw
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = b.bg; ctx.fillRect(0, 0, W, H);
      for (const o of orbs) {
        if (o.wake > 0) continue;
        const c = rgb[o.c], pend = o.at >= 0;
        const sq = pend ? 1 + Math.sin((t - (o.at - 0.3)) * 40) * 0.05 : 1;
        const r = o.r * sq * (1 - (1 - o.grow) ** 3);
        if (r < 0.5) continue;
        const g = ctx.createRadialGradient(o.x - r * 0.35, o.y - r * 0.4, r * 0.1, o.x, o.y, r);
        g.addColorStop(0, rgba(mix(c, rgb[4], 0.65), 0.95));
        g.addColorStop(0.55, rgba(c, 0.55));
        g.addColorStop(1, rgba(c, pend ? 0.55 : 0.2));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(rgb[4], pend ? 0.9 : 0.3); ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = rings.length - 1; i >= 0; i--) {
        const g = rings[i]; g.age += dt;
        if (g.age > 0.55) { rings.splice(i, 1); continue; }
        const k = g.age / 0.55;
        ctx.strokeStyle = rgba(rgb[g.c], (1 - k) * 0.9);
        ctx.lineWidth = 3 * (1 - k) + 0.5;
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r + k * 70 * scale, 0, TAU); ctx.stroke();
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.age += dt;
        if (p.age > p.life) { parts.splice(i, 1); continue; }
        p.x += Math.cos(p.a) * p.s * dt; p.y += Math.sin(p.a) * p.s * dt + 30 * dt; p.s *= 0.96;
        ctx.fillStyle = rgba(rgb[p.c], 1 - p.age / p.life);
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4 * scale, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    pointer(kind, x, y) { if (kind === 'down') hit(x, y, true); else if (kind === 'move') hit(x, y, false); },
  };
}

// ═══════════════ 2. FLOW FIELD ═══════════════
function flowScene(b) {
  const { ctx, rng, rgb, tempo, dens, W, H, scale } = b;
  const N = Math.round(560 * dens);
  const X = new Float32Array(N), Y = new Float32Array(N), L = new Float32Array(N), C = new Uint8Array(N), S = new Float32Array(N);
  const respawn = (i) => { X[i] = rng() * W; Y[i] = rng() * H; L[i] = 2 + rng() * 5; };
  for (let i = 0; i < N; i++) { respawn(i); C[i] = 1 + (i % 3); S[i] = 0.7 + rng() * 0.8; }
  const bg = rgb[0];
  ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, W, H);
  let t = rng() * 50;
  const ptr = { x: 0, y: 0, down: false, on: false };
  const R = 150 * scale;
  const ang = (x, y) => (Math.sin(x * 0.0036 + t * 0.2) + Math.cos(y * 0.0044 - t * 0.17) + Math.sin((x * 0.6 + y) * 0.0023 + t * 0.1)) * 2.1;

  return {
    step(dt) {
      t += dt * tempo;
      ctx.fillStyle = rgba(bg, 0.085); ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1.4 * scale; ctx.lineCap = 'round';
      for (let c = 1; c <= 3; c++) {
        ctx.strokeStyle = rgba(rgb[c], 0.6);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          if (C[i] !== c) continue;
          const x0 = X[i], y0 = Y[i];
          const a = ang(x0, y0);
          const sp = (48 + S[i] * 34) * scale * tempo;
          let vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
          if (ptr.on) {
            const dx = x0 - ptr.x, dy = y0 - ptr.y, d = Math.hypot(dx, dy);
            if (d < R) {
              const k = 1 - d / R, f = (ptr.down ? 360 : 170) * k * scale;
              vx += (-dy / (d + 1)) * f - (dx / (d + 1)) * f * 0.35;
              vy += (dx / (d + 1)) * f - (dy / (d + 1)) * f * 0.35;
            }
          }
          const x1 = x0 + vx * dt, y1 = y0 + vy * dt;
          ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
          X[i] = x1; Y[i] = y1; L[i] -= dt;
          if (L[i] < 0 || x1 < -10 || x1 > W + 10 || y1 < -10 || y1 > H + 10) respawn(i);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    pointer(kind, x, y) {
      if (kind === 'down') {
        ptr.down = true; ptr.on = true; ptr.x = x; ptr.y = y;
        for (let k = 0; k < 90; k++) { const i = (rng() * N) | 0; X[i] = x + (rng() - 0.5) * 30; Y[i] = y + (rng() - 0.5) * 30; L[i] = 3; }
        b.sfx(() => A.note(2 + ((x / W) * 6 | 0), { type: 'sine', gain: 0.1, dur: 1.2 }));
      } else if (kind === 'move') { ptr.x = x; ptr.y = y; ptr.on = true; }
      else { ptr.down = false; ptr.on = false; }
    },
  };
}

// ═══════════════ 3. PLINKO ═══════════════
function plinkoScene(b) {
  const { ctx, rng, rgb, tempo, dens, W, H, scale } = b;
  const cols = dens > 1 ? 9 : 6, rows = dens > 1 ? 11 : 8;
  const sx = W / cols, sy = (H * 0.62) / rows, y0 = H * 0.2;
  const pr = Math.min(6.5 * scale, sx * 0.12), br = Math.min(8.5 * scale, sx * 0.16);
  const pegs = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols + (r % 2 ? 0 : 1); c++) {
    pegs.push({ x: (r % 2 ? sx * 0.5 : 0) + c * sx + (r % 2 ? 0 : 0), y: y0 + r * sy, glow: 0, n: (c * 2 + r) % 11, c: 1 + ((r + c) % 3) });
  }
  const balls = [], drops = [];
  let t = 0, auto = 0, lastSnd = 0;
  const G = 1000 * scale * tempo;
  const drop = (x) => { if (balls.length < 48) balls.push({ x, y: -br, vx: (rng() - 0.5) * 40, vy: 0, c: 1 + ((rng() * 3) | 0), tr: [] }); };
  return {
    step(dt) {
      t += dt; auto -= dt;
      if (auto < 0) { auto = (0.22 + rng() * 0.3) / tempo; drop(br + rng() * (W - 2 * br)); }
      const sub = 2, h = dt / sub;
      for (let s = 0; s < sub; s++) for (let bi = balls.length - 1; bi >= 0; bi--) {
        const q = balls[bi];
        q.vy += G * h; q.x += q.vx * h; q.y += q.vy * h;
        if (q.x < br) { q.x = br; q.vx = Math.abs(q.vx) * 0.6; } else if (q.x > W - br) { q.x = W - br; q.vx = -Math.abs(q.vx) * 0.6; }
        if (q.y > y0 - 30 && q.y < y0 + rows * sy + 30) {
          for (const p of pegs) {
            const dx = q.x - p.x, dy = q.y - p.y, rr = pr + br;
            if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 < rr * rr && d2 > 0.01) {
              const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
              q.x = p.x + nx * rr; q.y = p.y + ny * rr;
              const vn = q.vx * nx + q.vy * ny;
              if (vn < 0) {
                q.vx -= 1.55 * vn * nx; q.vy -= 1.55 * vn * ny;
                q.vx += (rng() - 0.5) * 12;
                p.glow = 1;
                if (-vn > 60 * scale && t - lastSnd > 0.025) {
                  lastSnd = t;
                  b.sfx(() => A.note(p.n, { type: 'sine', gain: 0.1, dur: 0.45, pan: (p.x / W) * 2 - 1 }));
                }
              }
            }
          }
        }
        if (q.y > H + 30) {
          b.sfx(() => A.note(0, { type: 'triangle', gain: 0.1, dur: 0.6, pan: (q.x / W) * 2 - 1 }));
          drops.push({ x: q.x, age: 0, c: q.c });
          balls.splice(bi, 1);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = b.bg; ctx.fillRect(0, 0, W, H);
      for (const p of pegs) {
        p.glow *= Math.pow(0.02, dt);
        ctx.fillStyle = rgba(rgb[p.c], 0.35 + p.glow * 0.65);
        ctx.beginPath(); ctx.arc(p.x, p.y, pr * (1 + p.glow * 0.6), 0, TAU); ctx.fill();
        if (p.glow > 0.05) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(rgb[p.c], p.glow * 0.25);
          ctx.beginPath(); ctx.arc(p.x, p.y, pr * 4 * p.glow + pr, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const q of balls) {
        q.tr.push(q.x, q.y); if (q.tr.length > 14) q.tr.splice(0, 2);
        ctx.strokeStyle = rgba(rgb[q.c], 0.35); ctx.lineWidth = br * 1.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(q.tr[0], q.tr[1]);
        for (let k = 2; k < q.tr.length; k += 2) ctx.lineTo(q.tr[k], q.tr[k + 1]);
        ctx.stroke();
        ctx.fillStyle = rgba(rgb[4], 0.95);
        ctx.beginPath(); ctx.arc(q.x, q.y, br, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(rgb[q.c], 0.5);
        ctx.beginPath(); ctx.arc(q.x, q.y, br * 2.2, 0, TAU); ctx.fill();
      }
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i]; d.age += dt;
        if (d.age > 0.6) { drops.splice(i, 1); continue; }
        const g = ctx.createRadialGradient(d.x, H, 0, d.x, H, 80 * scale);
        g.addColorStop(0, rgba(rgb[d.c], (1 - d.age / 0.6) * 0.7)); g.addColorStop(1, rgba(rgb[d.c], 0));
        ctx.fillStyle = g; ctx.fillRect(d.x - 80 * scale, H - 80 * scale, 160 * scale, 80 * scale);
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    pointer(kind, x) { if (kind === 'down') { for (let k = 0; k < 3; k++) drop(x + (k - 1) * 14 * scale); } else if (kind === 'move' && rng() < 0.18) drop(x); },
  };
}

// ═══════════════ 4. MANDALA ═══════════════
function mandalaScene(b) {
  const { ctx, rng, rgb, tempo, W, H, scale } = b;
  const N = [6, 8, 10, 12][(rng() * 4) | 0];
  const cx = W / 2, cy = H * 0.46, R = Math.min(W, H * 0.6) * 0.44;
  const a1 = 0.55 + rng() * 0.5, a2 = a1 * (2.2 + rng() * 3.4), ph = rng() * TAU, m1 = 0.58 + rng() * 0.12;
  const cosT = [], sinT = [];
  for (let i = 0; i < N; i++) { cosT.push(Math.cos((TAU * i) / N)); sinT.push(Math.sin((TAU * i) / N)); }
  ctx.fillStyle = rgba(rgb[0], 1); ctx.fillRect(0, 0, W, H);
  let t = rng() * 10, last = null, ptrLast = null, ptrDown = false;
  const pen = (tt) => [R * (m1 * Math.cos(a1 * tt) + (1 - m1) * Math.cos(a2 * tt + ph)), R * (m1 * Math.sin(a1 * tt) + (1 - m1) * Math.sin(a2 * tt + ph))];
  const seg = (x0, y0, x1, y1) => {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const c = cosT[i], s = sinT[i];
      ctx.moveTo(cx + x0 * c - y0 * s, cy + x0 * s + y0 * c); ctx.lineTo(cx + x1 * c - y1 * s, cy + x1 * s + y1 * c);
      ctx.moveTo(cx - x0 * c - y0 * s, cy - x0 * s + y0 * c); ctx.lineTo(cx - x1 * c - y1 * s, cy - x1 * s + y1 * c);
    }
    ctx.stroke();
  };
  return {
    step(dt) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(rgb[0], 0.016); ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const sub = 6;
      for (let s = 0; s < sub; s++) {
        t += (dt * tempo * 0.9) / sub;
        const p = pen(t);
        if (last) {
          const k = (t * 0.18) % 3, i = k | 0, f = k - i;
          const col = mix(rgb[1 + i], rgb[1 + ((i + 1) % 3)], f);
          ctx.strokeStyle = rgba(col, 0.55); ctx.lineWidth = 1.5 * scale;
          seg(last[0], last[1], p[0], p[1]);
        }
        last = p;
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    pointer(kind, x, y) {
      const lx = x - cx, ly = y - cy;
      if (kind === 'down') {
        ptrDown = true; ptrLast = [lx, ly];
        b.sfx(() => A.note(1 + ((Math.hypot(lx, ly) / R) * 6 | 0), { type: 'triangle', gain: 0.12, dur: 0.8 }));
      } else if (kind === 'move' && ptrDown && ptrLast) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(rgb[4], 0.8); ctx.lineWidth = 2.6 * scale; ctx.lineCap = 'round';
        seg(ptrLast[0], ptrLast[1], lx, ly);
        ctx.globalCompositeOperation = 'source-over';
        ptrLast = [lx, ly];
      } else if (kind === 'up') ptrDown = false;
    },
  };
}

// ═══════════════ 5. RIPPLE GRID ═══════════════
function rippleScene(b) {
  const { ctx, rng, rgb, tempo, dens, W, H, scale } = b;
  const gcols = dens > 1 ? 24 : 15, g = W / gcols, grows = Math.ceil(H / g);
  const waves = [];
  let t = 0, auto = 0;
  const lam = 70 * scale * (dens > 1 ? 0.8 : 1.2), speed = 150 * scale * tempo;
  const emit = (x, y, amp) => waves.push({ x, y, t0: t, amp });
  const val = (x, y) => {
    let v = 0;
    for (const w of waves) {
      const age = t - w.t0, d = Math.hypot(x - w.x, y - w.y), e = d - speed * age;
      v += w.amp * Math.cos((e / lam) * TAU) * Math.exp(-((e / (lam * 1.4)) ** 2)) * Math.exp(-age * 0.45);
    }
    return v;
  };
  return {
    step(dt) {
      t += dt; auto -= dt;
      if (auto < 0) { auto = (1.1 + rng() * 0.9) / tempo; emit(rng() * W, rng() * H, 1); b.sfx(() => A.note((rng() * 6) | 0, { type: 'sine', gain: 0.09, dur: 0.9 })); }
      for (let i = waves.length - 1; i >= 0; i--) if (t - waves[i].t0 > 7) waves.splice(i, 1);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = b.bg; ctx.fillRect(0, 0, W, H);
      const off = (W - (gcols - 1) * g) / 2;
      for (let r = 0; r < grows; r++) for (let c = 0; c < gcols; c++) {
        const x = off + c * g, y = r * g + g / 2;
        const v = val(x, y), a = Math.abs(v);
        const rad = g * (0.12 + Math.min(0.42, a * 0.3));
        const col = v >= 0 ? rgb[1 + ((c + r) % 2)] : rgb[3];
        ctx.fillStyle = rgba(a > 0.55 ? mix(col, rgb[4], (a - 0.55) * 1.4) : col, 0.2 + Math.min(0.8, a * 0.9));
        ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
      }
    },
    pointer(kind, x, y) {
      if (kind === 'down') { emit(x, y, 1.5); b.sfx(() => A.note(2 + ((x / W) * 7 | 0), { type: 'sine', gain: 0.14, dur: 0.9, pan: (x / W) * 2 - 1 })); }
      else if (kind === 'move' && rng() < 0.08) emit(x, y, 0.7);
    },
  };
}

// ═══════════════ 6. ORBIT BEATS ═══════════════
function pendulumScene(b) {
  const { ctx, rng, rgb, tempo, dens, W, H, scale } = b;
  const n = dens > 1 ? 15 : 9, cx = W / 2, cy = H * 0.72;
  const r0 = W * 0.09, r1 = W * 0.47;
  const T = 26 / tempo, k0 = 6;
  const rings = [], last = new Array(n).fill(-1);
  let t = rng() * 3, warp = 0;
  return {
    step(dt) {
      warp = Math.max(0, warp - dt * 1.4);
      t += dt * (1 + warp * 3.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = b.bg; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(rgb[4], 0.22);
      ctx.beginPath(); ctx.moveTo(cx - r1 - 10, cy); ctx.lineTo(cx + r1 + 10, cy); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const r = r0 + (i / (n - 1)) * (r1 - r0);
        const col = rgb[1 + (i % 3)];
        ctx.strokeStyle = rgba(col, 0.2); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, TAU); ctx.stroke();
        const phase = ((k0 + i) * t) / T, u = phase % 2, th = Math.PI * (u < 1 ? u : 2 - u);
        const x = cx - r * Math.cos(th), y = cy - r * Math.sin(th);
        const hitIdx = Math.floor(phase);
        if (last[i] !== -1 && hitIdx !== last[i]) {
          rings.push({ x: cx + (hitIdx % 2 ? r : -r), y: cy, c: col, age: 0 });
          b.sfx(() => A.note(n - 1 - i, { type: 'sine', gain: 0.11, dur: 0.7, pan: hitIdx % 2 ? 0.5 : -0.5 }));
        }
        last[i] = hitIdx;
        const flash = smooth(0.12, 0, Math.min(u % 1, 1 - (u % 1)));
        ctx.fillStyle = rgba(col, 0.28); ctx.beginPath(); ctx.arc(x, y, (7 + flash * 6) * scale * 1.9, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(rgb[4], 0.95); ctx.beginPath(); ctx.arc(x, y, (4.2 + flash * 2.5) * scale, 0, TAU); ctx.fill();
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const g = rings[i]; g.age += dt;
        if (g.age > 0.7) { rings.splice(i, 1); continue; }
        const k = g.age / 0.7;
        ctx.strokeStyle = rgba(g.c, (1 - k) * 0.8); ctx.lineWidth = 2.2 * (1 - k) + 0.4;
        ctx.beginPath(); ctx.arc(g.x, g.y, 4 + k * 38 * scale, 0, TAU); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    pointer(kind) { if (kind === 'down') { warp = 1; b.sfx(() => A.whoosh()); } },
  };
}

// ═══════════════ 7. SLIME (metaballs → height-field → lit like jelly) ═══════════════
function slimeScene(b) {
  const { ctx, rng, rgb, tempo, dens, W, H, scale } = b;
  const gw = 110, gh = Math.round((gw * H) / W);
  const off = document.createElement('canvas'); off.width = gw; off.height = gh;
  const octx = off.getContext('2d'); const img = octx.createImageData(gw, gh);
  const F = new Float32Array(gw * gh), Hh = new Float32Array(gw * gh);
  const blobs = [];
  const cs = gw / W;
  const nb = Math.round(7 * dens);
  const mkB = (x, y, r) => ({ x, y, r, vx: (rng() - 0.5) * 70, vy: (rng() - 0.5) * 70, ph: rng() * TAU });
  for (let i = 0; i < nb; i++) blobs.push(mkB(W * (0.15 + rng() * 0.7), H * (0.15 + rng() * 0.7), (20 + rng() * 30) * scale));
  let t = 0, drag = null;
  const c1 = rgb[1], c2 = rgb[2], c3 = rgb[3], hi = rgb[4], bgc = rgb[0];
  const Lx = -0.35, Ly = -0.55, Lz = 0.76;               // light
  const hl = Math.hypot(Lx, Ly, Lz + 1), Hx = Lx / hl, Hy = Ly / hl, Hz = (Lz + 1) / hl; // half-vector
  return {
    step(dt) {
      t += dt * tempo;
      for (const o of blobs) {
        if (o === drag) continue;
        o.vx += Math.sin(t * 0.9 + o.ph) * 70 * dt + (W / 2 - o.x) * 0.05 * dt;
        o.vy += Math.cos(t * 0.8 + o.ph * 1.3) * 70 * dt + (H * 0.5 - o.y) * 0.04 * dt;
        for (const q of blobs) {
          if (q === o) continue;
          const dx = q.x - o.x, dy = q.y - o.y, d = Math.hypot(dx, dy) + 1, want = (o.r + q.r) * 1.05;
          if (d < want * 2.6) { const f = (d - want) * 0.9 * dt; o.vx += (dx / d) * f; o.vy += (dy / d) * f; } // short-range gloop
        }
        o.vx *= 0.986; o.vy *= 0.986;
        o.x += o.vx * dt * tempo; o.y += o.vy * dt * tempo;
        if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx); } if (o.x > W - o.r) { o.x = W - o.r; o.vx = -Math.abs(o.vx); }
        if (o.y < o.r) { o.y = o.r; o.vy = Math.abs(o.vy); } if (o.y > H - o.r) { o.y = H - o.r; o.vy = -Math.abs(o.vy); }
      }
      F.fill(0);
      for (const o of blobs) {
        const R = o.r * 2.3 * cs, ox = o.x * cs, oy = o.y * cs, R2 = R * R, k = (o.r * cs) ** 2;
        const x0 = Math.max(0, Math.floor(ox - R)), x1 = Math.min(gw - 1, Math.ceil(ox + R));
        const y0 = Math.max(0, Math.floor(oy - R)), y1 = Math.min(gh - 1, Math.ceil(oy + R));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dx = x - ox, dy = y - oy, d2 = dx * dx + dy * dy;
          if (d2 < R2) { const q = 1 - d2 / R2; F[y * gw + x] += q * q * q * (R2 / k) * 0.42; }
        }
      }
      for (let i = 0; i < F.length; i++) Hh[i] = Math.sqrt(Math.max(0, F[i] - 0.8));
      const d = img.data;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const i = y * gw + x, v = F[i], p = i * 4;
        const haloA = smooth(0.2, 0.9, v) * 0.32;
        const body = smooth(0.8, 0.98, v);
        if (haloA < 0.004 && body === 0) { d[p + 3] = 0; continue; }
        const xl = x > 0 ? Hh[i - 1] : Hh[i], xr = x < gw - 1 ? Hh[i + 1] : Hh[i];
        const yu = y > 0 ? Hh[i - gw] : Hh[i], yd = y < gh - 1 ? Hh[i + gw] : Hh[i];
        let nx = -(xr - xl) * 2.4, ny = -(yd - yu) * 2.4, nz = 1;
        const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const diff = clamp(nx * Lx + ny * Ly + nz * Lz, 0, 1);
        const spec = Math.pow(clamp(nx * Hx + ny * Hy + nz * Hz, 0, 1), 32);
        const rim = Math.pow(1 - nz, 2.2);
        const depth = smooth(0.8, 2.8, v);
        let col = mix(mix(c1, bgc, 0.45), mix(c2, c3, 0.35), clamp(diff * 0.9 + depth * 0.25, 0, 1));
        col = mix(col, c3, rim * 0.55);
        col = mix(col, hi, spec * 0.95);
        const halo = c1;
        const a = Math.max(haloA, body);
        const m = body;
        d[p] = halo[0] + (col[0] - halo[0]) * m; d[p + 1] = halo[1] + (col[1] - halo[1]) * m; d[p + 2] = halo[2] + (col[2] - halo[2]) * m;
        d[p + 3] = a * 255;
      }
      octx.putImageData(img, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = b.bg; ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, W, H);
    },
    pointer(kind, x, y) {
      if (kind === 'down') {
        let best = null, bd = 1e9;
        for (const o of blobs) { const dd = Math.hypot(o.x - x, o.y - y); if (dd < o.r * 1.9 && dd < bd) { bd = dd; best = o; } }
        if (best) { drag = best; best.vx = best.vy = 0; }
        else if (blobs.length < 14) { const o = mkB(x, y, (14 + rng() * 18) * scale); blobs.push(o); drag = o; }
        b.sfx(() => A.note(1 + ((y / H) * 5 | 0), { type: 'sine', gain: 0.16, dur: 0.5, detune: -20 }));
      } else if (kind === 'move' && drag) { drag.vx = (x - drag.x) * 9; drag.vy = (y - drag.y) * 9; drag.x = x; drag.y = y; }
      else if (kind === 'up') drag = null;
    },
  };
}

const BUILDERS = { pop: popScene, flow: flowScene, plinko: plinkoScene, mandala: mandalaScene, ripple: rippleScene, pendulum: pendulumScene, slime: slimeScene };

export function createScene(item, canvas, W, H, dpr) {
  const b = makeBase(item, canvas, W, H, dpr);
  const s = BUILDERS[item.scene](b);
  const api = {
    get active() { return b.active; },
    set active(v) { b.active = v; },
    step(dt) { s.step(Math.min(dt, 1 / 24)); },
    pointer: s.pointer,
    warm(n = 40) { const was = b.active; b.active = false; for (let i = 0; i < n; i++) s.step(1 / 30); b.active = was; },
    destroy() { canvas.width = canvas.height = 1; },
  };
  return api;
}
