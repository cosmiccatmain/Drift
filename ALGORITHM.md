# Drift Engine

How the feed decides what you see next. The code is [`src/algo.js`](./src/algo.js) (pure JS, runs in the browser and in Node for the tests).

## 1. What is a "clip"?

A clip has five **features**: `scene` (format), `palette`, `tempo`, `density`, `creator`. Each feature value is a *key*, e.g. `scene:plinko` or `palette:neon`. The model never learns about individual clips, only about keys. That is what lets it generalize: liking one neon Plinko makes other neon things and other Plinko things more likely.

Features are weighted when combined: scene 0.34, palette 0.24, creator 0.20, tempo 0.12, density 0.10.

## 2. Implicit reward

When you leave a clip, `reward()` turns behaviour into a value in `[0, 1]` and a confidence weight:

| Signal | Effect |
|---|---|
| Dwell ÷ loop length | saturating, up to +0.5 |
| Touches | +0.05 each, up to +0.3 |
| Like / share / re-visit | +0.35 / +0.25 / +0.15 |
| Watched past 1.6 loops | +0.10 |
| Left in under 1s (no like) | **skip**: reward 0 |
| "Less like this" | **dislike**: reward 0, weight 2 |

## 3. Taste model: Beta posteriors with forgetting

Each key holds `Beta(α, β)`, initialised at `(1.2, 1.2)` (mildly uncertain). An observation with reward `r` and weight `w` does `α += r·w`, `β += (1−r)·w` for every key on the clip. Before each update all posteriors decay a little toward the prior (`×0.985`), so old evidence fades and your taste can change.

A second, faster state tracks **session momentum**: an exponential moving average of `(reward − 0.5)` per key (`lr = 0.35`, then `×0.97` decay).

## 4. Scoring

For each candidate:

```
score = 4.4 · Σ wᶠ · θᶠ            ← Thompson sample from each key's posterior
      + 1.6 · Σ wᶠ · session[f]    ← what you're into right now
      + UCB bonus                  ← wᶠ · sd(f) · 2.2 · explore, shrinking as we learn
      + popularity prior           ← only matters at cold start
      + novelty − fatigue          ← unseen +, recent same format/creator −
      + pacing                     ← closeness to the target energy curve
```

**Why Thompson sampling?** Taking the posterior *mean* always picks the current favourite and never learns about alternatives. Sampling means a trait you have barely seen sometimes draws high and gets a try, while a trait you clearly love wins nearly every time. Exploration falls out of the uncertainty automatically.

## 5. Candidate slate → MMR diversification

Scoring all 720 clips every time is wasteful and brittle, so each slot scores a random slate of 90 unseen clips, takes the top 24, then picks greedily by **Maximal Marginal Relevance**:

```
pick = argmax  λ · score  −  (1 − λ) · max_similarity(candidate, last 8 shown)
```

`λ` is 0.85 normally, 0.94 in rescue, 0.64 when exploring. Hard rule: never three of the same format in a row.

## 6. Modes and pacing

| Mode | When | What changes |
|---|---|---|
| **probe** | first 7 observations | large exploration bonus; the very first clip is a proven crowd-pleaser (the hook) |
| **exploit** | default | normal scoring |
| **explore** | ~18% of slots | big UCB bonus, lower `λ`: a deliberate test outside your lane |
| **rescue** | 2+ skips in a row | minimal exploration, extra weight on proven taste, lower energy target |
| **stretch** | 4+ strong clips in a row | boost clips that share a loved trait but use a *different* format |
| **golden** | rare (~4.5% of the catalog) | placed on a variable-ratio schedule (≥8 clips since the last, 30% per slot) |

The **energy curve** is `0.5 + 0.28·sin(0.9·t)` nudged down after skips and up when you are locked in, so the feed breathes (build → release) instead of staying flat.

## 7. Two-item lookahead

The feed always has exactly two clips queued after the current one. Each new one is picked *after* the most recent observation, so the engine adapts about two swipes after your behaviour changes while the visible queue never changes under your thumb.

## 8. Transparency

Every pick stores its decision (`mode` + the top traits and their posterior means). The **Why** sheet shows that, your learned taste, and a "how well do I know you" confidence derived from posterior uncertainty.

## Testing

`npm test` runs `test/sim.mjs`: three simulated personas with hidden tastes, 8 seeds each, 120 clips per session.

- late-session relevance ≥ 1.25× random (measured: 1.3–1.5×)
- relevance improves over the session
- ≥ 3 formats in the last 20 clips; no 3-in-a-row of one format
- still exploring (some off-taste picks); golden clips present but rare
- learns the persona's favourite format
- rescue mode fires after consecutive skips

## Known limits

- The catalog is procedural and finite (720 clips), so over very long sessions repeats are allowed after it is exhausted.
- Single-device: no collaborative filtering (there is no server and no other users). The popularity prior is a stand-in for that.
- Beta draws use a normal approximation, which is fine once `α+β > ~4` and slightly noisy before.
