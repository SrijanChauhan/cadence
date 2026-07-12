/**
 * Cadence — Last.fm similar-artist lookup
 *
 * Real "adjacent artist" data. Spotify closed Related Artists in Nov 2024
 * (see docs/music-data-layer.md) and iTunes never had a public one (see
 * musicProvider.js) — Last.fm's artist.getSimilar is the free substitute
 * this project's own earlier research already identified.
 *
 * Free for non-commercial/personal use, needs a personal key from
 * last.fm/api/account/create. Set LASTFM_API_KEY as a server env var
 * (Render dashboard), same pattern as GETSONGBPM_KEY — never hardcoded.
 */

const BASE = "http://ws.audioscrobbler.com/2.0/";
const API_KEY = process.env.LASTFM_API_KEY || "";

/**
 * Real similar artists for one artist, sorted by Last.fm's match score.
 * Best-effort: no key configured, artist not found, or the call fails all
 * resolve to [] rather than throwing — this is enrichment, not a hard
 * dependency, same as the rest of the pipeline degrading gracefully.
 */
export async function getSimilarArtists(artistName, limit = 5) {
  if (!API_KEY || !artistName) return [];
  try {
    const url =
      `${BASE}?method=artist.getsimilar&artist=${encodeURIComponent(artistName)}` +
      `&api_key=${API_KEY}&autocorrect=1&format=json&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const artists = json.similarartists?.artist || [];
    return artists
      .filter((a) => parseFloat(a.match) > 0.1) // drop weak/noise matches
      .map((a) => a.name);
  } catch {
    return [];
  }
}
