import { test } from "node:test";
import assert from "node:assert/strict";
import { seedTarget, roadTripSeedTarget, discoverSeedTarget, ACTIVITIES } from "./seedEngine.js";

const NEUTRAL = { O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 };

test("ACTIVITIES lists all six activity keys with labels", () => {
  assert.equal(ACTIVITIES.length, 6);
  for (const a of ACTIVITIES) {
    assert.ok(a.key && a.label, "each activity needs a key and a label");
  }
});

test("seedTarget throws on an unknown activity", () => {
  assert.throws(() => seedTarget(NEUTRAL, "not_a_real_activity"), /Unknown activity/);
});

test("seedTarget always returns a valid, searchable BPM band", () => {
  for (const { key } of ACTIVITIES) {
    const t = seedTarget(NEUTRAL, key);
    assert.ok(t.bpmMin < t.bpmMax, `${key}: bpmMin should be less than bpmMax`);
    assert.ok(t.bpmMin >= 40 && t.bpmMax <= 200, `${key}: band should stay within [40,200]`);
    assert.ok(t.bpmMax - t.bpmMin >= 12, `${key}: band should be at least 12 BPM wide`);
  }
});

test("neutral (0.5) traits produce zero personality-driven shift or explain lines", () => {
  const t = seedTarget(NEUTRAL, "workout");
  assert.deepEqual(t.explain, [], "neutral traits should not trigger any trait-based explain line");
});

test("higher Extraversion raises the tempo band vs lower Extraversion", () => {
  const low = seedTarget({ ...NEUTRAL, E: 0.1 }, "workout");
  const high = seedTarget({ ...NEUTRAL, E: 0.9 }, "workout");
  assert.ok(high.bpmMin > low.bpmMin, "higher E should shift the band up");
});

test("high Neuroticism caps the top of the band for stress-adjacent activities only", () => {
  const calm = seedTarget({ ...NEUTRAL, N: 0.9 }, "deep_work");
  const base = seedTarget(NEUTRAL, "deep_work");
  assert.ok(calm.bpmMax < base.bpmMax, "high N should lower the ceiling for deep_work");

  // workout is not in the stress-adjacent activity list — N alone shouldn't move it
  const workoutCalm = seedTarget({ ...NEUTRAL, N: 0.9 }, "workout");
  const workoutBase = seedTarget(NEUTRAL, "workout");
  assert.equal(workoutCalm.bpmMax, workoutBase.bpmMax, "N shouldn't affect non-stress-adjacent activities");
});

test("a mood/weather shift below the 3 BPM threshold is ignored, at/above it is applied", () => {
  const base = seedTarget(NEUTRAL, "commute", 0);
  const tiny = seedTarget(NEUTRAL, "commute", 2);
  const real = seedTarget(NEUTRAL, "commute", 8);
  assert.equal(tiny.bpmMin, base.bpmMin, "a 2 BPM nudge is below the noise threshold and should be dropped");
  assert.equal(real.bpmMin, base.bpmMin + 8, "an 8 BPM nudge should apply in full");
});

test("high Openness widens the seed pool to the full genre list", () => {
  const t = seedTarget({ ...NEUTRAL, O: 0.9 }, "workout");
  assert.equal(t.seedPool.length, 4, "workout has 4 seed genres; high Openness should expose all of them");
});

test("low Openness narrows the seed pool to the most familiar two genres", () => {
  const t = seedTarget({ ...NEUTRAL, O: 0.1 }, "workout");
  assert.equal(t.seedPool.length, 2);
});

test("high Conscientiousness in a vocal-penalty activity prefers instrumental/ambient seeds", () => {
  const t = seedTarget({ ...NEUTRAL, O: 0.9, C: 0.9 }, "deep_work");
  for (const term of t.seedPool) {
    assert.ok(term.includes("instrumental") || term.includes("ambient"), `"${term}" should be instrumental/ambient-flavored`);
  }
});

test("roadTripSeedTarget returns a valid band and is not in the ACTIVITIES chip list", () => {
  const t = roadTripSeedTarget(NEUTRAL);
  assert.ok(t.bpmMin < t.bpmMax);
  assert.ok(t.bpmMin >= 40 && t.bpmMax <= 200);
  assert.equal(ACTIVITIES.some((a) => a.key === "road_trip"), false, "road trip should not appear as a normal activity chip");
});

test("roadTripSeedTarget is unaffected by the stress-adjacent Neuroticism cap", () => {
  const calm = roadTripSeedTarget({ ...NEUTRAL, N: 0.9 });
  const base = roadTripSeedTarget(NEUTRAL);
  assert.equal(calm.bpmMax, base.bpmMax, "road trip isn't a stress-adjacent activity, N alone shouldn't cap it");
});

test("roadTripSeedTarget applies a combined mood+weather+terrain shift the same way seedTarget does", () => {
  const base = roadTripSeedTarget(NEUTRAL, 0);
  const shifted = roadTripSeedTarget(NEUTRAL, 9); // e.g. mountainous terrain's shift
  assert.equal(shifted.bpmMin, base.bpmMin + 9);
});

test("discoverSeedTarget returns a valid band with a wide, deduped cross-activity seed pool", () => {
  const t = discoverSeedTarget({ ...NEUTRAL, O: 0.9 });
  assert.ok(t.bpmMin < t.bpmMax);
  assert.ok(t.bpmMin >= 40 && t.bpmMax <= 200);
  assert.ok(t.seedPool.length > 4, "should span more genres than any single activity's own pool");
  assert.equal(new Set(t.seedPool).size, t.seedPool.length, "seed pool should have no duplicate genres");
});

test("discoverSeedTarget is unaffected by the stress-adjacent Neuroticism cap", () => {
  const calm = discoverSeedTarget({ ...NEUTRAL, N: 0.9 });
  const base = discoverSeedTarget(NEUTRAL);
  assert.equal(calm.bpmMax, base.bpmMax, "discover isn't a stress-adjacent activity, N alone shouldn't cap it");
});
