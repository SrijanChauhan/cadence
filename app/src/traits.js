/**
 * Cadence — shared Big Five (OCEAN) trait metadata.
 * Used by both OnboardingScreen's results screen (right after taking the
 * quiz) and TraitGraph.js (Profile's "view my OCEAN graph again" screen),
 * so the two don't drift out of sync with separate copies of the same
 * trait names/descriptions.
 */
export const TRAITS = [
  { key: "O", name: "Openness", sub: "imagination · variety" },
  { key: "C", name: "Conscientiousness", sub: "order · follow-through" },
  { key: "E", name: "Extraversion", sub: "energy · sociability" },
  { key: "A", name: "Agreeableness", sub: "warmth · cooperation" },
  { key: "N", name: "Neuroticism", sub: "emotional sensitivity" },
];

export const DESC = {
  O: { hi: "Drawn to novelty, texture, the unfamiliar.", mid: "Open to new sounds, anchored by favorites.", lo: "Prefers the familiar and the proven." },
  C: { hi: "Structured; likes order and clean momentum.", mid: "Balances routine with room to drift.", lo: "Spontaneous; goes where the moment leads." },
  E: { hi: "Energized by people and forward motion.", mid: "Comfortable in company or solitude.", lo: "Recharges in quieter, low-key settings." },
  A: { hi: "Tuned into others; warm and cooperative.", mid: "Considerate, with a mind of your own.", lo: "Direct, skeptical, independent-minded." },
  N: { hi: "Feels things intensely; moods shift.", mid: "Steady, with the occasional swing.", lo: "Even-keeled and hard to rattle." },
};

export const bucket = (p) => (p >= 60 ? "hi" : p <= 40 ? "lo" : "mid");
