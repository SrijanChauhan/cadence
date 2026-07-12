/**
 * Cadence — weather signal (server-side)
 * Uses Open-Meteo: free, no API key, no signup. Given lat/lon, returns
 * current temperature, a simple condition bucket, and a BPM nudge —
 * same "nudge, don't override" pattern as mood and personality.
 *
 * Rationale (kept simple, defensible, explainable — not a black box):
 *  - Cold or rainy -> pull tempo down a little (cozier, lower-energy default)
 *  - Hot and clear -> push tempo up a little
 *  - Time of day also nudges: late night/early morning -> calmer default
 */

const WMO_RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const WMO_SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

export async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
  const json = await res.json();
  const tempC = json.current?.temperature_2m ?? null;
  const code = json.current?.weather_code ?? null;
  const localHour = new Date(json.current?.time || Date.now()).getHours();

  let condition = "clear";
  if (WMO_SNOW_CODES.has(code)) condition = "snow";
  else if (WMO_RAIN_CODES.has(code)) condition = "rain";
  else if (code >= 1 && code <= 3) condition = "cloudy";

  return { tempC, condition, localHour };
}

/** Convert weather + time into a modest BPM nudge (-10..+10). */
export function weatherToBpmShift({ tempC, condition, localHour }) {
  let shift = 0;
  if (condition === "rain" || condition === "snow") shift -= 6;
  if (tempC != null) {
    if (tempC < 15) shift -= 4;
    else if (tempC > 28) shift += 5;
  }
  if (localHour != null && (localHour >= 22 || localHour < 6)) shift -= 5; // late night, calmer
  return Math.max(-10, Math.min(10, Math.round(shift)));
}

/**
 * Reverse-geocode lat/lon into a human place name, for the playlist
 * description ("story"). BigDataCloud's client-side endpoint: free, no
 * API key, no signup — meant for exactly this kind of lightweight lookup.
 */
export async function fetchPlaceName(lat, lon) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Reverse geocode HTTP ${res.status}`);
  const json = await res.json();
  const city = json.city || json.locality || null;
  const region = json.principalSubdivision || null;
  const country = json.countryName || null;
  const parts = [city, !city ? region : null, country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
