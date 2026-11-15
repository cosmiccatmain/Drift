import { buildCatalog, SCENES, PALETTES, fmtCount } from './content.js';
import { DriftEngine, MODE_LABEL } from './algo.js';
import { createScene } from './scenes.js';
import * as A from './audio.js';
import { load, save, wipe } from './store.js';

// ── icons ───────────────────────────────────────────────────────────────────
const I = {
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  less: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 6.3L21 10l-5.3 3.6L17 21l-5-4-5 4 1.3-7.4L3 10l6.8-1.7z"/></svg>',
  brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M12 6a3 3 0 0 0-5.5-1.6A3 3 0 0 0 4 9a3 3 0 0 0 .5 5A3 3 0 0 0 8 18.5 3 3 0 0 0 12 18"/><path d="M12 6a3 3 0 0 1 5.5-1.6A3 3 0 0 1 20 9a3 3 0 0 1-.5 5A3 3 0 0 1 16 18.5 3 3 0 0 1 12 18"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5 5 5.5 5 10.3A5.3 5.3 0 0 1 12 18a5.3 5.3 0 0 1-5-5.7c0-2 1-3.3 2-4.3.2 1.6 1 2.4 1.8 2.9C10.5 8 11 5 12 2z"/><path d="M12 22a3 3 0 0 0 3-3c0-1.5-1.5-2-3-4-1.5 2-3 2.5-3 4a3 3 0 0 0 3 3z" opacity=".6"/></svg>',
  on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
  off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
};

// ── state ───────────────────────────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const feed = $('#feed');
let catalog = buildCatalog();
// dev flag: /?only=pop (or flow, plinko, mandala, ripple, pendulum, slime) to test a single scene
{ const only = new URLSearchParams(location.search).get('only'); if (only && SCENES[only]) catalog = catalog.filter((c) => c.scene === only); }
const engine = new DriftEngine(catalog, load('drift.model'));
const stats = Object.assign({ streak: 0, best: 0, lastDay: '', clips: 0, likes: 0, secs: 0 }, load('drift.stats'));
let introSeen = !!load('drift.intro');
const cards = [];
let queued = new Set();
let active = -1;
let combo = 0;
let lastT = performance.now();
let lastTap = { t: 0, x: 0, y: 0 };
let userActed = false;
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { userActed = true; }, { once: true, capture: true }));
const vib = (n) => { if (!userActed) return; try { navigator.vibrate && navigator.vibrate(n); } catch { /* noop */ } };

// daily streak (a retention hook, shown honestly)
{
  const day = (d) => d.toLocaleDateString('en-CA');
  const today = day(new Date()), yest = day(new Date(Date.now() - 864e5));
  if (stats.lastDay !== today) {
    stats.streak = stats.lastDay === yest ? stats.streak + 1 : 1;
    stats.best = Math.max(stats.best, stats.streak);
    stats.lastDay = today;
    stats.newDay = true;
  }
}

const persist = () => { save('drift.model', engine.serialize()); const { newDay, ...s } = stats; save('drift.stats', s); };

// ── labels ──────────────────────────────────────────────────────────────────
const cap = (s) => s[0].toUpperCase() + s.slice(1);
function labelOf(key) {
  const [dim, v] = key.split(':');
  if (dim === 'scene') return SCENES[v].name;
  if (dim === 'palette') return cap(v) + ' palette';
  if (dim === 'tempo') return v === 'mid' ? 'mid tempo' : v + ' tempo';
  if (dim === 'density') return v + ' layouts';
  return v;
}
function whyShort(it) {
  const m = it.meta;
  if (!m) return MODE_LABEL.exploit;
  const r = m.reasons[0];
  const tail = r ? ' · ' + (r.dim === 'creator' ? r.key.split(':')[1] : labelOf(r.key)) : '';
  return MODE_LABEL[m.mode] + tail;
}
const HEADLINE = {
  probe: ['Calibrating', 'Early on, I show you a wide spread to learn what hits. Linger or touch to tell me.'],
  exploit: ['Matched to your taste', 'High predicted engagement based on how you watch and touch.'],
  explore: ['Exploring on purpose', 'A deliberate test outside your lane, so your feed never goes stale.'],
  rescue: ['Course correcting', 'You skipped a few in a row, so I switched to my safest picks for you.'],
  stretch: ['Stretch pick', "You're locked in, so here's something adjacent to what you love."],
  golden: ['Golden clip', 'A rare drop, roughly 1 in 22. Stay for the bonus.'],
};
function reasonText(r) {
  const nm = r.dim === 'creator' ? r.key.split(':')[1] : labelOf(r.key);
  if (r.n === 0) return [`Unexplored: ${nm}`, 'new'];
  const pct = Math.round(r.mean * 100);
  return r.mean >= 0.5 ? [`You engage with ${nm}`, pct + '%'] : [`Testing ${nm}`, pct + '%'];
}

// ── toast / confetti / bursts ───────────────────────────────────────────────
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function confetti(el, n = 36) {
  const pal = PALETTES.sunset.slice(1).concat(['#ffd36b', '#ffffff']);
  const w = el.clientWidth, h = el.clientHeight;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i'); c.className = 'confetti';
    c.style.left = w / 2 + 'px'; c.style.top = h * 0.4 + 'px'; c.style.background = pal[i % pal.length];
    c.style.setProperty('--dx', (Math.random() - 0.5) * w * 0.9 + 'px');
    c.style.setProperty('--dy', -h * 0.25 + Math.random() * h * 0.6 + 'px');
    c.style.setProperty('--rot', Math.random() * 720 - 360 + 'deg');
    el.appendChild(c); setTimeout(() => c.remove(), 1700);
  }
}
function heartBurst(rec, x, y) {
  const b = document.createElement('div'); b.className = 'burst'; b.innerHTML = I.heart;
  b.style.left = x + 'px'; b.style.top = y + 'px'; rec.el.appendChild(b); setTimeout(() => b.remove(), 900);
}

// ── cards ───────────────────────────────────────────────────────────────────
function posterBg(p) { return `radial-gradient(120% 80% at 50% 30%, ${p[2]}33, transparent 60%), linear-gradient(${p[0]}, ${p[0]})`; }

function addCard(item) {
  const p = PALETTES[item.palette];
  const el = document.createElement('section');
  el.className = 'card' + (item.golden ? ' golden' : '');
  el.style.background = posterBg(p);
  el.innerHTML = `
    <canvas></canvas><div class="vig"></div><div class="shade"></div>
    <div class="badge-gold">GOLDEN</div>
    <div class="meta">
      <button class="why">${I.spark}<span></span></button>
      <h3>${item.creator}</h3>
      <p>${item.title} — ${item.caption} <em>${item.tags.join(' ')}</em></p>
    </div>
    <div class="rail">
      <div class="avatar" style="background:hsl(${item.creatorHue} 70% 45%)">${item.creator[1].toUpperCase()}</div>
      <button class="like" aria-label="Like"><span class="ico">${I.heart}</span><span class="n">${fmtCount(item.likes)}</span></button>
      <button class="less" aria-label="Less like this"><span class="ico">${I.less}</span><span>Less</span></button>
      <button class="share" aria-label="Share"><span class="ico">${I.share}</span><span>Share</span></button>
      <button class="insight" aria-label="Why this clip"><span class="ico">${I.brain}</span><span>Why</span></button>
    </div>
    <div class="loopbar"><i></i></div>`;
  feed.appendChild(el);
  const rec = {
    item, el, canvas: $('canvas', el), scene: null, bar: $('.loopbar', el), barI: $('.loopbar i', el),
    dwell: 0, loopT: 0, loops: 0, touches: 0, liked: false, likeFlag: false, shareFlag: false,
    disliked: false, visits: 0, goldenPaid: false, pdown: false,
  };
  cards.push(rec);
  queued.add(item.id);
  $('.why span', el).textContent = whyShort(item);
  bind(rec);
  return rec;
}

function local(rec, e) { const r = rec.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

function doLike(rec, x, y, fromTap) {
  const rail = $('.like', rec.el);
  if (fromTap) { if (!rec.liked) { setLike(rec, true); } heartBurst(rec, x, y); A.like(); vib(14); return; }
  setLike(rec, !rec.liked);
  if (rec.liked) { const r = rec.el.getBoundingClientRect(), b = rail.getBoundingClientRect(); heartBurst(rec, b.left - r.left + 24, b.top - r.top); A.like(); vib(14); }
}
function setLike(rec, on) {
  rec.liked = on; rec.likeFlag = on;
  if (on) stats.likes++;
  const b = $('.like', rec.el); b.classList.toggle('on', on);
  $('.n', b).textContent = fmtCount(rec.item.likes + (on ? 1 : 0));
}

function bind(rec) {
  const c = rec.canvas;
  c.addEventListener('pointerdown', (e) => {
    A.ensureAudio();
    if (rec !== cards[active]) return;
    const { x, y } = local(rec, e);
    rec.pdown = true; rec.touches++;
    try { c.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const now = performance.now();
    if (now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 70) { doLike(rec, x, y, true); lastTap.t = 0; }
    else lastTap = { t: now, x, y };
    rec.scene && rec.scene.pointer('down', x, y);
  });
  c.addEventListener('pointermove', (e) => { if (!rec.pdown || rec !== cards[active]) return; const { x, y } = local(rec, e); rec.scene && rec.scene.pointer('move', x, y); });
  const up = (e) => { if (!rec.pdown) return; rec.pdown = false; const { x, y } = local(rec, e); rec.scene && rec.scene.pointer('up', x, y); };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('contextmenu', (e) => e.preventDefault());

  $('.like', rec.el).addEventListener('click', () => { A.ensureAudio(); doLike(rec, 0, 0, false); });
  $('.less', rec.el).addEventListener('click', () => {
    rec.disliked = true; toast('Got it. Showing you less like this.'); vib(8);
    setTimeout(() => go(1), 260);
  });
  $('.share', rec.el).addEventListener('click', async () => {
    rec.shareFlag = true;
    const data = { title: 'Drift', text: `${rec.item.title} by ${rec.item.creator} on Drift`, url: location.origin };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); toast('Link copied'); } } catch { /* cancelled */ }
  });
  const open = () => openSheet(rec);
  $('.insight', rec.el).addEventListener('click', open);
  $('.why', rec.el).addEventListener('click', open);
}

// ── scene lifecycle ─────────────────────────────────────────────────────────
const dprCap = () => Math.min(window.devicePixelRatio || 1, 2);
function mount(rec) {
  if (rec.scene) return;
  const W = rec.el.clientWidth || feed.clientWidth || window.innerWidth;
  const H = rec.el.clientHeight || feed.clientHeight || window.innerHeight;
  rec.scene = createScene(rec.item, rec.canvas, W, H, dprCap());
  rec.scene.warm({ slime: 20, ripple: 20, plinko: 110, pendulum: 10 }[rec.item.scene] || 40);
  rec.scene.active = rec === cards[active];
}
function unmount(rec) { if (!rec.scene) return; rec.scene.destroy(); rec.scene = null; }
function syncMounts() {
  cards.forEach((rec, i) => { if (Math.abs(i - active) <= 1) { if (!rec.scene) mount(rec); } else unmount(rec); });
}

// ── feeding the feed ────────────────────────────────────────────────────────
function ensureAhead() {
  while (cards.length < active + 3) {
    let [it] = engine.next(1, queued);
    if (!it) { queued = new Set(cards.slice(-60).map((c) => c.item.id)); [it] = engine.next(1, queued); }
    if (!it) break;
    addCard(it);
  }
}

function setAmbient(p) {
  const el = $('#ambient'); const [a, b] = el.children;
  const nxt = a.classList.contains('on') ? b : a, cur = nxt === a ? b : a;
  nxt.style.background = `radial-gradient(40% 50% at 25% 30%, ${p[1]}, transparent 70%), radial-gradient(45% 55% at 78% 72%, ${p[3]}, transparent 70%)`;
  nxt.classList.add('on'); cur.classList.remove('on');
  document.documentElement.style.setProperty('--ac', p[1]);
}

function setActive(i) {
  if (i === active || !cards[i]) return;
  const prev = cards[active];
  if (prev) { if (prev.scene) prev.scene.active = false; finalize(prev); }
  active = i;
  const rec = cards[i];
  rec.visits++; rec.loopT = 0; rec.goldenPaid = false;
  mount(rec);
  rec.scene.active = true;
  A.setKey((rec.item.seed >>> 3) % 12);
  rec.el.classList.add('in');
  setAmbient(PALETTES[rec.item.palette]);
  vib(5);
  ensureAhead();
  setTimeout(syncMounts, 60);
  if (i >= 1 && !introSeen) { introSeen = true; save('drift.intro', 1); $('#hint').classList.add('gone'); }
  if (rec.item.golden) { A.golden(); vib([12, 40, 12]); toast('Golden clip. Stay a few seconds for a bonus.', 2800); }
  updateHud();
}

function go(d) {
  const t = Math.max(0, Math.min(cards.length - 1, active + d));
  feed.scrollTo({ top: t * feed.clientHeight, behavior: 'smooth' });
}

// ── learning loop ───────────────────────────────────────────────────────────
function finalize(rec) {
  if (rec.dwell < 0.05 && !rec.likeFlag) return;
  const sig = { dwell: rec.dwell, interactions: rec.touches, liked: rec.likeFlag, shared: rec.shareFlag, replayed: rec.visits > 1, disliked: rec.disliked };
  const res = engine.observe(rec.item, sig);
  stats.clips++;
  if (res.kind === 'love') {
    combo++;
    if (combo === 5) toast('Deep Drift. The algorithm has locked on.');
  } else if (res.kind === 'skip' || res.kind === 'dislike') combo = 0;
  else combo = Math.max(0, combo - 1);
  rec.dwell = 0; rec.touches = 0; rec.loops = 0; rec.disliked = false; rec.shareFlag = false;
  persist();
  updateHud();
}

function updateHud() {
  const c = $('#combo');
  if (combo >= 2) { c.hidden = false; c.textContent = `FLOW ×${combo}`; c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  else c.hidden = true;
  $('#streak').innerHTML = `${I.flame}${stats.streak}d`;
}

// ── main loop ───────────────────────────────────────────────────────────────
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const rec = cards[active];
  if (rec && rec.scene && !document.hidden) {
    rec.scene.step(dt);
    rec.dwell += dt; stats.secs += dt; rec.loopT += dt;
    if (rec.loopT >= rec.item.loop) { rec.loopT -= rec.item.loop; rec.loops++; rec.bar.classList.remove('flash'); void rec.bar.offsetWidth; rec.bar.classList.add('flash'); A.tick(); }
    rec.barI.style.transform = `scaleX(${rec.loopT / rec.item.loop})`;
    if (rec.item.golden && !rec.goldenPaid && rec.dwell > 4) {
      rec.goldenPaid = true; confetti(rec.el, 48); A.golden(); vib([20, 50, 20, 50, 30]);
      combo += 2; toast('+2 Flow. Golden bonus!'); updateHud();
    }
  }
  requestAnimationFrame(frame);
}

// ── insights sheet ──────────────────────────────────────────────────────────
function openSheet(rec) {
  const it = rec.item, m = it.meta || { mode: 'exploit', reasons: [] };
  const prof = engine.profile();
  const [head, sub] = HEADLINE[m.mode];
  const conf = Math.round(prof.confidence * 100);
  const bars = (arr, fmt) => arr.slice(0, 4).map((g) => `<div class="bar"><span>${fmt(g)}</span><div class="t"><i style="width:${Math.round(g.mean * 100)}%"></i></div><em>${Math.round(g.mean * 100)}%</em></div>`).join('');
  const sw = prof.groups.palette.slice(0, 3).map((g) => `<span class="chip"><i style="background:linear-gradient(135deg,${PALETTES[g.val][1]},${PALETTES[g.val][2]})"></i>${cap(g.val)}</span>`).join('');
  const cre = prof.groups.creator[0];
  $('#sheet-body').innerHTML = `<div class="sh">
    <h4>Why you're seeing this</h4>
    <div class="why-main">${head}<small>${sub}</small></div>
    ${m.reasons.map((r) => { const [a, b] = reasonText(r); return `<div class="reason"><span>${a}</span><b>${b}</b></div>`; }).join('')}
    <h4>Your Drift</h4>
    <div class="dna"><div class="ring" style="--p:${conf}"><span>${conf}%</span></div>
      <p>${prof.obs < 6 ? 'Still calibrating. A few more swipes and this gets sharp.' : `I'm ${conf}% sure I know what hits for you after ${prof.obs} clips. Everything is stored on this device only.`}</p></div>
    ${prof.groups.scene.length ? `<h4>Top formats</h4>${bars(prof.groups.scene, (g) => SCENES[g.val].name)}` : ''}
    ${sw ? `<h4>Colors you linger on</h4><div class="chips">${sw}${cre ? `<span class="chip">${cre.val}</span>` : ''}</div>` : ''}
    <h4>How the algorithm works</h4>
    <ol class="how">
      <li><b>Implicit signals.</b> Watch time vs. loop length, touches, replays, likes, shares, fast skips.</li>
      <li><b>Bayesian taste model.</b> Every trait holds a Beta posterior of "do they engage with this".</li>
      <li><b>Thompson sampling</b> picks by sampling, so uncertain traits get tested and proven ones win.</li>
      <li><b>Session momentum</b> reacts within a few swipes. <b>Forgetting</b> lets your taste drift.</li>
      <li><b>MMR re-ranking</b> and an energy curve keep it varied. Skips trigger a safe-pick rescue.</li>
    </ol>
    <div class="btnrow"><button class="btn" id="reset">Reset my taste</button><button class="btn pri" id="close">Keep drifting</button></div>
  </div>`;
  $('#sheet').classList.add('open'); $('#sheet').setAttribute('aria-hidden', 'false');
  $('#close').onclick = closeSheet;
  $('#reset').onclick = () => { engine.reset(); wipe('drift.model'); stats.clips = 0; combo = 0; persist(); updateHud(); toast('Taste reset. Fresh start.'); closeSheet(); };
}
function closeSheet() { $('#sheet').classList.remove('open'); $('#sheet').setAttribute('aria-hidden', 'true'); }
$('#sheet .backdrop').addEventListener('click', closeSheet);

// ── chrome ──────────────────────────────────────────────────────────────────
const sndBtn = $('#snd');
const setSndIcon = () => { sndBtn.innerHTML = A.isMuted() ? I.off : I.on; };
sndBtn.addEventListener('click', () => { A.ensureAudio(); A.setMuted(!A.isMuted()); save('drift.muted', A.isMuted() ? 1 : 0); setSndIcon(); });
A.setMuted(!!load('drift.muted', 0)); setSndIcon();

let ticking = false;
feed.addEventListener('scroll', () => {
  if (ticking) return; ticking = true;
  requestAnimationFrame(() => { ticking = false; const i = Math.round(feed.scrollTop / feed.clientHeight); if (i !== active && cards[i]) setActive(i); });
}, { passive: true });

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') closeSheet();
  else if (k === 'arrowdown' || k === 'j' || k === ' ') { e.preventDefault(); go(1); }
  else if (k === 'arrowup' || k === 'k') { e.preventDefault(); go(-1); }
  else if (k === 'l' && cards[active]) { A.ensureAudio(); doLike(cards[active], 0, 0, false); }
  else if (k === 'm') sndBtn.click();
  else if (k === 'i' && cards[active]) openSheet(cards[active]);
});

let rz;
window.addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => { cards.forEach(unmount); syncMounts(); feed.scrollTo({ top: active * feed.clientHeight }); }, 200);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); else lastT = performance.now(); });
window.addEventListener('pagehide', persist);

// ── boot ────────────────────────────────────────────────────────────────────
if (introSeen) $('#hint').classList.add('gone');
ensureAhead(); // 3 cards: this builds the opening hook + two calibration probes
requestAnimationFrame(() => {
  cards.length < 3 && ensureAhead();
  setActive(0);
  if (stats.newDay) { toast(stats.streak > 1 ? `Day ${stats.streak} streak. Welcome back.` : 'Welcome to Drift.', 2600); delete stats.newDay; }
  requestAnimationFrame(frame);
});

// tiny debug handle (also handy for the console nerds)
window.drift = { engine, cards, stats, get active() { return active; } };
