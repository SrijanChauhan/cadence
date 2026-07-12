/**
 * Cadence — Seed engine
 * Maps {OCEAN trait vector × activity bucket} → target tempo band + seed search terms.
 * Deterministic and explainable (spec v0.2 P0). This produces the COLD-START target;
 * the Bayesian blender (bayes.js) then shifts it as feedback accumulates.
 *
 * Trait→music grounding (directional, from the personality–music literature):
 *  - Openness      → genre variety / complexity tolerance
 *  - Extraversion  → energy & tempo lift
 *  - Conscientious → lower lyrical/distraction tolerance during focus
 *  - Neuroticism   → softer dynamics, calmer target under stress-adjacent activities
 * Correlations are real but weak at the individual level — treat as prior, not promise.
 */

// Base tempo bands (BPM) and seed genre pools per activity
const ACTIVITY_BASE = {
  deep_work: {
    label: "Deep Work",
    bpm: [60, 100],
    seeds: ["instrumental focus", "ambient piano", "minimal electronic instrumental", "lofi instrumental"],
    vocalPenalty: true,
  },
  calls: {
    label: "Calls",
    bpm: [70, 100],
    seeds: ["soft jazz instrumental", "calm acoustic instrumental", "light bossa nova"],
    vocalPenalty: true,
  },
  creative: {
    label: "Creative",
    bpm: [90, 125],
    seeds: ["indie electronic", "neo soul", "downtempo", "jazz fusion"],
    vocalPenalty: false,
  },
  commute: {
    label: "Commute",
    bpm: [95, 130],
    seeds: ["indie pop", "classic rock", "hip hop", "synthwave"],
    vocalPenalty: false,
  },
  workout: {
    label: "Workout",
    bpm: [125, 165],
    seeds: ["edm workout", "power rock", "rap workout", "drum and bass"],
    vocalPenalty: false,
  },
  wind_down: {
    label: "Wind-down",
    bpm: [55, 85],
    seeds: ["chill acoustic", "ambient", "slow jazz", "soft indie"],
    vocalPenalty: false,
  },
};

export const ACTIVITIES = Object.entries(ACTIVITY_BASE).map(([key, v]) => ({ key, label: v.label }));

/**
 * @param {{O:number,C:number,E:number,A:number,N:number}} traits 0–1 normalized
 * @param {string} activity key from ACTIVITY_BASE
 * @param {number} [moodShiftBpm] optional BPM nudge from the session's mood (see moodEngine.js)
 * @returns {{bpmMin:number,bpmMax:number,seedTerms:string,explain:string[]}}
 */
export function seedTarget(traits, activity, extraBpmShift = 0) {
  const base = ACTIVITY_BASE[activity];
  if (!base) throw new Error(`Unknown activity: ${activity}`);
  const explain = [];

  let [lo, hi] = base.bpm;

  // Extraversion shifts the whole band up/down (±10 BPM at the extremes)
  const eShift = (traits.E - 0.5) * 20;
  lo += eShift; hi += eShift;
  if (Math.abs(eShift) > 4) explain.push(`${eShift > 0 ? "Raised" : "Lowered"} tempo ~${Math.abs(Math.round(eShift))} BPM for your ${eShift > 0 ? "higher" : "lower"} Extraversion`);

  // session mood + local weather (analyzed server-side) nudge tempo, independent of personality
  if (extraBpmShift && Math.abs(extraBpmShift) >= 3) {
    lo += extraBpmShift; hi += extraBpmShift;
    explain.push(`${extraBpmShift > 0 ? "Boosted" : "Softened"} tempo ~${Math.abs(extraBpmShift)} BPM for how you're feeling and conditions right now`);
  }

  // Neuroticism narrows toward the calm end for stress-adjacent activities
  if ((activity === "deep_work" || activity === "wind_down" || activity === "calls") && traits.N > 0.6) {
    hi -= (traits.N - 0.6) * 25;
    explain.push("Capped the top of the tempo band — calmer target for a higher-sensitivity profile");
  }

  // Openness widens the seed pool; low Openness sticks to the first (most familiar) seeds
  const poolSize = traits.O >= 0.6 ? base.seeds.length : traits.O >= 0.35 ? Math.max(2, base.seeds.length - 1) : 2;
  const pool = base.seeds.slice(0, poolSize);
  if (poolSize === base.seeds.length) explain.push("Widened genre variety for high Openness");
  if (poolSize === 2) explain.push("Kept genres familiar for lower Openness");

  // Conscientiousness + focus context → prefer instrumental seeds
  let seedPool = pool;
  if (base.vocalPenalty && traits.C > 0.55) {
    seedPool = pool.filter((s) => s.includes("instrumental") || s.includes("ambient"));
    if (seedPool.length === 0) seedPool = pool;
    explain.push("Prioritized instrumental tracks — high Conscientiousness in a focus context");
  }

  const seedTerms = seedPool[Math.floor(Math.random() * seedPool.length)];
  lo = Math.max(40, Math.round(lo));
  hi = Math.min(200, Math.round(hi));
  if (hi - lo < 12) hi = lo + 12; // keep the band searchable

  // seedTerms: one pick, kept for display ("BPM · tuned to you"'s source genre).
  // seedPool: the full (personality-filtered) list — searched across genre-by-
  // genre for real cross-genre exploration instead of one random term.
  return { bpmMin: lo, bpmMax: hi, seedTerms, seedPool, explain };
}
