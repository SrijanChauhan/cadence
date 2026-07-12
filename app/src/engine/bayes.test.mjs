import { test } from "node:test";
import assert from "node:assert/strict";
import { newBucketState, updateBucket, posterior, rankTracks, FEEDBACK_WEIGHTS } from "./bayes.js";

test("newBucketState seeds the prior with zero evidence", () => {
  const s = newBucketState(120);
  assert.deepEqual(s, { mu0: 120, n: 0, runningMean: 120, M2: 0 });
});

test("updateBucket ignores tracks with no BPM (can't learn from unknown tempo)", () => {
  const s0 = newBucketState(120);
  const s1 = updateBucket(s0, null, "like");
  assert.deepEqual(s1, s0);
});

test("updateBucket ignores unweighted/unknown feedback types", () => {
  const s0 = newBucketState(120);
  const s1 = updateBucket(s0, 140, "some_unknown_type");
  assert.deepEqual(s1, s0);
});

test("updateBucket's first full-weight observation sets the running mean exactly (n starts at 0)", () => {
  const s0 = newBucketState(120);
  const s1 = updateBucket(s0, 140, "save");
  assert.equal(s1.runningMean, 140);
  assert.equal(s1.n, FEEDBACK_WEIGHTS.save);
});

test("updateBucket blends subsequent observations partially, not a full jump", () => {
  const s1 = updateBucket(newBucketState(120), 140, "save"); // runningMean -> 140
  const s2 = updateBucket(s1, 100, "save");
  assert.ok(s2.runningMean > 100 && s2.runningMean < 140, "second observation should land between the two BPMs, not jump straight to 100");
});

test("updateBucket moves the running mean AWAY from the track BPM on negative feedback", () => {
  const s0 = newBucketState(120);
  const s1 = updateBucket(s0, 140, "skip_fast");
  assert.ok(s1.runningMean < s0.runningMean, "a fast skip at 140 should push the preferred tempo down, away from 140");
});

test("posterior with zero evidence trusts the prior completely", () => {
  const s = newBucketState(120);
  const { muPost, lambda } = posterior(s);
  assert.equal(muPost, 120);
  assert.equal(lambda, 1);
});

test("posterior's lambda (personality-prior share) decays as evidence accumulates", () => {
  let s = newBucketState(120);
  const { lambda: lambda0 } = posterior(s);
  for (let i = 0; i < 20; i++) s = updateBucket(s, 150, "save");
  const { lambda: lambda1, muPost } = posterior(s);
  assert.ok(lambda1 < lambda0, "lambda should shrink as more consistent evidence comes in");
  assert.ok(muPost > 120, "posterior mean should have shifted toward the observed 150 BPM feedback");
});

test("rankTracks sorts tracks closer to the posterior BPM target higher", () => {
  const state = newBucketState(120); // muPost == 120 with zero evidence
  const tracks = [
    { id: "far", bpm: 200, rank: 0 },
    { id: "near", bpm: 122, rank: 0 },
    { id: "mid", bpm: 150, rank: 0 },
  ];
  const ranked = rankTracks(tracks, state);
  assert.deepEqual(ranked.map((t) => t.id), ["near", "mid", "far"]);
});

test("rankTracks treats unknown-BPM tracks as a fixed mid-confidence score, not last resort", () => {
  const state = newBucketState(120);
  const tracks = [
    { id: "way-off", bpm: 200, rank: 0 },
    { id: "unknown", bpm: null, rank: 0 },
  ];
  const ranked = rankTracks(tracks, state);
  assert.equal(ranked[0].id, "unknown", "an unknown-BPM track should outrank a track far outside the target band");
});
