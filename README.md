# Cadence

Personality-anchored, activity-aware music recommendations that sharpen with every listen.

Cadence sits on top of the Spotify/Apple Music APIs. It uses a short Big Five personality quiz plus a stated activity (deep work, calls, creative, commute, workout, wind-down) to seed a playlist, then re-ranks over time using listening feedback (skips, replays, saves, completion).

## Status
Pre-build. Spec only — no code yet.

## Docs
- [`docs/product-spec-v0.1.md`](docs/product-spec-v0.1.md) — full product spec: problem, goals, core loop, feature breakdown (P0/P1/P2), recommendation engine design, risks, phasing.

## Key open risk
Spotify Developer Terms may restrict recommendation-layer use cases on top of their API — needs a ToS check before build starts.
