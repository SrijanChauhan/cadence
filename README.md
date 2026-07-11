# Cadence

Personality-anchored, activity-aware music recommendations that sharpen with every listen.

Cadence uses a short Big Five personality quiz plus a stated activity (deep work, calls, creative, commute, workout, wind-down) to seed a playlist, then re-ranks over time using listening feedback (skips, replays, saves, completion). It sits on top of a third-party music-data layer — **Deezer** as the primary source (public API with BPM + ISRC + previews), with **Apple Music / MusicKit** for full playback as a fast-follow.

## Repo layout
- `docs/` — product spec and technical appendices
- `app/` — onboarding personality assessment (Expo / React Native)

## Docs
- [`docs/product-spec-v0.2.md`](docs/product-spec-v0.2.md) — current spec (Deezer-primary data layer)
- [`docs/product-spec-v0.1.md`](docs/product-spec-v0.1.md) — original spec (Spotify-based; superseded, kept for history)
- [`docs/music-data-layer.md`](docs/music-data-layer.md) — why Spotify's API closure forced a data-layer change, and the platforms replacing it
- [`docs/technical-appendix-bayesian-blending.md`](docs/technical-appendix-bayesian-blending.md) — confidence-weighted prior/posterior blending (cold-start → warm-start)
- [`docs/technical-appendix-cross-bucket-transfer.md`](docs/technical-appendix-cross-bucket-transfer.md) — trait-mediated within-user transfer for sparse activity buckets

## App
See [`app/README.md`](app/README.md) to run the assessment locally or build an APK via EAS.

## Status
Pre-build. Spec + technical appendices complete; onboarding assessment scaffolded. Music-data spike (Deezer + Apple Music) is the next step before building the playlist screen.
