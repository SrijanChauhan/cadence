import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTopArtists } from "./musicProvider.js";

// Only the "real artists fully cover the limit" path is exercised here —
// it's the one part of pickTopArtists that's pure/synchronous (no iTunes
// network calls needed once realArtists alone reaches the limit), so it's
// the only part that can be unit-tested without hitting a live API.

test("pickTopArtists returns real artists as-is when they already fill the limit", async () => {
  const realArtists = ["Tame Impala", "Frank Ocean", "Radiohead"];
  const picks = await pickTopArtists({ seedPool: [], realArtists, limit: 3 });
  assert.deepEqual(picks, realArtists);
});

test("pickTopArtists dedupes real artists case-insensitively", async () => {
  const realArtists = ["Tame Impala", "tame impala", "Frank Ocean"];
  const picks = await pickTopArtists({ seedPool: [], realArtists, limit: 5 });
  assert.deepEqual(picks, ["Tame Impala", "Frank Ocean"]);
});

test("pickTopArtists caps at limit even with more real artists available", async () => {
  const realArtists = ["A", "B", "C", "D", "E"];
  const picks = await pickTopArtists({ seedPool: [], realArtists, limit: 2 });
  assert.deepEqual(picks, ["A", "B"]);
});

test("pickTopArtists with no real artists and no seed pool returns empty", async () => {
  const picks = await pickTopArtists({ seedPool: [], realArtists: [], limit: 5 });
  assert.deepEqual(picks, []);
});
