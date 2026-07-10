# Music Data Layer — Evaluation & Decision

Status: Decision doc supporting Spec v0.2. Records why the music-data source moved off Spotify and what replaces it.

## 1. What broke

Cadence's original P0 seed engine mapped *trait × activity → audio-feature target* and resolved it via Spotify's `audio-features` endpoint, with `recommendations` for candidate generation.

On **27 November 2024**, Spotify closed the following endpoints to new applications: Audio Features, Audio Analysis, Recommendations, Related Artists, and Get Featured Playlists. Apps without prior extended access now receive `403`. There is no official replacement.

On **15 May 2025**, Spotify further tightened extended-access criteria; leaving development mode (25-user cap) effectively requires an organization with ~250k monthly active users. A new product cannot clear this bar.

Stated rationale: concern that developers would use the data to train AI models — which is close to Cadence's use case, so an exception is unlikely.

**Conclusion:** Spotify is not a viable data source for a new build of Cadence. This is a data-source closure, not a tuning problem.

## 2. Options evaluated (as of July 2026)

| Platform | Catalog + search | Audio features | Recommendations | Playback | Access barrier |
|---|---|---|---|---|---|
| **Deezer** | 90M+ tracks | **BPM + ISRC** per track | charts only | 30s previews | None (public API, no auth for search/charts) |
| **Apple Music / MusicKit** | Full catalog + charts | none | library/purchase-based (black box) | Full — iOS/Android/Web | Paid Apple Developer Program (~$99/yr) |
| **Cyanite** | your own library | Full (mood, BPM, key, energy, similarity) | similarity search | none | Paid, catalog-oriented |
| **YouTube Music** | — | none | none | via YouTube | No official API (unofficial libs only) |
| **Last.fm** | metadata | none | similar-artists (free) | none | Free key |
| **3rd-party Spotify shims** (ReccoBeats, FreqBlog) | via lookup | Spotify-shaped, re-derived | none | none | Free/paid; directionally compatible, not identical |

## 3. Decision

**Deezer is the primary data spine for v1.** Rationale:
- Public API, no auth for search/charts — lowest barrier to a working spike.
- Exposes **BPM** per track, the single most useful feature for activity-matching (workout vs. wind-down), plus **ISRC** (cross-platform join key) and **30s preview clips**.
- Large catalog (90M+ / 100M+ depending on source), broad territory coverage.

**Apple Music / MusicKit is the playback + playlist-write layer** when the product needs real in-app listening beyond previews (fast-follow, not MVP). It also offers library-based recommendations, though those are opaque and not a substitute for Cadence's own engine.

**Richer features (valence, danceability, mood) are deferred.** If tempo + energy prove insufficient in testing, derive features from Deezer preview clips using Essentia/librosa, or add **Cyanite**. Both add cost; do not add them before validating that tempo+energy is not enough.

## 4. Revised seed-engine flow

```
trait vector (OCEAN)  ─┐
                        ├─► rules engine ─► target { tempo_band, energy_band }
activity bucket        ─┘
                                 │
                                 ▼
        Deezer search (genre/mood seed terms) ─► candidate tracks
                                 │
                                 ▼
              filter/rank by BPM proximity to tempo_band
                                 │
                                 ▼
                    seed playlist (preview URLs)
                                 │
                                 ▼
        feedback ─► Bayesian blend + cross-bucket transfer ─► re-rank
```

The Bayesian prior/posterior blending and trait-mediated cross-bucket transfer (see the other appendices) operate on this candidate stream unchanged — they are agnostic to which vendor produced the tracks.

## 5. Residual risks to track

- **Preview URL expiry** — Deezer preview links are signed and expire within hours; fetch/refresh at serve time, never persist.
- **BPM precision** — analysis-derived, accurate within a few BPM; fine for banding, not for beat-matched use cases.
- **Undocumented stability** — Deezer's open search API is not a contractual guarantee. Mitigate by putting all vendor calls behind a `MusicProvider` adapter interface so Deezer can be swapped for Apple Music or another source without touching the engine.
- **Terms of use** — confirm Deezer API terms permit a commercial recommendation product before launch (public availability ≠ commercial license).
- **Feature-API vendor risk** — if Cyanite/third-party is added later, that reintroduces a single-vendor dependency; keep it behind the same adapter.

## 6. Next action

Build a thin spike before further UI: authenticate (Apple) / call (Deezer), pull candidate tracks for one activity band, confirm BPM filtering produces a sensible playlist, and confirm preview playback works on-device. Only then build the playlist screen on top of the onboarding vector.
