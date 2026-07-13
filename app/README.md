# Cadence — Mobile App (Expo / React Native)

Expo SDK 54 client for Cadence. Runs a Big Five personality assessment, then the full recommendation flow — activity picker, mood/weather-aware track feed, live Bayesian re-ranking, favourites catalog, Spotify save — against the Express backend in `../server`.

## What's here
- `App.js` — entry point: theme provider, personality profile persistence, top-level nav between onboarding/playlist/profile
- `src/OnboardingScreen.js` — the Big Five quiz: intro → 10 randomized prompts (skippable at any point) → OCEAN bar-graph results
- `src/PlaylistScreen.js` — activity picker, mood prompt, track feed, per-activity queue, Refresh Playlist, Spotify save
- `src/MyPicksStrip.js` — cross-session favourites catalog with tap/hold-drag-reorder/hold-still-to-remove gestures
- `src/ProfileScreen.js`, `src/TraitGraph.js`, `src/PersonalityPlacard.js` — profile screen, OCEAN graph (viewable again any time), playlist history
- `src/theme.js` — four selectable colour themes, persisted via AsyncStorage
- `src/SessionBanner.js`, `src/CoverArt.js` — generated mood/weather art (on-screen banner + square Spotify cover image)
- `src/engine/` — `bayes.js` (re-ranking, on-device), `spotify.js` (OAuth + playlist save, on-device), `appleMusic.js` (deep link)
- `app.json`, `eas.json`, `package.json` — Expo + EAS build config

See the root `../README.md` and `../CLAUDE.md` for the full architecture (client/server split, recommendation pipeline, why each piece stays on-device vs. server-side).

## Run it locally
```bash
npm install
npx expo start --tunnel   # or `npx expo start` if your phone shares this computer's Wi-Fi
```
Scan the QR code with the **Expo Go** app on your phone to preview instantly.

If `--tunnel` fails with `ERR_NGROK_3200` or `failed to start tunnel`: `@expo/ngrok` still bundles a deprecated ngrok v2 agent that ngrok's backend now rejects, even with a valid authtoken configured for it. Fastest fixes:
- Use LAN mode (`npx expo start`, no `--tunnel`) if your phone and computer share Wi-Fi, or
- Run a standalone modern ngrok yourself: `brew install ngrok`, `ngrok config add-authtoken <your token>`, then `ngrok http 8081` alongside a plain `npx expo start`, and enter the printed `exp://<subdomain>.ngrok-free.dev` URL manually in Expo Go.

Point the app at your backend with `src/config.js` (`BACKEND_URL`) — it needs to be running or deployed (see `../server/DEPLOY.md`) for the recommend/save flows to work; onboarding alone works offline.

## Build an APK (cloud build — no Android Studio needed)
```bash
npm install -g eas-cli
eas login                 # create a free Expo account if needed
eas build:configure       # links this project, fills projectId in app.json
eas build -p android --profile preview
```
`preview` is set to output an installable **APK** (not an app-bundle). When the cloud build finishes, EAS gives you a download link for the `.apk` — install it directly on any Android device (enable "install from unknown sources").

For a Play Store submission later, use `--profile production` (outputs an `.aab` app-bundle).

## Tests
```bash
npm test
```
Node's built-in test runner, covering the pure Bayesian re-ranking math (`src/engine/bayes.test.mjs`).

## Full-song playback / background audio
In-app playback is 30s previews via `expo-av`, which is all Expo Go supports. Full songs (via Spotify's Remote SDK) and background/lock-screen transport controls both need a real Expo dev build, not Expo Go — see `V3-ACTION-PLAN.md` for the full-song path. `expo-av` itself never wires up iOS's Now Playing / remote command APIs, so lock-screen controls specifically need an additional native module (e.g. `react-native-track-player`) on top of the dev-build switch.
