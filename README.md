# Cadence

Personality-anchored, activity-aware music recommendations that sharpen with every listen.

Cadence runs a short Big Five personality assessment, maps your trait profile plus a stated activity (deep work, calls, creative, commute, workout, wind-down) to a target tempo/energy band, pulls matching tracks, and re-ranks them live from your feedback (skips, likes, completions). Favourited tracks build a queue you can save as a real playlist in Spotify.

## Status
Working prototype, runs on a physical phone via Expo Go.
- Onboarding → recommendation → feedback loop: working.
- In-app 30s preview playback with auto-advancing queue: working.
- Save favourited queue as a real Spotify playlist (full songs): working.
- Full-song playback *inside* the app: needs a dev build — see `app/V3-ACTION-PLAN.md`.

## How it works
1. **Assessment** — Mini-IPIP (20 items, public-domain Big Five short form) → normalized OCEAN vector.
2. **Seed engine** — trait vector × activity → target tempo band + genre seed terms, with a human-readable "why" per adjustment (e.g. tempo raised for higher Extraversion; instrumental-only for high Conscientiousness in focus modes).
3. **Music data layer** — provider abstraction: tries Deezer (has BPM), auto-falls back to Apple's iTunes Search API where Deezer's catalog is territory-blocked (e.g. India). See `docs/music-data-layer.md`.
4. **Re-ranking** — a confidence-weighted Bayesian blend shifts weight from the personality prior to observed behaviour as feedback accumulates; the current prior weight (λ) is shown live. See `docs/technical-appendix-bayesian-blending.md`.
5. **Queue + save** — favourites form a queue (persisted per mode on-device); one tap creates a real Spotify playlist via PKCE auth.

## Repo layout
- `app/` — the Expo / React Native app
  - `src/OnboardingScreen.js`, `src/PlaylistScreen.js`
  - `src/engine/` — `seedEngine`, `bayes`, `musicProvider`, `deezer`, `itunes`, `spotify`, `appleMusic`
  - `V3-ACTION-PLAN.md` — path to full-song in-app playback (Spotify Remote SDK + dev build)
- `docs/` — product spec and technical appendices

## Docs
- `docs/product-spec-v0.2.md` — current spec (Deezer-primary, iTunes fallback).
- `docs/music-data-layer.md` — provider evaluation; why Spotify's feature endpoints and Deezer's India catalog are both unavailable, and the fallbacks used.
- `docs/technical-appendix-bayesian-blending.md` — the prior/posterior blend that fades personality as evidence grows.
- `docs/technical-appendix-cross-bucket-transfer.md` — trait-mediated transfer for sparse activity buckets.
- `docs/musickit-integration-spec.md` — Apple Music full-playback path (deferred).

## Run it
```
cd app
npm install
npx expo install @react-native-async-storage/async-storage expo-crypto expo-web-browser expo-av
npx expo start --tunnel
```
Scan the QR with Expo Go on a physical phone.

## Music-data findings (validated during build)
- **Spotify** closed its recommendation/audio-feature endpoints to new apps (Nov 2024); playlist-write remains open and requires Premium.
- **Deezer** returns an empty catalog for India IPs (territory block), so it can't be the primary source there.
- **iTunes Search API** is the working fallback: free, no auth, India catalog, 30s previews, direct Apple Music links — but no BPM, so the learning loop pauses on iTunes-sourced tracks until a tempo source is added.

## Known limitations
- Full songs play only after saving to Spotify (or via the deferred in-app dev-build path); in-app playback is 30s previews.
- iTunes-sourced tracks lack BPM (λ won't fall) and lack ISRC (Spotify matching is by title+artist, so expect some misses).
