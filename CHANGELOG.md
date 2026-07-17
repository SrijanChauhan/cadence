# Changelog — 2026-07-17 to 2026-07-18

Two days of work on the Profile screen's recommendation surface, the theme
system, and a redesign of the main playlist screen's activity/mood entry
points. Grouped by area below; commit hashes reference `main`.

## Profile: Recommendations ("Reccos")

- **Added "Recommendations for You" / "Top Artists for You"** — a new
  `POST /discover` backend endpoint returns 5 personality-driven track
  picks (via a new trait-only `discoverSeedTarget`, unioning every
  activity's seed genres into one wide pool) and 5 artist picks (real
  Spotify top artists + their real Last.fm similar artists first, filled
  out with genre-driven picks via a new `pickTopArtists`). Tapping an
  artist opens their top 10 (new `GET /artist-tracks`). (`54a70bb`)
  - This required lifting **My Picks** out of `PlaylistScreen`-local state
    into an app-level `MyPicksContext`, so hearting a track from Profile
    updates the same list the main screen shows, and factoring playback
    into a shared `usePreviewPlayer` hook so Profile has one consistent
    docked now-playing bar regardless of which section started playback.
- **Moved Recommendations into its own screen**, behind a "Reccos" pill
  button next to Test Again / Theme, instead of an inline card on the main
  Profile page. (`9fb37b2`, `7456120`, `8effe62`)
- **Persisted the Reccos list across Profile opens** — previously re-rolled
  from `/discover` every time Profile opened; now cached in AsyncStorage
  the same way the theme pick and OCEAN profile are, keyed by a
  fingerprint of the traits vector, so it only refreshes after a new
  personality test. (`2730b5d`)
- **Top Artists now show a picture**, matching Top Songs' layout —
  `pickTopArtists` returns `{name, cover}` instead of a bare name (genre
  picks reuse their own iTunes search hit's artwork; real artists get a
  cheap parallel one-track iTunes lookup for artwork). (`7d707ab`)

## Saved playlists (Profile)

- **Now-playing equalizer + docked bar on saved playlists**, brought up to
  parity with the main feed: playing-track equalizer overlay, docked bar
  (cover/title/up-next/pause/skip), and auto-advance through the tracklist.
  Spotify playlist descriptions switched from second-person ("You were
  feeling...") to first-person ("I was feeling..."). (`6e22df3`)
- **Every saved playlist now shows its generated cover art** — a thumbnail
  in the Your Playlists list, and full-size at the top of its detail view
  above the description and track list, reusing the same seeded
  mood/weather art composition that was uploaded to Spotify at save time.
  (`add1e93`)

## Theme system

- **Added two new themes: Candy and Spider Man**, alongside a rename of
  "Black Bolt" to **"Bolt"**. (`add1e93`, `be4885e`)
- Iterated on both new palettes after visual review:
  - Candy's background was violet-leaning, reading too close to the Purple
    theme — shifted to a true rose/pink hue. (`0e79219`)
  - Spider Man's background read as maroon/brown instead of red — hue was
    skewed toward magenta at very low lightness; corrected to a true red
    hue. (`e218330`)
  - More generally, every coloured theme's `bg`/`surface`/`border` was an
    independently muted pick that drifted duller than the accent colour
    shown in the theme picker's preview dots. Rebuilt all of them at the
    same hue/saturation as that preview dot, just progressively darker, so
    picking a theme now looks like what the picker promised. (`be4885e`)

## Main playlist screen: Mode/Feel redesign

- **Replaced the always-visible six activity chips + one-time auto mood
  popup** with two pill buttons, **Mode** and **Feel**, each opening its
  own lazily-mounted panel of pills. Picking a Mode still builds
  immediately (using whatever Feel is currently set); Feel is now fully
  manual and can be opened/changed any time, before or after a Mode pick,
  updating the current playlist when applied. (`f57b31d`)
- **Road Trip became a real bubble** instead of a quiet text link, and the
  Mode panel was reworked into **three fixed rows of uniform-width
  bubbles**: since 7 pickable things (6 activities + Road Trip) don't
  split evenly into rows of 3, the 6th slot is a "More" bubble that
  reveals the last two (Wind-down, Road Trip) as a third row when tapped.
  (`d8c2431`, `7d707ab`)
- **Bubble sizing/alignment passes**: standardized all pill border widths
  to `1.5` app-wide (`4de484e`); dropped Mode/Feel's border entirely to
  match the borderless "Save My Picks to Spotify" pill (`5dbc758`); gave
  Feel's mood bubbles the same uniform percentage-width treatment as
  Mode's chips (`334992a`); switched rows from center-justified to
  left-aligned so a shorter last row still lines up in the same columns as
  the rows above it, rather than floating centered off-column (`95e8c0e`).
- **Smooth open/close animation** — every Mode/Feel/More toggle now runs
  through `LayoutAnimation`, so a panel grows open from the top and eases
  whatever's below it down, instead of an abrupt mount/unmount cut. No new
  dependency (built into React Native core). (`7d707ab`)
- Feel's free-text placeholder was iterated from `"add more, in your own
  words (optional)..."` down to `"In my own words..."` — capitalized,
  first-person, and trimmed of the redundant lead-in and "(optional)".
  (`ccf13cb`, `631286b`, `793327c`, `f8dd4ce`)

## Playback controls

- **Added a previous-track button** to Profile's docked now-playing bar,
  alongside the existing next button — `usePreviewPlayer` derives `upPrev`
  the same way it already derived `upNext` (the adjacent item in the
  already-ordered track list), no separate history stack needed. Replaced
  the `⏭` Unicode character (renders as a colorful emoji on iOS/Android)
  with plain double-triangle glyphs (`◀◀` / `▶▶`) matching the rest of the
  transport controls. (`7aa2ac7`)

## Also on 2026-07-17 (earlier work, same two-day window)

- Track row redesign: tap-anywhere-to-play, swipe-to-remove (red trail) /
  swipe-right-to-add-to-My-Picks (accent trail), heart-only icon.
- Now-playing equalizer overlay on the playing track's cover art —
  iterated from a bouncing/theme-tinted design to a fixed neutral-grey,
  tempo-tuned grow/shrink-in-place animation per explicit feedback.
- Cover-art load-failure fallback (a returned URL isn't a guarantee the
  image actually resolves) across track rows, the queue panel, and the
  now-playing bar.
- Copy polish: capitalized "Up Next" / "Preview" and the My Picks hint
  line; header title centering fix for Profile/Personality/Road Trip.
