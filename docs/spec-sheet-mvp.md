# Cadence — Technical Spec Sheet (MVP)

*Reference doc for building a LinkedIn-shareable interactive showcase. Every claim here reflects the actual shipped implementation, not aspirational scope.*

## One-liner

A personality-anchored, context-aware music recommendation app: a Big Five assessment (or skip it entirely) plus activity, mood, weather, time, and place drive a target tempo/energy band; matching tracks are fetched, then re-ranked live from user feedback via a confidence-weighted Bayesian blend.

## Architecture

Two independent projects, no shared build step:

- **`app/`** — Expo / React Native client (SDK 54), tested via Expo Go, no custom dev build required
- **`server/`** — Express backend on Node, deployed on Render, runs the recommendation pipeline

```
Client (Expo/React Native)              Server (Express on Render)
─────────────────────────              ──────────────────────────
Personality onboarding (skip-able) ──┐
Mood check-in (bubbles + text)     ──┤
Device location                    ──┼──► POST /recommend ──► pipeline (below)
Spotify top artists (if connected) ──┘         │
                                                ▼
Bayesian re-ranking (on-device)  ◄────── { target, tracks, reserve, mood, weather, place }
Spotify OAuth + playlist save
Apple Music deep-link handoff
```

### Why the client/server split

Track *discovery* (seed rules, mood analysis, weather, search, BPM enrichment, artist personalization) runs server-side behind a single `POST /recommend` call, so the engine can evolve without an app-store update and third-party API keys never ship in the client bundle.

What stays **on-device**, deliberately:
- **Bayesian re-ranking** — re-sorts already-downloaded tracks on every tap; must be instant, so no network round trip for something that's purely re-sorting local data.
- **Spotify OAuth (PKCE) + playlist save** — needs an in-app browser/redirect.
- **Apple Music deep-link handoff** — no auth needed, just resolves/opens a track URL.

## Recommendation pipeline (server)

1. **Mood analysis** — multi-select bubbles + free text → a valence/arousal point via a hand-built lexicon (circumplex model of affect), with negation handling ("not happy" flips valence, keeps arousal).
2. **Weather + place** — given device coordinates: current temperature/condition/time-of-day (Open-Meteo, free/no-key) nudges tempo; a human-readable place name (BigDataCloud reverse geocoding, free/no-key) feeds the playlist's generated "story."
3. **Seed engine** — deterministic trait × activity rules produce a BPM band + the full genre seed pool for that activity (not just one random pick), each adjustment carrying a human-readable "why."
4. **Cross-genre + personalized discovery** — searches every genre in the seed pool, plus (if Spotify is connected) the user's actual top artists and real similar artists sourced from Last.fm's `artist.getSimilar` — genuine "adjacent artist" data, since Spotify closed its own Related Artists API in Nov 2024.
5. **Quality filtering** — drops stock/library-music junk (generic-titled tracks that flood searches like "workout"), dedupes so no artist repeats, verifies every track actually resolves to a real Apple Music match before it's ever shown.
6. **BPM enrichment** — via GetSongBPM, since the search API itself carries no tempo data.

## Re-ranking math (client)

A confidence-weighted Bayesian blend shifts weight from the personality-derived prior to observed behavior (skips/likes/completions) as evidence accumulates — the live "% personality" figure shown in the UI is literally λ (lambda), the prior's share of the current blend. Weighted feedback types: save (1.0), like (0.8), complete (0.6), late skip (-0.3), fast skip (-0.9). 10 unit tests cover this module directly.

## Key engineering decisions (the "why," not just the "what")

- **Spotify's Nov 2024 API closure** (Audio Features, Recommendations, Related Artists) is why this product doesn't lean on Spotify for discovery at all — Spotify is used only for OAuth playlist-write and reading the user's own top artists (still an open scope).
- **iTunes-only search, not Deezer**: an earlier version blended Deezer (native BPM data) with iTunes fallback. Measured live in production, Deezer-sourced tracks failed Apple Music cross-catalog verification 75–100% of the time for instrumental/ambient genres — different platforms distribute different masters of the same recording under different ISRCs. iTunes tracks carry their Apple Music URL directly from the same search that found them, so they're verified by construction with zero failure rate. This is why every track in the app is guaranteed to open correctly in Apple Music.
- **Apple Music matching, when a fallback is needed**: never trusts a search API's top result blindly — validates against the actual artist name across the top 5 candidates, since a naive single-result search on a generic title can confidently return a completely different, wrong song.
- **Session-banner generative art is pure React Native primitives** (`View`/`Animated`, `hsl()` color strings) — deliberately zero new native dependencies for the visual layer, to stay Expo-Go-compatible after two earlier native-dependency/SDK-mismatch incidents in this project's history.
- **Playlist cover art** is captured directly from the in-app session banner (`react-native-view-shot`, confirmed officially bundled in Expo Go) and uploaded as the actual Spotify playlist cover — what you see in the app is what shows up on Spotify.

## Tech stack

| Layer | Technology |
|---|---|
| Client | Expo / React Native (SDK 54), AsyncStorage for local persistence |
| Backend | Node.js / Express, deployed on Render |
| Auth | Spotify OAuth 2.0 (Authorization Code + PKCE, no client secret) |
| Music search | Apple iTunes Search API (free, no key) |
| BPM data | GetSongBPM API |
| Similar artists | Last.fm `artist.getSimilar` |
| Weather | Open-Meteo (free, no key) |
| Reverse geocoding | BigDataCloud (free, no key) |
| Cover art capture | react-native-view-shot |
| Testing | Node's built-in test runner (`node --test`), zero external test framework |

## Testing & CI

28 unit tests across the pure-math modules (Bayesian blending, seed targeting, mood/valence-arousal analysis) — the parts of the app where correctness actually matters most and is cheapest to verify without mocking network calls. CI runs both packages' suites on every push via GitHub Actions.

## Status

Working prototype, running on a physical phone via Expo Go, backend live on Render.
