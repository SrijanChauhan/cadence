# Cadence backend — deploy to Render (free)

1. Push this repo to GitHub (already done).
2. Go to render.com → New → Web Service → connect your `cadence` repo.
3. Settings:
   - **Root directory:** `server`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Add environment variables:
   - `GETSONGBPM_KEY` = your key (the one you registered — moved off the phone for real this time)
   - `LASTFM_API_KEY` = your key from last.fm/api/account/create (free, personal use) —
     powers real similar-artist blending. Optional: without it, that step
     just skips (no crash), same as GetSongBPM without a key.
   - `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` = from a GA4 property at
     analytics.google.com — create a Data Stream, then Admin → Data Streams →
     [stream] → Measurement Protocol API secrets to generate the secret.
     Powers funnel tracking (see `engine/analytics.js`). Optional: without
     both set, `POST /analytics` just no-ops (`{ sent: false }`), same
     graceful-degradation pattern as the keys above — the app never crashes
     or blocks on analytics either way.
5. Deploy. Render gives you a URL like `https://cadence-xyz.onrender.com`.
6. Put that URL in the app: `src/config.js` → `BACKEND_URL`.

## Known trade-off
Free tier sleeps after 15 minutes idle; the first request after that takes
30-60s to wake up. Fine for personal use — annoying for a demo. If it matters,
a cheap fix is a scheduled ping (e.g. a free cron service hitting `/health`
every 10 min) or upgrading the Render plan later.

## Test it's alive
```
curl https://YOUR-URL.onrender.com/health
```
Should return `{"ok":true}`.
