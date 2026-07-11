# Cadence — Mobile App (Expo / React Native)

Onboarding personality assessment for Cadence. Big Five (Mini-IPIP, public-domain items) → normalized OCEAN vector that seeds the recommendation engine.

## What's here
- `App.js` — entry point
- `src/OnboardingScreen.js` — the full assessment (intro → 20 prompts → EQ results)
- `app.json`, `eas.json`, `package.json` — Expo + EAS build config

## Run it locally
```bash
npm install
npx expo start
```
Scan the QR code with the **Expo Go** app on your phone to preview instantly.

## Build an APK (cloud build — no Android Studio needed)
```bash
npm install -g eas-cli
eas login                 # create a free Expo account if needed
eas build:configure       # links this project, fills projectId in app.json
eas build -p android --profile preview
```
`preview` is set to output an installable **APK** (not an app-bundle). When the cloud build finishes, EAS gives you a download link for the `.apk` — install it directly on any Android device (enable "install from unknown sources").

For a Play Store submission later, use `--profile production` (outputs an `.aab` app-bundle).

## Version note
The versions in `package.json` target Expo SDK 52. If `npm install` complains about mismatches, the safest fix is to generate a fresh Expo project and drop these files in:
```bash
npx create-expo-app cadence
# then replace App.js, add src/OnboardingScreen.js, and run:
npx expo install expo-clipboard expo-av
```
This guarantees matched React / React Native / Expo versions for your install date.

## Next screen (not built yet)
The playlist screen consumes the OCEAN vector. The music-data source is decided: **Deezer** is the primary layer (public API with BPM + ISRC + preview clips), with **Apple Music / MusicKit** for full playback as a fast-follow. Spotify's audio-features / recommendations endpoints are closed to new apps (Nov 2024). See the main repo's `docs/music-data-layer.md` for the full rationale and the revised seed-engine flow.
