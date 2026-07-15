import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFromElevations, TERRAIN_BPM_SHIFT } from "./routing.js";

test("classifyFromElevations reads flat for a near-constant elevation profile", () => {
  const elevations = [100, 102, 99, 101, 100]; // trivial noise, no real grade
  assert.equal(classifyFromElevations(elevations, 50), "flat");
});

test("classifyFromElevations reads mountainous for large swings over a short distance", () => {
  const elevations = [200, 800, 300, 900, 250]; // big climbs/descents packed into a short route
  assert.equal(classifyFromElevations(elevations, 20), "mountainous");
});

test("classifyFromElevations reads rolling for a moderate, in-between grade", () => {
  const elevations = [200, 260, 220, 270, 230];
  assert.equal(classifyFromElevations(elevations, 20), "rolling");
});

test("classifyFromElevations defaults to flat with fewer than two points", () => {
  assert.equal(classifyFromElevations([100], 10), "flat");
  assert.equal(classifyFromElevations([], 10), "flat");
  assert.equal(classifyFromElevations(null, 10), "flat");
});

test("TERRAIN_BPM_SHIFT is non-negative and increases with terrain roughness", () => {
  assert.equal(TERRAIN_BPM_SHIFT.flat, 0);
  assert.ok(TERRAIN_BPM_SHIFT.rolling > TERRAIN_BPM_SHIFT.flat);
  assert.ok(TERRAIN_BPM_SHIFT.mountainous > TERRAIN_BPM_SHIFT.rolling);
});
