/**
 * Cadence — personality type label
 * Turns the OCEAN vector into a short two-word type, e.g. "Curious & Social",
 * by taking the two traits furthest from neutral (0.5) and combining their
 * high/low descriptor. Skipped-onboarding users land on exactly {0.5 x5}
 * (see App.js's skipPersonality) — zero deviation on every trait — so that
 * exact case is special-cased rather than showing an arbitrary/misleading type.
 */
const DESCRIPTORS = {
  O: { hi: "Curious", lo: "Grounded" },
  C: { hi: "Structured", lo: "Spontaneous" },
  E: { hi: "Social", lo: "Reflective" },
  A: { hi: "Warm", lo: "Direct" },
  N: { hi: "Sensitive", lo: "Steady" },
};

export function personalityType(traits) {
  if (!traits) return "Unassessed";
  const deviations = Object.keys(DESCRIPTORS).map((k) => ({ key: k, dev: Math.abs(traits[k] - 0.5) }));
  const maxDev = Math.max(...deviations.map((d) => d.dev));
  if (maxDev < 0.02) return "Balanced"; // effectively neutral on every trait — includes the skipped-onboarding case

  const top2 = deviations.sort((a, b) => b.dev - a.dev).slice(0, 2);
  const words = top2.map(({ key }) => (traits[key] >= 0.5 ? DESCRIPTORS[key].hi : DESCRIPTORS[key].lo));
  return words.join(" & ");
}
