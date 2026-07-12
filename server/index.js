/**
 * Cadence backend
 * Runs the recommendation pipeline server-side: seed rules + mood
 * (multi-select bubbles + free text) + weather -> cross-genre music
 * discovery (searches every genre in the seed pool, not one random pick;
 * Deezer -> iTunes fallback) -> BPM enrichment -> merge + drop repeat
 * artists + sort by BPM proximity. Keeps the GetSongBPM key off the phone
 * (was bundled client-side — a real leak risk on a public repo) and gives
 * one place to evolve the engine without an app store update.
 *
 * traits is personality-optional: the client can send neutral {O:C:E:A:N:0.5}
 * to skip onboarding — seedTarget's formulas produce zero personality shift
 * at 0.5, so the playlist is driven by activity + mood + weather + time alone.
 *
 * The app still does Bayesian re-ranking + Spotify OAuth/save locally —
 * see the code comments in PlaylistScreen.js for why those stay on-device.
 */
import express from "express";
import cors from "cors";
import { seedTarget, ACTIVITIES } from "./engine/seedEngine.js";
import { analyzeCombined } from "./engine/moodEngine.js";
import { searchAcrossGenres } from "./engine/musicProvider.js";
import { fetchWeather, weatherToBpmShift } from "./engine/weather.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/activities", (_req, res) => res.json(ACTIVITIES));

/**
 * POST /recommend
 * body: { traits, activity, moodLabels?: string[], moodText?: string,
 *         lat?: number, lon?: number, limit?: number }
 * returns: { target, tracks, reserve, mood, weather, diag }
 */
app.post("/recommend", async (req, res) => {
  const diag = [];
  try {
    const { traits, activity, moodLabels = [], moodText = "", lat, lon, limit = 15 } = req.body;
    if (!traits || !activity) return res.status(400).json({ error: "traits and activity are required" });

    const mood = analyzeCombined(moodLabels, moodText);
    diag.push(`mood: ${mood.label} (v=${mood.valence.toFixed(2)}, a=${mood.arousal.toFixed(2)})`);

    let weather = null, weatherShift = 0;
    if (lat != null && lon != null) {
      try {
        weather = await fetchWeather(lat, lon);
        weatherShift = weatherToBpmShift(weather);
        diag.push(`weather: ${weather.condition}, ${weather.tempC}°C -> ${weatherShift} BPM`);
      } catch (e) {
        diag.push(`weather lookup failed: ${e.message}`);
      }
    }

    const moodShift = Math.round(mood.arousal * 15);
    const combinedShift = moodShift + weatherShift;
    const target = seedTarget(traits, activity, combinedShift);

    // fetch a larger pool than we show, so removed tracks can be replaced
    // from the "reserve" without a second network round trip. Searches every
    // genre in the (personality-filtered) seed pool, not just one random
    // pick — merges results, drops repeat artists, sorts by BPM proximity.
    const pool = await searchAcrossGenres({
      seedPool: target.seedPool,
      bpmMin: target.bpmMin,
      bpmMax: target.bpmMax,
      limit: limit + 15,
      onDiag: (m) => diag.push(m),
    });

    const tracks = pool.slice(0, limit);
    const reserve = pool.slice(limit);

    res.json({ target, tracks, reserve, mood, weather, diag });
  } catch (e) {
    diag.push(`fatal: ${e.message}`);
    res.status(500).json({ error: e.message, diag });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cadence backend listening on ${PORT}`));
