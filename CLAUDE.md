# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Cadence: a Big Five personality assessment + activity + mood + weather drive a target
tempo/energy band; matching tracks are fetched, then re-ranked live from user feedback
(skips/likes/completions) via a confidence-weighted Bayesian blend. Favourited tracks
form a queue the user can save as a real Spotify playlist.

Two independent Node projects, no root `package.json` — always `cd` into one before
running npm commands:
- `app/` — Expo / React Native client
- `server/` — Express backend (the recommendation pipeline)

Both projects have a `test` script (Node's built-in test runner, `node --test`,
auto-discovers `*.test.js`/`*.test.mjs`) covering the pure recommendation math —
`app/src/engine/bayes.test.mjs`, `server/engine/seedEngine.test.js`,
`server/engine/moodEngine.test.js`. No lint tooling configured. CI
(`.github/workflows/node.js.yml`) runs both test suites via separate jobs with
`working-directory` set per package.

## Commands

Backend (must be running, or point `app/src/config.js` at a deployed instance):
```
cd server
npm install
npm start                 # listens on $PORT or 3000
curl localhost:3000/health   # sanity check
```

App:
```
cd app
npm install
npx expo start --tunnel   # or `npx expo start` on the same network
```
Scan the QR with **Expo Go** on a physical phone. Full in-app song playback (as
opposed to 30s previews) requires an Expo dev build, not Expo Go — see
`app/V3-ACTION-PLAN.md` before attempting that path.

Backend deploy is Render (see `server/DEPLOY.md`); free tier sleeps after 15 min idle.
Required server env vars: `GETSONGBPM_KEY`, `LASTFM_API_KEY` (both optional — each
feature they power degrades gracefully to a no-op if unset, never crashes).

## Architecture

### Split between client and server

Track *discovery* (seed rules, mood analysis, weather, Deezer/iTunes search, BPM
enrichment, Last.fm similar-artist blending) runs server-side behind a single
`POST /recommend` call — see `server/index.js`. The app sends `{ traits, activity,
moodLabels, moodText, lat, lon, spotifyArtists, limit }` and gets back `{ target,
tracks, reserve, mood, weather, place, diag }`.

What deliberately stays **on-device** in `app/src/`:
- **Bayesian re-ranking** (`engine/bayes.js`) — re-sorts already-downloaded tracks on
  every tap; must be instant, so no round trip for something that's just re-sorting
  local data.
- **Spotify OAuth (PKCE) + playlist save** (`engine/spotify.js`) — needs an in-app
  browser/redirect.
- **Apple Music deep-link handoff** (`engine/appleMusic.js`) — no auth needed, just
  resolves/opens a track URL.

### `app/src/engine/` only has three files — that's correct, not a gap

`bayes.js`, `spotify.js`, and `appleMusic.js` are the only files here, and that's all
`PlaylistScreen.js` imports from `./engine`. Earlier pre-server-migration leftovers
(`deezer.js`, `itunes.js`, `getSongBpm.js` — including a hardcoded GetSongBPM API key it
leaked into the client bundle, which needs to be rotated at getsongbpm.com if that
hasn't happened yet — `moodEngine.js`, `musicProvider.js`, `seedEngine.js`,
`musicbrainzIsrc.js`, `appleMusicLibrary.js`) were deleted once confirmed unused. The
live implementations of seed rules, mood analysis, and music-provider search are
exclusively in `server/engine/`. If you're looking for one of those names and it's not
in `server/engine/` either, it was scaffolding that never got wired in — check git
history before recreating it.

### Server recommendation pipeline (`server/index.js` → `server/engine/`)

1. `moodEngine.analyzeCombined` — mood-bubble labels + free text → circumplex
   (valence, arousal) point → BPM nudge.
2. `weather.fetchWeather`/`weatherToBpmShift` (Open-Meteo, no key) — temp/condition/
   time-of-day → BPM nudge. `fetchPlaceName` (BigDataCloud) reverse-geocodes for the
   playlist "story" description.
3. `seedEngine.seedTarget(traits, activity, combinedShift)` — deterministic trait×activity
   rules produce a BPM band + a personality-filtered `seedPool` of genre/style terms,
   each with a human-readable `explain` string. This is the cold-start target only;
   `bayes.js` (client-side) shifts it as feedback accumulates.
4. `lastfm.getSimilarArtists` — real adjacent-artist data for the user's top Spotify
   artists (sent up by the client via `spotifyArtists`), since Spotify closed its own
   Related-Artists/recommendations endpoints in Nov 2024. Silently returns `[]` without
   `LASTFM_API_KEY` or on any failure.
5. `musicProvider.searchAcrossGenres` — searches *every* term in the combined seed pool
   (activity genres + real top artists + real similar artists), not one random pick;
   merges, drops stock/library-music junk (`isGenericTitle` heuristic — see its comment
   for why title-word matching beats artist-name matching here) and repeat artists,
   sorts by BPM proximity to the target band.
6. `musicProvider.searchTracks` picks a track source per session and sticks with it:
   tries Deezer first (has native BPM); if Deezer returns an empty catalog (the
   signature of a territory block, e.g. India), falls back to iTunes Search
   (`itunes.js`, no BPM/ISRC) and enriches BPM via GetSongBPM (`getSongBpm.js`,
   requires `GETSONGBPM_KEY`, cached in-memory per title|artist). See
   `docs/music-data-layer.md` for the full provider-evaluation rationale.

The server returns more tracks than requested (`reserve`) so the client can swap in a
replacement when a track is removed, without another round trip.

### Client re-ranking + playback (`app/src/PlaylistScreen.js`)

- Per-activity Bayesian bucket state (`bayes.js`, one prior per activity) persists in
  `AsyncStorage` under `cadence:bayes:{activity}`; `posterior()`'s `lambda` is the
  fraction of the BPM target still attributable to the personality prior vs. observed
  feedback, and is shown live in the UI. Implementation follows
  `docs/technical-appendix-bayesian-blending.md`.
- Favourited-track queues persist per activity under `cadence:queue:{activity}` and are
  merged back in on next load of that activity.
- The personality vector itself persists in `App.js` under `AsyncStorage` key
  `cadence:profile`; onboarding can be skipped entirely by submitting neutral
  `{O,C,E,A,N: 0.5}` traits — `seedTarget`'s formulas are all `(trait - 0.5) * k`, so
  0.5 is a true no-op and the pipeline runs on activity/mood/weather alone.
- Spotify is connected *before* the first recommend call (not lazily from the Save
  button) specifically so `getTopArtists()` has data to send up for the artist/
  similar-artist blend on the very first session, not just on save.

### Docs worth reading before touching the engine

- `docs/product-spec-v0.2.md` — current product spec (Deezer-primary, iTunes fallback).
- `docs/music-data-layer.md` — why Spotify's audio-features/recommendations endpoints
  and Deezer's India catalog are both unavailable, and what fills the gap.
- `docs/technical-appendix-bayesian-blending.md` — the prior/posterior BPM blend math.
- `docs/technical-appendix-cross-bucket-transfer.md` — trait-mediated transfer for
  activities with sparse feedback.
