# drift

An infinite, touch-reactive scrolling feed with a recommendation algorithm that learns your taste in about 20 swipes. No backend, no accounts, no tracking. The whole thing runs on your device.

Every clip is a live, procedurally generated "oddly satisfying" scene (chain-pop bubbles, plinko, mandalas, ripple grids, orbit beats, jelly slime, flow fields). Tap, drag and hold: everything reacts, and everything is musical (all sounds are quantized to a pentatonic scale, so you can't hit a wrong note).

## Run it

```bash
npm run dev      # static server on http://localhost:5173
npm test         # simulated-user tests for the recommender
```

No build step, no dependencies. It is plain ES modules, so any static host works (it is deployed on Vercel).

**Controls**

| | Touch | Desktop |
|---|---|---|
| Next / previous | swipe up / down | `↓` `↑` `J` `K`, scroll |
| Interact with a clip | tap / drag | click / drag |
| Like | double-tap, or heart | double-click, `L` |
| Less like this | the minus button | |
| Why am I seeing this? | brain button or the pill on the clip | `I` |
| Mute | speaker button | `M` |

Dev flag: `/?only=pop` pins the feed to one scene (`pop flow plinko mandala ripple pendulum slime`).

## The algorithm ("Drift Engine")

Full write-up in [ALGORITHM.md](./ALGORITHM.md). The short version:

1. **Implicit reward.** No survey, no stars. Reward comes from behaviour: watch time vs. loop length, touches, replays, likes, shares, fast skips, and "less like this".
2. **Bayesian taste model.** Every trait of a clip (format, color palette, tempo, density, creator) keeps a Beta posterior of "does this person engage with it". It forgets slowly, so taste can drift.
3. **Thompson sampling + UCB.** Candidates are scored with *sampled* beliefs plus an uncertainty bonus. Proven traits win most draws and uncertain ones get tested, with no hand-tuned "10% random" slot.
4. **Session momentum.** A fast moving average reacts within a few swipes to what you are into *right now*.
5. **MMR diversity + pacing.** Greedy re-ranking trades relevance against similarity to recent clips, plus an energy curve (build → release) and hard rules (never three of one format in a row).
6. **Modes.** *Probe* (cold start), *exploit*, *explore*, *rescue* (after a skip streak: safest picks only), *stretch* (when locked in: adjacent novelty) and rare *Golden* clips on a variable-ratio schedule.
7. **Transparent.** Tap **Why** on any clip to see the mode, the traits that drove the pick, and your learned taste profile. One tap resets it.

`npm test` simulates users with hidden tastes. The engine reaches ~1.3–1.5x the relevance of random after ~100 clips while staying varied (7 formats in the last 20 clips, no runs of 3 of one format).

## Project layout

```
index.html            app shell
src/main.js           feed, scroll-snap, signal capture, "Why" sheet
src/algo.js           the recommendation engine (pure JS, no DOM)
src/content.js        deterministic 720-clip catalog + creators
src/scenes.js         7 generative scenes (canvas 2D)
src/audio.js          WebAudio synth (pentatonic, delay "space")
src/store.js          safe localStorage wrapper
test/sim.mjs          simulated-user tests for the engine
```

## Privacy

The model, history and streak live in your browser's `localStorage`. Nothing is sent anywhere.

## License

MIT
