/**
 * Cadence — MusicBrainz ISRC join
 *
 * iTunes tracks come back with isrc:null (see itunes.js). MusicBrainz's free
 * recording search can back-fill it via title+artist, but enforces a strict
 * 1 request/second for unauthenticated clients, and needs 2 calls per track
 * (search → lookup by MBID with inc=isrcs). That's too slow to block the
 * initial ~20-25 track search result on, so this runs as background,
 * progressive enrichment instead — resolve what we can, one at a time,
 * without freezing the UI. Nothing currently blocks on iTunes tracks having
 * an ISRC (appleMusic.js already prefers track.appleUrl, which iTunes gives
 * directly), so a miss here is harmless — this just fills in the data model
 * for future consumers (Apple Music library writes, cross-provider matching).
 */

const BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT = "Cadence/0.1 (+https://github.com/SrijanChauhan/cadence)";

const cache = new Map(); // "title|artist" -> isrc | null

// serialize all calls with a floor of ~1.1s between requests, across callers
let chain = Promise.resolve();
function throttled(fn) {
  const run = chain.then(() => new Promise((r) => setTimeout(r, 1100)).then(fn));
  chain = run.catch(() => {});
  return run;
}

async function mbFetch(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`);
  return res.json();
}

export async function isrcForTrack(title, artist) {
  if (!title || !artist) return null;
  const key = `${title}|${artist}`;
  if (cache.has(key)) return cache.get(key);

  const isrc = await throttled(async () => {
    try {
      const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
      const search = await mbFetch(`${BASE}/recording/?query=${q}&fmt=json&limit=1`);
      const rec = search.recordings?.[0];
      if (!rec) return null;
      if (rec.isrcs?.length) return rec.isrcs[0];
      const lookup = await mbFetch(`${BASE}/recording/${rec.id}?inc=isrcs&fmt=json`);
      return lookup.isrcs?.[0] || null;
    } catch {
      return null;
    }
  });

  cache.set(key, isrc);
  return isrc;
}

/**
 * Fire-and-forget: resolves ISRCs for tracks missing one, one at a time
 * (rate-limited), calling onEach(trackId, isrc) as each result lands.
 * Never throws, never blocks the caller.
 */
export function enrichIsrcInBackground(tracks, onEach) {
  (async () => {
    for (const t of tracks) {
      if (t.isrc) continue;
      const isrc = await isrcForTrack(t.title, t.artist);
      if (isrc) onEach(t.id, isrc);
    }
  })();
}
