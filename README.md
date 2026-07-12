# Cadence

Personality-anchored, activity-aware music recommendations that sharpen with every listen — and now also read the room: your stated mood, local weather, place, and time of day.

Cadence runs a short Big Five personality assessment (or skip it entirely), maps your trait profile plus a stated activity (deep work, calls, creative, commute, workout, wind-down) to a target tempo/energy band, pulls matching tracks from real artists across every genre in that band — including artists and similar artists you actually listen to on Spotify — and re-ranks them live from your feedback (skips, likes, completions). Favourited tracks build a queue you can save as a real Spotify playlist, with a description that tells the story of the session it came from.

## Status
Working prototype: Expo app (physical phone via Expo Go) + a small Express backend deployed on Render.
- Onboarding → recommendation → feedback loop: working. Personality can be skipped in favour of mood/weather/time alone.
- In-app 30s preview playback with auto-advancing queue: working.
- Save favourited queue as a real Spotify playlist (full songs), with a humanized description of the session: working.
- Full-song playback *inside* the app: needs a dev build — see `app/V3-ACTION-PLAN.md`.

## How it works
1. **Assessment (optional)** — Mini-IPIP (20 items, public-domain Big Five short form) → normalized OCEAN vector. A skip option at the bottom of onboarding saves a neutral vector instead, which mathematically produces zero personality-driven shift in the seed engine — the playlist is then driven by activity + mood + weather + time alone.
2. **Mood** — a one-time-per-session prompt (multi-select bubbles + free text) analyzed on-device-equivalent logic on the backend via a hand-built valence/arousal lexicon (circumplex model of affect), with negation handling.
3. **Weather + place** — given device location, the backend pulls current conditions (Open-Meteo, free/no-key) and a human place name (BigDataCloud reverse geocoding, free/no-key), both folding into the tempo nudge and the playlist's story.
4. **Seed engine** — trait vector × activity × mood/weather → target tempo band + the full genre seed pool for that activity (not just one random pick), with a human-readable "why" per adjustment.
5. **Cross-genre discovery** — the backend searches every genre in the seed pool, plus (if Spotify is connected) your real top Spotify artists and their real similar artists via Last.fm — genuine "adjacent artist" data, since Spotify closed its own Related Artists API in Nov 2024 and iTunes never had one. Results are merged, filtered for stock/library-music junk (generic-titled tracks that flood searches like "workout"), deduped so no artist repeats, and sorted by BPM proximity. Tries Deezer first (has BPM natively), falls back to Apple's iTunes Search API where Deezer's catalog is territory-blocked (e.g. from India) — iTunes tracks get BPM filled in via GetSongBPM.
6. **Re-ranking** — a confidence-weighted Bayesian blend (stays on-device — it's just re-sorting already-downloaded tracks, no need for a network round trip) shifts weight from the personality prior to observed behaviour as feedback accumulates; the current prior weight (λ) is shown live. See `docs/technical-appendix-bayesian-blending.md`.
7. **Queue + save** — favourites form a queue (persisted per mode on-device); one tap creates a real Spotify playlist via PKCE auth, named `Cadence.Activity.Mood` with a description narrating when/where/how it was made.

## Repo layout
- `app/` — the Expo / React Native client
  - `App.js` — personality profile persistence + skip flow
  - `src/OnboardingScreen.js`, `src/PlaylistScreen.js`
  - `src/engine/` — `bayes` (re-ranking, stays on-device), `spotify` (OAuth + playlist save + top-artist fetch, stays on-device), `appleMusic` (single-track deep link)
  - `src/config.js` — points the client at the deployed backend URL
  - `V3-ACTION-PLAN.md` — path to full-song in-app playback (Spotify Remote SDK + dev build)
- `server/` — the Express backend (deploy target: Render, see `server/DEPLOY.md`)
  - `index.js` — the `POST /recommend` pipeline
  - `engine/` — `seedEngine`, `moodEngine`, `weather`, `musicProvider` (cross-genre search, junk filter, dedup), `deezer`, `itunes`, `getSongBpm`, `lastfm`
- `docs/` — product spec and technical appendices

## Docs
- `docs/product-spec-v0.2.md` — product spec (predates the backend migration — architecture details there are stale, trait/activity model is still accurate).
- `docs/music-data-layer.md` — provider evaluation; why Spotify's feature endpoints and Deezer's India catalog are both unavailable, and the fallbacks used.
- `docs/technical-appendix-bayesian-blending.md` — the prior/posterior blend that fades personality as evidence grows.
- `docs/technical-appendix-cross-bucket-transfer.md` — trait-mediated transfer for sparse activity buckets.
- `docs/musickit-integration-spec.md` — Apple Music full-playback path (deferred).
- `server/DEPLOY.md` — how to deploy the backend to Render, including required env vars.

## Run it

**Backend** (needs to be deployed or running locally first — see `server/DEPLOY.md`):
```
cd server
npm install
npm start
```

**App**, pointed at your backend URL in `app/src/config.js`:
```
cd app
npm install
npx expo start --tunnel
```
Scan the QR with Expo Go on a physical phone.

## Tests
Both packages use Node's built-in test runner, covering the pure recommendation math (Bayesian blending, seed targeting, mood analysis):
```
cd app && npm test
cd server && npm test
```

## Music-data findings (validated during build)
- **Spotify** closed its recommendation/audio-feature/related-artist endpoints to new apps (Nov 2024); playlist-write and top-artists (`user-top-read`) remain open and require Premium for playback-affecting features.
- **Deezer** returns an empty catalog for India IPs (territory block) but works fine from Render's servers — so it's often the live source in production even though local development in India falls back to iTunes.
- **iTunes Search API** is the working fallback: free, no auth, India catalog, 30s previews, direct Apple Music links — no BPM (filled in via GetSongBPM) and no ISRC (the public Lookup API doesn't expose one, despite some older docs claiming otherwise — verified against a live response).
- **Last.fm** is the free source for real similar-artist data now that Spotify's is gone — `artist.getSimilar`, free API key for personal use.

## Known limitations
- Full songs play only after saving to Spotify (or via the deferred in-app dev-build path); in-app playback is 30s previews.
- iTunes-sourced tracks lack ISRC (Spotify matching is by title+artist, so expect some misses).
- Apple Music listening-history personalization isn't built — needs a paid Apple Developer Program account + hosted MusicKit auth page. `app/src/engine/appleMusic.js` only does one-way ISRC/URL deep-linking, no auth.
- Render's free tier sleeps after 15 minutes idle; the first request after that takes 30-60s to wake up.
