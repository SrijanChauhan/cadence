import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFeeling, analyzeCombined, arousalToBpmShift } from "./moodEngine.js";

test("analyzeFeeling on empty/no-match text returns Neutral with no shift", () => {
  const r = analyzeFeeling("");
  assert.deepEqual(r, { valence: 0, arousal: 0, label: "Neutral", words: [] });

  const r2 = analyzeFeeling("the quick brown fox");
  assert.equal(r2.label, "Neutral");
  assert.deepEqual(r2.words, []);
});

test("analyzeFeeling picks up known mood words with the right sign", () => {
  const r = analyzeFeeling("I feel happy and excited");
  assert.ok(r.words.includes("happy"));
  assert.ok(r.words.includes("excited"));
  assert.ok(r.valence > 0, "happy/excited should be positive valence");
  assert.ok(r.arousal > 0, "happy/excited should be high arousal");
});

test("negation flips valence but keeps arousal (\"not happy\" isn't sad-and-calm)", () => {
  const plain = analyzeFeeling("happy");
  const negated = analyzeFeeling("not happy");
  assert.ok(plain.valence > 0);
  assert.ok(negated.valence < 0, "negated valence should flip sign");
  assert.equal(negated.arousal, plain.arousal, "negation shouldn't touch arousal");
});

test("analyzeCombined with no labels and no text is Neutral", () => {
  const r = analyzeCombined([], "");
  assert.equal(r.label, "Neutral");
  assert.equal(r.valence, 0);
  assert.equal(r.arousal, 0);
});

test("analyzeCombined with a single bubble label uses that label's exact point", () => {
  const r = analyzeCombined(["Energetic"], "");
  assert.equal(r.valence, 0.6);
  assert.equal(r.arousal, 0.9);
  assert.deepEqual(r.selected, ["Energetic"]);
});

test("analyzeCombined averages multiple bubble labels together", () => {
  const r = analyzeCombined(["Down", "Energetic"], "");
  // Down: [-0.55, -0.3], Energetic: [0.6, 0.9] -> average
  assert.ok(Math.abs(r.valence - (-0.55 + 0.6) / 2) < 1e-9);
  assert.ok(Math.abs(r.arousal - (-0.3 + 0.9) / 2) < 1e-9);
});

test("analyzeCombined ignores unrecognized bubble labels", () => {
  const r = analyzeCombined(["NotARealMood"], "");
  assert.equal(r.label, "Neutral");
});

test("arousalToBpmShift maps -1..1 to a -15..15 BPM nudge", () => {
  assert.equal(arousalToBpmShift(1), 15);
  assert.equal(arousalToBpmShift(-1), -15);
  assert.equal(arousalToBpmShift(0), 0);
});
