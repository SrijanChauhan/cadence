/**
 * Cadence backend
 * Runs the recommendation pipeline server-side: seed rules + mood
 * (multi-select bubbles + free text) + weather -> cross-genre music
 * discovery (searches every genre in the seed pool, plus your real Spotify
 * top artists and their real similar artists from Last.fm, not one random
 * genre pick; iTunes only — see musicProvider.js for why Deezer was
 * dropped) -> BPM enrichment -> merge + drop stock/library-music junk +
 * repeat artists + sort by BPM proximity. Keeps the GetSongBPM/Last.fm keys
 * off the phone (GetSongBPM was bundled client-side at first — a real leak
 * risk on a public repo) and gives one place to evolve the engine without
 * an app store update.
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
import { seedTarget, roadTripSeedTarget, discoverSeedTarget, ACTIVITIES } from "./engine/seedEngine.js";
import { analyzeCombined } from "./engine/moodEngine.js";
import { searchAcrossGenres, pickTopArtists } from "./engine/musicProvider.js";
import { itunesSearchTracks } from "./engine/itunes.js";
import { filterToAppleMusicAvailable } from "./engine/appleMusicResolve.js";
import { fetchWeather, weatherToBpmShift, fetchPlaceName } from "./engine/weather.js";
import { getSimilarArtists } from "./engine/lastfm.js";
import { geocodePlace, getRoute, classifyTerrain, TERRAIN_BPM_SHIFT } from "./engine/routing.js";
import { sendEvent } from "./engine/analytics.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/activities", (_req, res) => res.json(ACTIVITIES));

/**
 * POST /analytics
 * body: { clientId: string, name: string, params?: object }
 * Relays a single GA4 event — see engine/analytics.js for why this goes
 * through the backend rather than the client calling GA4 directly. Never
 * fails loudly: the client fires this without awaiting the result, so it
 * always responds 200 (with { sent: false } when GA4 isn't configured or
 * the forward failed) rather than surfacing analytics plumbing as a real
 * error to a caller that isn't checking for one.
 */
app.post("/analytics", async (req, res) => {
  const { clientId, name, params } = req.body || {};
  const result = await sendEvent({ clientId, name, params });
  res.json(result);
});

/**
 * POST /recommend
 * body: { traits, activity, moodLabels?: string[], moodText?: string,
 *         lat?: number, lon?: number, spotifyArtists?: string[],
 *         spotifyGenres?: string[] (accepted, currently unused — see below),
 *         excludeIds?: string[] (already-seen track ids, e.g. from a
 *         "Refresh Playlist" tap — iTunes's search ranking is deterministic,
 *         so without this a refresh would just hand back the same tracks),
 *         limit?: number }
 * returns: { target, tracks, reserve, mood, weather, place, diag }
 */
app.post("/recommend", async (req, res) => {
  const diag = [];
  try {
    const {
      traits, activity, moodLabels = [], moodText = "", lat, lon,
      spotifyArtists = [], excludeIds = [], limit = 8,
    } = req.body;
    if (!traits || !activity) return res.status(400).json({ error: "traits and activity are required" });

    const mood = analyzeCombined(moodLabels, moodText);
    diag.push(`mood: ${mood.label} (v=${mood.valence.toFixed(2)}, a=${mood.arousal.toFixed(2)})`);

    let weather = null, weatherShift = 0, place = null;
    if (lat != null && lon != null) {
      try {
        weather = await fetchWeather(lat, lon);
        weatherShift = weatherToBpmShift(weather);
        diag.push(`weather: ${weather.condition}, ${weather.tempC}°C -> ${weatherShift} BPM`);
      } catch (e) {
        diag.push(`weather lookup failed: ${e.message}`);
      }
      try {
        place = await fetchPlaceName(lat, lon);
      } catch (e) {
        diag.push(`place lookup failed: ${e.message}`);
      }
    }

    const moodShift = Math.round(mood.arousal * 15);
    const combinedShift = moodShift + weatherShift;
    const target = seedTarget(traits, activity, combinedShift);

    // Blend in artists you actually listen to on Spotify, PLUS real similar
    // artists for them from Last.fm (genuine "adjacent artist" data — see
    // lastfm.js for why Spotify/iTunes can't supply this for free anymore).
    // Capped: each extra term is a full search+enrich round trip, and too
    // many dilutes results-per-term in searchAcrossGenres.
    const topArtists = spotifyArtists.slice(0, 3);
    const similarLists = await Promise.all(topArtists.map((a) => getSimilarArtists(a, 2)));
    const similarArtists = [...new Set(similarLists.flat())].slice(0, 3);

    const seedPool = [...target.seedPool, ...topArtists, ...similarArtists];
    if (topArtists.length) {
      diag.push(`blended in ${topArtists.length} of your top artists`);
    }
    if (similarArtists.length) {
      diag.push(`+ ${similarArtists.length} real similar artists (Last.fm): ${similarArtists.join(", ")}`);
    } else if (topArtists.length) {
      diag.push("no Last.fm similar-artist data (LASTFM_API_KEY not set, or no matches)");
    }

    // fetch a larger pool than we show, so removed tracks can be replaced
    // from the "reserve" without a second network round trip. Searches every
    // term in seedPool (genres + your artists/genres), not just one random
    // pick — merges results, drops repeat artists, sorts by BPM proximity.
    const pool = await searchAcrossGenres({
      seedPool,
      bpmMin: target.bpmMin,
      bpmMax: target.bpmMax,
      limit: limit + 15,
      excludeIds,
      onDiag: (m) => diag.push(m),
    });

    const tracks = pool.slice(0, limit);
    const reserve = pool.slice(limit);

    res.json({ target, tracks, reserve, mood, weather, place, diag });
  } catch (e) {
    diag.push(`fatal: ${e.message}`);
    res.status(500).json({ error: e.message, diag });
  }
});

/**
 * POST /roadtrip
 * body: { traits, from: string, to: string, moodLabels?: string[],
 *         moodText?: string, spotifyArtists?: string[],
 *         excludeIds?: string[] }
 * returns: { target, tracks, reserve, mood, weather, route, diag }
 *
 * A dedicated flow rather than an extra POST /recommend activity: the input
 * shape is genuinely different (free-text places instead of an activity key
 * + device GPS), and the batch size is driven by trip duration rather than
 * a fixed limit, since a 20-minute hop and a 6-hour drive need very
 * different amounts of music for one sitting.
 */
app.post("/roadtrip", async (req, res) => {
  const diag = [];
  try {
    const {
      traits, from, to, moodLabels = [], moodText = "",
      spotifyArtists = [], excludeIds = [],
    } = req.body;
    if (!traits || !from || !to) return res.status(400).json({ error: "traits, from, and to are required" });

    const fromPlace = await geocodePlace(from);
    const toPlace = await geocodePlace(to);
    diag.push(`route: ${fromPlace.name} -> ${toPlace.name}`);

    const route = await getRoute(fromPlace, toPlace);
    diag.push(`distance ${route.distanceKm.toFixed(1)} km, ~${Math.round(route.durationMin)} min driving`);

    let terrain = "flat";
    try {
      terrain = await classifyTerrain(route.geometry, route.distanceKm);
    } catch (e) {
      diag.push(`terrain lookup failed, defaulting to flat: ${e.message}`);
    }
    const terrainShift = TERRAIN_BPM_SHIFT[terrain] ?? 0;
    diag.push(`terrain: ${terrain} (${terrainShift >= 0 ? "+" : ""}${terrainShift} BPM)`);

    const mood = analyzeCombined(moodLabels, moodText);
    diag.push(`mood: ${mood.label} (v=${mood.valence.toFixed(2)}, a=${mood.arousal.toFixed(2)})`);
    const moodShift = Math.round(mood.arousal * 15);

    // A single representative weather read at the route's midpoint, not a
    // point-by-point forecast along the whole drive — same "nudge, don't
    // overthink it" spirit as everywhere else weather is used.
    let weather = null, weatherShift = 0;
    const mid = route.geometry[Math.floor(route.geometry.length / 2)];
    try {
      weather = await fetchWeather(mid[1], mid[0]);
      weatherShift = weatherToBpmShift(weather);
      diag.push(`weather at route midpoint: ${weather.condition}, ${weather.tempC}°C -> ${weatherShift} BPM`);
    } catch (e) {
      diag.push(`weather lookup failed: ${e.message}`);
    }

    const combinedShift = moodShift + weatherShift + terrainShift;
    const target = roadTripSeedTarget(traits, combinedShift);

    const topArtists = spotifyArtists.slice(0, 3);
    const similarLists = await Promise.all(topArtists.map((a) => getSimilarArtists(a, 2)));
    const similarArtists = [...new Set(similarLists.flat())].slice(0, 3);
    const seedPool = [...target.seedPool, ...topArtists, ...similarArtists];
    if (similarArtists.length) {
      diag.push(`+ ${similarArtists.length} real similar artists (Last.fm): ${similarArtists.join(", ")}`);
    }

    // Sized to the actual trip, not a fixed batch: roughly one track per
    // 3.5 minutes of driving, capped so a cross-country drive doesn't
    // request an unreasonable number of tracks in a single call — this is
    // the ONE batch for the whole trip (see README's road trip use case),
    // not the first of several.
    const limit = Math.max(6, Math.min(40, Math.round(route.durationMin / 3.5)));
    diag.push(`sized for ~${Math.round(route.durationMin)} min drive -> ${limit} tracks`);

    const pool = await searchAcrossGenres({
      seedPool,
      bpmMin: target.bpmMin,
      bpmMax: target.bpmMax,
      limit: limit + 10,
      excludeIds,
      onDiag: (m) => diag.push(m),
    });

    const tracks = pool.slice(0, limit);
    const reserve = pool.slice(limit);

    res.json({
      target, tracks, reserve, mood, weather,
      route: {
        from: fromPlace.name, to: toPlace.name,
        distanceKm: Math.round(route.distanceKm * 10) / 10,
        durationMin: Math.round(route.durationMin),
        terrain,
      },
      diag,
    });
  } catch (e) {
    diag.push(`fatal: ${e.message}`);
    res.status(500).json({ error: e.message, diag });
  }
});

/**
 * POST /discover
 * body: { traits, spotifyArtists?: string[] }
 * returns: { target, tracks, artists, diag }
 *
 * Profile's "Recommendations for You" / "Top Artists for You" — trait-only,
 * no activity/mood/weather/session context at all (Profile isn't "in" a
 * session the way the main screen is). tracks is 5 personality-driven
 * picks via the same cross-genre discovery /recommend uses; artists is 5
 * names, real Spotify/Last.fm artists first, personality/genre-driven
 * picks filling any remaining slots (see pickTopArtists).
 */
app.post("/discover", async (req, res) => {
  const diag = [];
  try {
    const { traits, spotifyArtists = [] } = req.body;
    if (!traits) return res.status(400).json({ error: "traits is required" });

    const target = discoverSeedTarget(traits);

    const topArtists = spotifyArtists.slice(0, 3);
    const similarLists = await Promise.all(topArtists.map((a) => getSimilarArtists(a, 2)));
    const similarArtists = [...new Set(similarLists.flat())].slice(0, 3);
    const realArtists = [...new Set([...topArtists, ...similarArtists])];
    if (realArtists.length) diag.push(`blended in ${realArtists.length} real artists (Spotify + Last.fm)`);

    const pool = await searchAcrossGenres({
      seedPool: [...target.seedPool, ...realArtists],
      bpmMin: target.bpmMin,
      bpmMax: target.bpmMax,
      limit: 5 + 8,
      onDiag: (m) => diag.push(m),
    });
    const tracks = pool.slice(0, 5);

    const artists = await pickTopArtists({
      seedPool: target.seedPool,
      realArtists,
      limit: 5,
      onDiag: (m) => diag.push(m),
    });

    res.json({ target, tracks, artists, diag });
  } catch (e) {
    diag.push(`fatal: ${e.message}`);
    res.status(500).json({ error: e.message, diag });
  }
});

/**
 * GET /artist-tracks?name=<artist name>
 * returns: { tracks }
 *
 * "Top 10 songs" for one artist, tapped from Profile's Top Artists list.
 * iTunes has no real popularity-ranked "top tracks by artist" endpoint —
 * this searches by artist name and keeps only results whose artist field
 * actually matches (iTunes's search is fuzzy and returns loosely-related
 * results otherwise), falling back to the raw top results if the exact
 * match filter comes up empty (e.g. a stylized/alternate artist-name spelling).
 */
app.get("/artist-tracks", async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: "name is required" });

    const results = await itunesSearchTracks({ seedTerms: name, limit: 50 });
    const nameKey = String(name).trim().toLowerCase();
    const matched = results.filter((t) => (t.artist || "").trim().toLowerCase() === nameKey);
    const candidates = matched.length ? matched : results;

    const verified = await filterToAppleMusicAvailable(candidates, "IN");
    res.json({ tracks: verified.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cadence backend listening on ${PORT}`));
