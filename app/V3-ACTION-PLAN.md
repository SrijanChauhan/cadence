# V3 Action Plan — Full-song playback INSIDE the Cadence app

Goal: play full tracks (not 30s previews) inside Cadence, controlled by the app,
auto-advancing through the favourited queue.

## Hard constraint (read first)
Full-song playback in **Expo Go is not possible.** Expo Go cannot load native
audio SDKs. Full playback requires the **Spotify iOS/Android Remote SDK**, which
is a native module → needs an **Expo dev build** (not Expo Go). This is an OS/SDK
limit, not a code choice. What already works in Expo Go: 30s previews playing
in-app, auto-advancing, plus saving a real full-song playlist to Spotify. The
step below is only for playing full songs *inside* Cadence.

## Prereqs (already done)
- Spotify Premium on the account. ✓
- Spotify app registered, Client ID `5cb328659de34b61bf3a437fd42e20c0`. ✓
- Redirect URI `cadence://spotify-auth` added in the dashboard. ✓
- Add a second redirect for the remote SDK if prompted: keep `cadence://spotify-auth`.

## Steps (execute in order)

1. Install the remote SDK module and switch to a dev build:
   ```
   cd app
   npx expo install react-native-spotify-remote
   npx expo install expo-dev-client
   npx expo prebuild
   eas build --profile development --platform ios
   ```
   Install the resulting dev build on the phone (replaces Expo Go for this app).

2. Add config to `app.json` under `expo`:
   ```
   "plugins": ["react-native-spotify-remote"]
   ```
   And confirm `"scheme": "cadence"` is present (it is).

3. Create `src/engine/spotifyRemote.js` exposing:
   - `authorize()` — uses SpotifyRemote auth with CLIENT_ID + `cadence://spotify-auth`.
   - `playUri(uri)` — `SpotifyRemote.playUri(uri)`.
   - `queueUri(uri)` — `SpotifyRemote.queueUri(uri)`.
   - `onTrackEnd(cb)` — subscribe to `playerStateChanged`; when position resets
     near track end / track changes, fire cb to advance Cadence's queue.
   Keep the same shape as `spotify.js` so the UI barely changes.

4. In `PlaylistScreen.js`, add a provider switch:
   - If dev build + remote connected → `playUri` for full songs, drive the
     existing auto-advance off `onTrackEnd` instead of the 30s preview end.
   - Else (Expo Go) → keep current `expo-av` preview playback.
   The queue, ranking, feedback, and Bayesian logic are unchanged — only the
   playback source swaps.

5. Map each queued track to a Spotify URI: reuse `findTrackUri()` already in
   `spotify.js` (search by title+artist). Cache the URI on the track object so
   playback and playlist-save share it.

6. Test on the dev build: favourite tracks → play → confirm full songs play and
   auto-advance through the queue inside Cadence.

## Notes for the implementer
- `react-native-spotify-remote` requires the Spotify app installed on the phone
  (it remote-controls it). Full audio comes from Spotify's app, licensed under
  the user's Premium — Cadence controls it.
- iOS queue order is last-in-first-out via `queueUri`; prefer `playUri` on the
  first track then advance manually via `onTrackEnd` for deterministic order.
- Do not attempt the Web Playback SDK in a WebView — it stops on device lock and
  is unreliable in RN.
- Everything above is additive; the Expo Go preview path stays as the fallback.
