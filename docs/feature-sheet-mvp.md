# Cadence — Feature Sheet (MVP)

*Reference doc for building a LinkedIn-shareable interactive showcase. User-facing framing of what the app actually does today.*

## The pitch

Most music apps ask "what do you want to hear?" Cadence asks a better question: *who are you, right now, doing what, feeling how, where, and when* — and builds the playlist from there.

## Core features

### 1. Personality-anchored recommendations — or skip it
A 2-minute, 20-prompt Big Five personality assessment (Mini-IPIP, a validated public-domain instrument) seeds your very first playlists before you've given a single piece of feedback. Don't want to take a quiz? Skip it — a "Skip" option on the intro screen goes straight to context-only recommendations (mood, weather, time), no personality data required.

### 2. Mood check-in, once per session
Pick from mood bubbles (Energetic, Calm, Tense, Down, and more) and optionally add a few words of your own — "wired and a little anxious before this call." Analyzed on the spot, including handling negation ("not happy" isn't the same as "sad"), it nudges the tempo target independently of your personality baseline.

### 3. Reads the room: weather, time, place
Your local temperature, conditions, and time of day all subtly shape the target tempo — cold or rainy pulls it down, late night calms it further, a bright afternoon lifts it. This happens automatically from device location, no manual input.

### 4. Discovery tuned to genres *and* real taste
Instead of picking one genre and hoping, Cadence searches across every genre that fits your personality-and-context profile in a single pass — and, if you connect Spotify, blends in artists you actually listen to, plus real similar artists sourced from music-recommendation data (not a generic "more like this" genre guess).

### 5. Learns from every tap, live
Skip a track fast, skip it late, like it, let it finish, save it — every action shifts the recommendation engine's confidence in real time. A live "% personality" meter shows you exactly how much of the current mix is still your starting profile versus what you've taught it this session.

### 6. Every track guaranteed to open correctly
Tap the Apple Music icon on any track and it opens the *right* song — every track in the app has been pre-verified to actually resolve to a real Apple Music match before it's ever shown to you, not a best-effort guess that sometimes fails.

### 7. Save as a real playlist — with a story
Favorite tracks build a queue you can save as an actual Spotify playlist, one tap. The playlist gets:
- A name like `Cadence.Workout.Energized` — activity and mood, baked into the title
- A description that narrates the session: the date, time, weather, and mood that produced it
- Custom cover art — a generated abstract composition where color and shape reflect your mood and the weather at the time, uploaded directly as the Spotify playlist cover

### 8. Your profile, your history
A Profile section shows your computed personality type in two words (e.g. "Curious & Social"), plus every playlist you've ever saved — tap any one to see the exact tracks and revisit its story.

### 9. Full-song playback, not just previews
Save to Spotify and you get full tracks in your own Spotify library, not 30-second clips — in-app preview playback (with auto-advancing queue) is there for browsing before you commit.

## What makes this different

- **Not a black-box recommendation** — every tempo adjustment comes with a plain-English "why" (e.g. "Raised tempo ~8 BPM for higher Extraversion").
- **Personality is a prior, not a cage** — it seeds the cold start, then visibly fades in influence as your actual behavior takes over.
- **Context-aware without being creepy** — weather and location only ever nudge a tempo number, never stored or shown as a feed of "where you were."
- **Runs entirely on free-tier infrastructure** — no paid music-data licenses, built on public APIs and open data sources throughout.

## Status

Live prototype. Personality onboarding, mood check-in, weather/location-aware recommendations, live re-ranking, Spotify save with generated story + cover art, and full playlist history are all working end to end on a physical device today.
