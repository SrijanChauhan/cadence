/**
 * Cadence — Mood engine (on-device semantic analysis, no API/backend)
 *
 * Uses the circumplex model of affect (Russell, 1980) — the standard
 * framework in music-psychology for mapping feeling words to two axes:
 *   valence: negative <-> positive
 *   arousal: low-energy <-> high-energy
 * This is the same academic grounding your spec already leans on for
 * personality->music correlations, applied to free-text mood instead.
 *
 * Approach: a hand-built lexicon (word -> [valence, arousal] in -1..1),
 * negation handling ("not happy" flips valence), then the averaged point
 * is classified into the nearest of 8 labeled octants. Deterministic,
 * explainable, zero network calls.
 */

const LEXICON = {
  // high arousal, positive
  excited: [0.7, 0.9], energetic: [0.6, 0.9], pumped: [0.7, 0.9], hyped: [0.7, 0.9],
  thrilled: [0.8, 0.85], great: [0.7, 0.6], amazing: [0.8, 0.6], happy: [0.75, 0.5],
  motivated: [0.6, 0.7], confident: [0.6, 0.55], stoked: [0.7, 0.8], alive: [0.6, 0.7],
  // high arousal, negative
  angry: [-0.6, 0.8], furious: [-0.7, 0.9], stressed: [-0.6, 0.75], anxious: [-0.55, 0.7],
  overwhelmed: [-0.6, 0.7], panicked: [-0.6, 0.85], frustrated: [-0.55, 0.65], nervous: [-0.4, 0.65],
  irritated: [-0.5, 0.6], restless: [-0.2, 0.65], wired: [-0.1, 0.7],
  // low arousal, positive
  calm: [0.5, -0.5], relaxed: [0.55, -0.6], peaceful: [0.6, -0.6], content: [0.55, -0.4],
  chill: [0.5, -0.5], cozy: [0.5, -0.5], grateful: [0.6, -0.3], mellow: [0.45, -0.55],
  satisfied: [0.5, -0.3], serene: [0.6, -0.6],
  // low arousal, negative
  sad: [-0.6, -0.3], tired: [-0.3, -0.6], exhausted: [-0.4, -0.7], drained: [-0.4, -0.65],
  lonely: [-0.6, -0.3], down: [-0.5, -0.3], bored: [-0.3, -0.5], numb: [-0.4, -0.6],
  melancholic: [-0.5, -0.4], blue: [-0.5, -0.3], low: [-0.5, -0.35], sleepy: [-0.2, -0.7],
  meh: [-0.2, -0.3], flat: [-0.3, -0.4],
  // neutral-ish / cognitive
  focused: [0.3, 0.3], productive: [0.4, 0.4], determined: [0.4, 0.5], curious: [0.4, 0.35],
  fine: [0.2, 0.0], okay: [0.1, 0.0], ok: [0.1, 0.0],
};

const NEGATIONS = new Set(["not", "isn't", "isnt", "aren't", "arent", "don't", "dont", "no", "never", "cant", "can't"]);

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
}

/** Analyze free text -> { valence, arousal, label, words } */
export function analyzeFeeling(text) {
  const tokens = tokenize(text || "");
  let vSum = 0, aSum = 0, hits = 0;
  const matched = [];

  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (!(w in LEXICON)) continue;
    let [v, a] = LEXICON[w];
    const window = tokens.slice(Math.max(0, i - 3), i);
    if (window.some((t) => NEGATIONS.has(t))) v = -v; // "not happy at all" flips valence, keeps arousal
    vSum += v; aSum += a; hits++;
    matched.push(w);
  }

  if (hits === 0) return { valence: 0, arousal: 0, label: "Neutral", words: [] };

  const valence = clamp(vSum / hits);
  const arousal = clamp(aSum / hits);
  return { valence, arousal, label: classify(valence, arousal), words: matched };
}

function clamp(x) { return Math.max(-1, Math.min(1, x)); }

/** Map a (valence, arousal) point to one of 8 octant labels. */
function classify(v, a) {
  if (Math.abs(v) < 0.12 && Math.abs(a) < 0.12) return "Neutral";
  const angle = Math.atan2(a, v); // radians, -PI..PI
  const deg = (angle * 180) / Math.PI;
  if (deg >= -22.5 && deg < 22.5) return "Content";
  if (deg >= 22.5 && deg < 67.5) return "Happy";
  if (deg >= 67.5 && deg < 112.5) return "Energetic";
  if (deg >= 112.5 && deg < 157.5) return "Tense";
  if (deg >= 157.5 || deg < -157.5) return "Down";
  if (deg >= -157.5 && deg < -112.5) return "Drained";
  if (deg >= -112.5 && deg < -67.5) return "Calm";
  return "Mellow"; // -67.5..-22.5
}

/**
 * Combine several bubble-picked labels (each mapped to a representative
 * valence/arousal point) plus optional free text into one averaged point.
 * Lets the user pick more than one feeling at once (e.g. "Tired" + "Hopeful").
 */
const LABEL_POINTS = {
  Energetic: [0.6, 0.9], Happy: [0.75, 0.5], Content: [0.55, 0.1], Calm: [0.55, -0.55],
  Mellow: [0.45, -0.55], Drained: [-0.35, -0.6], Down: [-0.55, -0.3], Tense: [-0.55, 0.7],
};

export function analyzeCombined(selectedLabels = [], freeText = "") {
  const points = selectedLabels
    .filter((l) => l in LABEL_POINTS)
    .map((l) => LABEL_POINTS[l]);

  const textResult = freeText.trim() ? analyzeFeeling(freeText) : null;
  if (textResult && textResult.words.length) points.push([textResult.valence, textResult.arousal]);

  if (points.length === 0) return { valence: 0, arousal: 0, label: "Neutral", words: textResult?.words || [] };

  const valence = clamp(points.reduce((s, p) => s + p[0], 0) / points.length);
  const arousal = clamp(points.reduce((s, p) => s + p[1], 0) / points.length);
  return { valence, arousal, label: classify(valence, arousal), words: textResult?.words || [], selected: selectedLabels };
}

/** Convert arousal into a tempo-band nudge (BPM), for the seed engine.
 * High arousal -> push tempo up; low arousal -> pull it down. Modest range
 * so it nudges, doesn't override, the activity's base band.
 */
export function arousalToBpmShift(arousal) {
  return Math.round(arousal * 15); // -15..+15 BPM
}
