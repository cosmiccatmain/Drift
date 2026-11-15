// Simulated users with hidden tastes. If the engine works, it should (a) find the taste fast,
// (b) keep engagement up vs. random, (c) still stay varied (no boring runs, no filter bubble).
import { buildCatalog, mulberry32 } from '../src/content.js';
import { DriftEngine } from '../src/algo.js';

const catalog = buildCatalog();
const personas = [
  { name: 'neon-pop',      likes: { scene: ['pop'], palette: ['neon'], tempo: ['fast'] } },
  { name: 'calm-mandala',  likes: { scene: ['mandala', 'flow'], palette: ['aurora', 'ocean'], tempo: ['slow'] } },
  { name: 'plinko-ember',  likes: { scene: ['plinko'], palette: ['ember', 'sunset'], density: ['dense'] } },
];

function affinity(p, it) {
  let a = 0.06;
  if (p.likes.scene?.includes(it.scene)) a += 0.42;
  if (p.likes.palette?.includes(it.palette)) a += 0.3;
  if (p.likes.tempo?.includes(it.tempo)) a += 0.12;
  if (p.likes.density?.includes(it.density)) a += 0.1;
  return Math.min(1, a);
}
function userReacts(p, it, rng) {
  const a = affinity(p, it);
  const engaged = rng() < a;
  const dwell = engaged ? it.loop * (0.7 + rng() * 1.3) : 0.3 + rng() * 2;
  return { dwell, interactions: engaged ? (rng() * 6) | 0 : 0, liked: engaged && rng() < 0.3, shared: false, replayed: false, disliked: false };
}

let fail = 0;
const check = (ok, msg) => { console.log((ok ? '  ✔ ' : '  ✘ ') + msg); if (!ok) fail++; };

for (const p of personas) {
  console.log(`\nPersona: ${p.name}`);
  const N = 120;
  const run = (policy, seed = 7) => {
    const rng = mulberry32(seed);
    const eng = new DriftEngine(catalog, null, 99 + seed);
    const shown = [];
    let streak = 1, maxStreak = 1;
    const queued = new Set();
    for (let i = 0; i < N; i++) {
      const it = policy === 'drift' ? eng.next(1, queued)[0] : catalog.filter((c) => !queued.has(c.id))[(rng() * (catalog.length - queued.size)) | 0];
      queued.add(it.id);
      shown.push(it);
      const sig = userReacts(p, it, rng);
      if (policy === 'drift') eng.observe(it, sig);
      const n = shown.length;
      if (n > 1 && shown[n - 2].scene === it.scene) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 1;
    }
    const avgAff = (arr) => arr.reduce((s, it) => s + affinity(p, it), 0) / arr.length;
    return { early: avgAff(shown.slice(0, 15)), late: avgAff(shown.slice(-40)), all: avgAff(shown), shown, maxStreak, eng };
  };
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
  const ds = SEEDS.map((x) => run('drift', x)), rs = SEEDS.map((x) => run('random', x));
  const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
  const d = { ...ds[0], early: mean(ds, (x) => x.early), late: mean(ds, (x) => x.late), maxStreak: Math.max(...ds.map((x) => x.maxStreak)) };
  const r = { all: mean(rs, (x) => x.all) };
  console.log(`  (mean of ${SEEDS.length} seeds) avg affinity  drift: early ${d.early.toFixed(3)} → late ${d.late.toFixed(3)}   random: ${r.all.toFixed(3)}`);
  check(d.late > r.all * 1.25, `late-session relevance beats random by >25% (${(d.late / r.all).toFixed(2)}x)`);
  check(d.late > d.early, 'engine improves over the session');
  const scenesLate = new Set(d.shown.slice(-20).map((s) => s.scene)).size;
  const palLate = new Set(d.shown.slice(-20).map((s) => s.palette)).size;
  check(scenesLate >= 3, `still varied: ${scenesLate} scenes / ${palLate} palettes in last 20`);
  check(d.maxStreak <= 2, `no 3-in-a-row of same scene (max run ${d.maxStreak})`);
  const exploreShare = d.shown.slice(-40).filter((s) => affinity(p, s) < 0.2).length / 40;
  check(exploreShare > 0.05, `keeps exploring (${(exploreShare * 100).toFixed(0)}% off-taste in last 40)`);
  const goldens = d.shown.filter((s) => s.golden).length;
  check(goldens >= 1 && goldens <= 14, `golden clips are rare but present (${goldens}/120)`);
  const prof = d.eng.profile();
  const topScene = prof.groups.scene[0]?.val;
  check(p.likes.scene.includes(topScene), `learned top scene = ${topScene}`);
}

// Skip-streak rescue
{
  const eng = new DriftEngine(catalog, null, 5);
  const q = new Set();
  for (let i = 0; i < 10; i++) { const it = eng.next(1, q)[0]; q.add(it.id); eng.observe(it, { dwell: 8, interactions: 3, liked: false }); }
  for (let i = 0; i < 2; i++) { const it = eng.next(1, q)[0]; q.add(it.id); eng.observe(it, { dwell: 0.2, interactions: 0 }); }
  const it = eng.next(1, q)[0];
  console.log('\nRescue check');
  check(it.meta.mode === 'rescue' || it.meta.mode === 'golden', `after 2 skips mode = ${it.meta.mode}`);
}
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll checks passed');
process.exit(fail ? 1 : 0);
