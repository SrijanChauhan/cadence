# Cadence backend — deploy to Render (free)

1. Push this repo to GitHub (already done).
2. Go to render.com → New → Web Service → connect your `cadence` repo.
3. Settings:
   - **Root directory:** `server`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Add an environment variable:
   - `GETSONGBPM_KEY` = your key (the one you registered — moved off the phone for real this time)
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
