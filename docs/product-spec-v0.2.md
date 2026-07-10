# Cadence — Product Spec v0.2
*Personality-anchored, activity-aware music recommendations that sharpen with every listen*
*(codename, not final branding)*

> **Revision note (v0.1 → v0.2):** Spotify's `audio-features`, `audio-analysis`, `recommendations`, and `related-artists` endpoints were closed to new apps on 27 Nov 2024, and extended access now requires a 250k-MAU organization — unavailable to a new product. The seed engine has been re-based onto a **Deezer-primary** data layer (public API exposes BPM + ISRC + preview clips, no auth). See `docs/music-data-layer.md` for the full evaluation. The personality, Bayesian-blending, and cross-bucket-transfer logic are unchanged — only the music-data source moved.

**North star:** skip-rate declines session-over-session within an activity bucket, without manual re-tagging.

## Problem & Why Now
- **Cold start is generic.** Spotify/Apple/YouTube personalize from listening history and real-time mood/context signals — powerful, but built entirely on behavior. New users, new devices, or a shift in activity all reset to bland defaults.
- **No trait anchor.** None of the major platforms ask *who you are* before recommending — everything is inferred, nothing is declared.
- **Gap to fill:** a layer that starts from personality + stated activity, then hands off to behavior-driven learning as data accumulates — cold-start speed now, long-run accuracy later.

## Goals / Non-Goals
- **Goal:** meaningfully better first-session recommendations than pure collaborative filtering, improving continuously via feedback.
- **Goal:** personality's influence fades as behavioral signal grows — it's a bootstrap, not a permanent label.
- **Non-goal (v1):** new streaming catalog or playback infra — sits on top of a third-party music-data layer (Deezer primary; Apple Music for playback where needed).
- **Non-goal (v1):** replacing existing mood features — this is a complementary layer.

## Core Loop
```mermaid
flowchart TD
    A[Onboarding: personality quiz] --> B[Activity tag: what user is doing now]
    B --> C[Rules engine: trait x activity -> target tempo/energy band]
    C --> G[Deezer search + BPM filter -> candidate tracks]
    G --> D[Seed playlist served]
    D --> E[Feedback: skip / replay / save / completion]
    E --> F[Re-ranking: bandit shifts weight from prior to behavior]
    F --> D
```

## Feature Breakdown

**P0 — MVP**
- **Personality quiz:** Big Five-based, 10–15 items, ~2 min — more psychometrically defensible than MBTI for this use case
- **Activity tag:** manual selector (deep work / calls / creative / commute / workout / wind-down)
- **Seed engine:** rules mapping {trait scores × activity} → target **tempo/energy band**, resolved against **Deezer's public search API** (BPM exposed per track); richer features (mood, valence) derived from preview clips (Essentia/librosa) or a third-party analysis API (Cyanite) only if needed
- **Playback:** 30s Deezer previews for MVP validation; full playback via Apple Music / MusicKit as a fast-follow (iOS/Android/Web). Not rebuilt.
- **Cross-platform join:** ISRC used as the key to match the same recording across Deezer, Apple Music, and any analysis API
- **Feedback capture:** skip, replay, save, completion %, thumbs up/down
- **Adaptive re-ranking:** bandit model; personality-prior weight decays as behavioral data accumulates

**P1**
- **Auto-activity detection:** calendar/location/motion inference; manual tag becomes override, not requirement
- **Per-activity taste vectors:** separate learned profile per activity bucket instead of one global taste
- **Trait re-calibration:** periodic short re-test; any silent trait drift from behavior must stay visible/editable to the user — trust risk otherwise

**P2**
- **Wearable signal:** heart rate/stress input for real-time energy tuning
- **Explainability:** "why this track" surfaced (trait + activity + feature)
- **Social layer:** opt-in taste comparison with friends

## Recommendation Engine
- **Cold start:** deterministic rules engine (OCEAN scores × activity → audio-feature vector) — cheap, explainable
- **Warm state:** contextual bandit (e.g. LinUCB); context = activity + time + recent skips, reward = engagement signal
- **Long run:** collaborative filtering across the user base; personality becomes one input feature, not the primary driver

## Feedback Signals (by reliability)
- **Explicit** (like/dislike/save) — strong signal, low volume
- **Skip** (<X sec) — strong negative
- **Completion/replay** — strong positive
- **Session timing/length** — secondary, used for context inference

## Success Metrics
- D7/D30 retention
- Skip-rate trend within an activity bucket (should decline over sessions)
- Session length, completion rate
- % of sessions using the adaptive rec vs. falling back to manual search
- NPS / qualitative signal

## Risks & Assumptions
- **Personality→music correlation is real but weak at the individual level** — treat as a cold-start prior, not a promise; don't oversell precision in-product
- **Platform API dependency (RESOLVED for v0.2, monitor ongoing)** — Spotify's feature/recommendation endpoints are closed to new apps (confirmed Nov 2024, tightened May 2025). Re-based on Deezer public API. Residual risks: Deezer preview URLs are signed and expire in hours (refresh at serve time); Deezer BPM is analysis-derived and accurate within a few BPM, not exact; Deezer's public API is undocumented-stable, not contractually guaranteed — abstract the data layer behind an adapter so the vendor can be swapped.
- **Feature depth** — Deezer gives BPM reliably but not the full Spotify feature set (valence, danceability, acousticness). If the engine needs those, derive them from preview clips or add Cyanite — both add cost/complexity; validate whether tempo+energy alone is sufficient before committing.
- **Tagging fatigue** — if users stop manually tagging activity, cold start degrades; auto-detection is a fast-follow, not v1
- **Trust risk** — silent personality updates from behavior without user visibility

## Phasing
- **V1:** manual activity tag + Big Five quiz + rules engine + feedback capture
- **V2:** auto-activity detection + per-activity taste vectors + bandit re-ranking
- **V3:** wearable input + explainability + social layer
