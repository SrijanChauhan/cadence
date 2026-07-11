/**
 * Cadence — Confidence-weighted prior/posterior blending
 * Direct implementation of docs/technical-appendix-bayesian-blending.md.
 *
 * Per (activity bucket) we track a posterior over the user's true BPM target.
 * Prior mean  = seed engine's band midpoint (personality × activity rule).
 * Prior var   = wide (personality→music correlations are weak: σ0² generous).
 * Each feedback event is a weighted pseudo-observation of the track's BPM.
 * λ (lambda) = fraction of the blend still attributable to the personality prior —
 * it decays on EVIDENCE (n, variance), not on a timer.
 */

const PRIOR_VAR = 150;      // σ0² — trait-derived target uncertainty (~±12 BPM)
const OBS_NOISE_FLOOR = 150; // a single like/skip is a NOISY indicator of BPM preference

// engagement weights per feedback type (reliability ranking from the spec)
export const FEEDBACK_WEIGHTS = {
  save: 1.0,
  like: 0.8,
  complete: 0.6,
  skip_late: -0.3, // skipped after >20s — mild negative
  skip_fast: -0.9, // skipped <5s — strong negative
};

export function newBucketState(priorMeanBpm) {
  return {
    mu0: priorMeanBpm,
    n: 0,
    runningMean: priorMeanBpm,
    M2: 0,
  };
}

/** Welford-style weighted online update. Returns updated state. */
export function updateBucket(state, trackBpm, feedbackType) {
  if (trackBpm == null) return state; // can't learn from tracks with no BPM
  const w = FEEDBACK_WEIGHTS[feedbackType] ?? 0;
  if (w === 0) return state;

  const s = { ...state };
  s.n += Math.abs(w);
  const delta = trackBpm - s.runningMean;
  s.runningMean += (w * delta) / s.n;
  s.M2 += w * delta * (trackBpm - s.runningMean);
  return s;
}

/** Current posterior mean + lambda (personality-prior share of the blend). */
export function posterior(state) {
  const sigmaObsSq = Math.max(state.M2 / Math.max(state.n - 1, 1), OBS_NOISE_FLOOR);
  const denom = sigmaObsSq + state.n * PRIOR_VAR;
  const muPost = (sigmaObsSq * state.mu0 + state.n * PRIOR_VAR * state.runningMean) / denom;
  const lambda = sigmaObsSq / denom;
  return { muPost, lambda: Math.min(Math.max(lambda, 0), 1) };
}

/**
 * Re-rank candidates: closeness of track BPM to posterior target,
 * blended with Deezer popularity rank so early sessions aren't obscure noise.
 */
export function rankTracks(tracks, state) {
  const { muPost } = posterior(state);
  const maxRank = Math.max(...tracks.map((t) => t.rank || 0), 1);
  return [...tracks].sort((a, b) => score(b) - score(a));

  function score(t) {
    const bpmScore = t.bpm == null ? 0.4 : 1 - Math.min(Math.abs(t.bpm - muPost) / 40, 1); // 0..1
    const popScore = (t.rank || 0) / maxRank; // 0..1
    return 0.7 * bpmScore + 0.3 * popScore;
  }
}
