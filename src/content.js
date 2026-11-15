// Deterministic procedural catalog. Every clip is a seeded generative scene, so the
// "library" is 720 unique clips that cost 0 bytes of video.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCENES = {
  pop:      { name: 'Chain Pop',  verbs: ['Chain reaction', 'Bubble cascade', 'Pop wave', 'Orb meltdown'], base: 0.55 },
  flow:     { name: 'Flow Field', verbs: ['Silk currents', 'Ribbon storm', 'Wind painting', 'Light threads'], base: 0.35 },
  plinko:   { name: 'Plinko',     verbs: ['Marble melody', 'Peg symphony', 'Ball rain', 'Gravity jam'], base: 0.7 },
  mandala:  { name: 'Mandala',    verbs: ['Spiro bloom', 'Kaleido draw', 'Symmetry loop', 'Sacred lines'], base: 0.3 },
  ripple:   { name: 'Ripple Grid', verbs: ['Dot waves', 'Interference', 'Pulse field', 'Wave tank'], base: 0.45 },
  pendulum: { name: 'Orbit Beats', verbs: ['Arc rhythm', 'Polyrhythm', 'Tick orbit', 'Sync-up'], base: 0.5 },
  slime:    { name: 'Slime',      verbs: ['Blob merge', 'Goo drift', 'Liquid lava', 'Mercury melt'], base: 0.4 },
};

export const PALETTES = {
  aurora: ['#0b1026', '#5ef2c1', '#6aa8ff', '#b07cff', '#f0fff4'],
  sunset: ['#1a0b2e', '#ff5e7e', '#ff9a56', '#ffd166', '#fff1d6'],
  neon:   ['#07060f', '#ff2bd6', '#2be4ff', '#b6ff3b', '#ffffff'],
  ocean:  ['#031a2b', '#00b4d8', '#48cae4', '#90e0ef', '#caf0f8'],
  candy:  ['#2b1237', '#ff8fd0', '#ffd6a5', '#a0f0ff', '#fff5fb'],
  ember:  ['#120503', '#ff3d00', '#ff9100', '#ffd54f', '#fff3e0'],
  mono:   ['#08080a', '#e8e8ee', '#9aa0b4', '#5a6078', '#ffffff'],
  jade:   ['#04130f', '#2ee59d', '#9bf6c8', '#e7ff9b', '#f4fff0'],
};

export const TEMPOS = ['slow', 'mid', 'fast'];
export const DENSITIES = ['sparse', 'dense'];

const ADJ = ['pixel', 'lofi', 'velvet', 'tiny', 'cosmic', 'soft', 'mega', 'quiet', 'neon', 'glitch', 'mellow', 'turbo', 'dream', 'paper', 'lunar', 'sugar', 'static', 'amber', 'hyper', 'moss'];
const NOUN = ['monk', 'fox', 'orbit', 'wave', 'loop', 'bloom', 'pilot', 'cat', 'sprite', 'drift', 'forge', 'echo', 'tide', 'pulse', 'garden', 'machine', 'ghost', 'atlas', 'hum', 'spark'];

const TAGS = {
  pop: ['#oddlysatisfying', '#popit', '#chainreaction', '#asmr'],
  flow: ['#flowstate', '#calm', '#generative', '#silk'],
  plinko: ['#plinko', '#marbles', '#satisfying', '#musical'],
  mandala: ['#mandala', '#symmetry', '#hypnotic', '#kaleidoscope'],
  ripple: ['#waves', '#physics', '#dots', '#pattern'],
  pendulum: ['#polyrhythm', '#loopable', '#sync', '#hypnotic'],
  slime: ['#slime', '#goo', '#metaballs', '#squish'],
};

const CAPTIONS = [
  'wait for it', 'this one is dangerously calming', 'you will watch this 6 times', 'tap everything',
  'brain: quiet', '3am energy', 'sound on', 'no thoughts just vibes', 'my favorite loop',
  'it gets better at the end', 'try touching it', 'pure serotonin', 'okay but listen', 'again.',
];

export const NUM_CREATORS = 40;
export const CATALOG_SIZE = 720;

export function buildCatalog() {
  const sceneKeys = Object.keys(SCENES);
  const palKeys = Object.keys(PALETTES);
  const rng = mulberry32(20241114);

  // Creators have a taste: favorite scenes + palettes. That makes "creator" a real,
  // learnable signal rather than noise.
  const creators = [];
  const used = new Set();
  while (creators.length < NUM_CREATORS) {
    const h = '@' + ADJ[(rng() * ADJ.length) | 0] + NOUN[(rng() * NOUN.length) | 0];
    if (used.has(h)) continue;
    used.add(h);
    creators.push({
      handle: h,
      scenes: [sceneKeys[(rng() * sceneKeys.length) | 0], sceneKeys[(rng() * sceneKeys.length) | 0]],
      palettes: [palKeys[(rng() * palKeys.length) | 0], palKeys[(rng() * palKeys.length) | 0]],
      hue: Math.floor(rng() * 360),
      clout: Math.pow(rng(), 2.2),
    });
  }

  const items = [];
  for (let i = 0; i < CATALOG_SIZE; i++) {
    const cr = creators[(Math.pow(rng(), 1.5) * creators.length) | 0];
    const scene = rng() < 0.72 ? cr.scenes[(rng() * 2) | 0] : sceneKeys[(rng() * sceneKeys.length) | 0];
    const palette = rng() < 0.7 ? cr.palettes[(rng() * 2) | 0] : palKeys[(rng() * palKeys.length) | 0];
    const tempo = TEMPOS[(rng() * 3) | 0];
    const density = DENSITIES[(rng() * 2) | 0];
    const verbs = SCENES[scene].verbs;
    const tags = TAGS[scene];
    const tempoN = tempo === 'slow' ? 0 : tempo === 'mid' ? 0.5 : 1;
    const dens = density === 'dense' ? 1 : 0;
    // Energy in [0,1] drives the pacing curve in the ranker.
    const energy = Math.min(1, Math.max(0, SCENES[scene].base * 0.5 + tempoN * 0.35 + dens * 0.15 + (rng() - 0.5) * 0.1));
    const likes = Math.floor((cr.clout * 0.8 + rng() * 0.4) * 480000 * (0.4 + SCENES[scene].base));
    items.push({
      id: i,
      seed: (Math.imul(i + 1, 2654435761) ^ 0x9e3779b9) >>> 0,
      scene, palette, tempo, density, energy,
      creator: cr.handle,
      creatorHue: cr.hue,
      title: verbs[(rng() * verbs.length) | 0],
      caption: CAPTIONS[(rng() * CAPTIONS.length) | 0],
      tags: [tags[(rng() * tags.length) | 0], tags[(rng() * tags.length) | 0]].filter((v, k, a) => a.indexOf(v) === k),
      likes,
      loop: 8 + Math.floor(rng() * 7), // seconds, used as the "video length" for watch-ratio
      golden: rng() < 0.045,
    });
  }
  return items;
}

export function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
