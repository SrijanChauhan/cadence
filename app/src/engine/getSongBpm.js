/**
 * Cadence — GetSongBPM tempo lookup
 * Fills the BPM gap for iTunes-sourced tracks (which have no tempo), so the
 * seed band becomes enforceable and the Bayesian re-ranker starts learning.
 *
 * Free API (api.getsong.co). Requires a free key from getsongbpm.com/api.
 * TERMS: a visible backlink to GetSongBPM.com is MANDATORY in the app/store
 * listing — add it in a footer/credits screen or they suspend the key.
 *
 * Flow: search by "artist song" -> take best match -> read tempo.
 * Cached per title|artist so we never look up the same track twice.
 */

const API_KEY = "59bf53f09f968f4a6a3dd67fd6768a42";
const BASE = "https://api.getsong.co";

const cache = new Map(); // "title|artist" -> bpm | null

function norm(str) {
  return (str || "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")     // drop "(feat. …)", "[remastered]"
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/** Return BPM (number) for a track, or null if not found. */
export async function bpmForTrack(track) {
  if (!track?.title) return null;
  const key = `${norm(track.title)}|${norm(track.artist)}`;
  if (cache.has(key)) return cache.get(key);
  if (API_KEY.startsWith("PASTE_")) return null; // not configured yet

  try {
    const lookup = encodeURIComponent(`${norm(track.title)} ${norm(track.artist)}`);
    const res = await fetch(`${BASE}/search/?api_key=${API_KEY}&type=both&lookup=${lookup}`);
    const json = await res.json();
    const first = Array.isArray(json.search) ? json.search[0] : null;
    const tempo = first?.tempo ? parseInt(first.tempo, 10) : null;
    const bpm = tempo && tempo > 0 ? tempo : null;
    cache.set(key, bpm);
    return bpm;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/** Enrich a list of tracks with BPM in small batches (polite to the free API). */
export async function enrichBpm(tracks, batchSize = 5) {
  const out = [];
  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize);
    const done = await Promise.all(
      batch.map(async (t) => (t.bpm != null ? t : { ...t, bpm: await bpmForTrack(t) }))
    );
    out.push(...done);
  }
  return out;
}
