/**
 * Cadence — road trip routing + terrain
 *
 * Free, no-key stack, same "public API, graceful degradation" pattern as
 * weather.js/lastfm.js:
 *  - Open-Meteo Geocoding — place name (free text, whatever the user typed
 *    for "from"/"to") -> coordinates.
 *  - OSRM's public demo routing server — coordinates -> a real driving
 *    route: distance, duration, and the route's geometry (a polyline of
 *    lat/lon points along the actual roads, not a straight line).
 *  - Open-Meteo Elevation — sampled points along that geometry -> a
 *    terrain classification, from how much the grade (elevation change
 *    per km) swings along the route, not just start/end elevation.
 *
 * OSRM's public demo instance (router.project-osrm.org) is explicitly NOT
 * meant for production load — shared, rate-limited, can be slow or flaky.
 * Fine for personal use; a real deployment would want a self-hosted OSRM
 * or a paid routing provider instead.
 */

const GEOCODE_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const ELEVATION_BASE = "https://api.open-meteo.com/v1/elevation";

async function geocodeQuery(query) {
  const url = `${GEOCODE_BASE}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const json = await res.json();
  return json.results?.[0] || null;
}

/**
 * Forward-geocode a free-text place name into coordinates. Open-Meteo's
 * geocoding search matches against a bare place name field — it returns
 * ZERO results for the "City, State"/"City, Country" format people
 * naturally type (e.g. "San Francisco, CA" fails outright even though
 * "San Francisco" alone finds it instantly), so this tries the full
 * string first, then falls back to just the part before the first comma.
 */
export async function geocodePlace(name) {
  let hit = await geocodeQuery(name);
  if (!hit && name.includes(",")) {
    hit = await geocodeQuery(name.split(",")[0].trim());
  }
  if (!hit) throw new Error(`Could not find a place matching "${name}"`);
  return {
    lat: hit.latitude,
    lon: hit.longitude,
    name: [hit.name, hit.admin1, hit.country].filter(Boolean).join(", "),
  };
}

/** Real driving route between two geocoded points: distance, duration, geometry. */
export async function getRoute(from, to) {
  const url = `${OSRM_BASE}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing HTTP ${res.status}`);
  const json = await res.json();
  const route = json.routes?.[0];
  if (!route) throw new Error("No driving route found between those two places");
  return {
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
    geometry: route.geometry.coordinates, // [[lon, lat], ...] along the actual road
  };
}

/**
 * Classifies terrain from the ROUTE'S GRADE VARIANCE, not average elevation —
 * a route that climbs a mountain then descends it reads as "mountainous"
 * even though its start/end elevation might net out flat, and a plateau at
 * 2000m the whole way reads as "flat" despite being high up. Samples up to
 * maxSamples evenly-spaced points along the geometry (one batched elevation
 * call, not one call per point) and averages the absolute elevation change
 * per km between consecutive samples.
 */
export async function classifyTerrain(geometry, distanceKm, maxSamples = 15) {
  if (!geometry || geometry.length < 2) return "flat";
  const step = Math.max(1, Math.floor(geometry.length / maxSamples));
  const sampled = [];
  for (let i = 0; i < geometry.length; i += step) sampled.push(geometry[i]);
  const last = geometry[geometry.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  if (sampled.length < 2) return "flat";

  const lats = sampled.map((p) => p[1]).join(",");
  const lons = sampled.map((p) => p[0]).join(",");
  const res = await fetch(`${ELEVATION_BASE}?latitude=${lats}&longitude=${lons}`);
  if (!res.ok) throw new Error(`Elevation HTTP ${res.status}`);
  const json = await res.json();
  const elevations = json.elevation || [];
  if (elevations.length < 2) return "flat";

  return classifyFromElevations(elevations, distanceKm);
}

/**
 * Pure classification step, split out from the network call above so it's
 * unit-testable without hitting Open-Meteo.
 */
export function classifyFromElevations(elevations, distanceKm) {
  if (!elevations || elevations.length < 2) return "flat";
  const segmentKm = Math.max(distanceKm / (elevations.length - 1), 0.1);
  let totalGradeSwing = 0;
  for (let i = 1; i < elevations.length; i++) {
    totalGradeSwing += Math.abs(elevations[i] - elevations[i - 1]) / segmentKm;
  }
  const avgGradeSwing = totalGradeSwing / (elevations.length - 1); // meters of elevation change per km, averaged
  if (avgGradeSwing < 8) return "flat";
  if (avgGradeSwing < 25) return "rolling";
  return "mountainous";
}

/**
 * Terrain nudges tempo the same "modest, explainable shift" way weather
 * does — winding mountain roads read as more alert/energetic, a flat
 * highway cruise reads as steady, unchanged from baseline.
 */
export const TERRAIN_BPM_SHIFT = { flat: 0, rolling: 4, mountainous: 9 };
