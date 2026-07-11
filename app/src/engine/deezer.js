/**
 * Cadence — Deezer adapter (MusicProvider implementation)
 *
 * v2 — FIX: Deezer's advanced search returns zero results when free-text
 * seed terms are combined with bpm_min/bpm_max in one query. New strategy:
 *   1. search by seed terms only (wide net, limit ~50)
 *   2. enrich with per-track BPM via /track/{id}
 *   3. filter to the target BPM band CLIENT-SIDE
 *   4. if fewer than MIN_KEEP tracks match, fall back to the closest-by-BPM
 *      tracks instead of returning empty
 *
 * Deezer facts used here:
 *  - /search and /track need no auth.
 *  - Search results do NOT include BPM; /track/{id} does (plus gain, ISRC).
 *  - preview = 30s MP3, SIGNED URL, expires in hours: never persist it.
 *  - Some tracks have bpm = 0 (unanalyzed) — treat as unknown, not as 0 BPM.
 */

const BASE = "https://api.deezer.com";
const MIN_KEEP = 5; // if band-filtering leaves fewer than this, use closest-by-BPM

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Deezer API: ${json.error.message || "unknown error"}`);
  return json;
}

/**
 * Main entry: search by seed terms, enrich with BPM, band-filter client-side.
 * Same signature as v1 so callers don't change.
 * Returns tracks sorted: in-band first, then nearest-to-band.
 */
export async function searchTracks({ seedTerms, bpmMin, bpmMax, limit = 20 }) {
  // 1. wide text-only search — no bpm operators in the query string
  const q = encodeURIComponent(seedTerms);
  const json = await get(`/search?q=${q}&limit=50&order=RANKING`);
  const raw = (json.data || []).map(normalizeTrack);
  if (raw.length === 0) return [];

  // 2. enrich with BPM (batched detail calls)
  const detailed = await enrichWithBpm(raw);

  // 3. split: in-band / has-BPM-but-out-of-band / unknown-BPM
  const mid = (bpmMin + bpmMax) / 2;
  const inBand = [];
  const outOfBand = [];
  const unknown = [];
  for (const t of detailed) {
    if (t.bpm == null) unknown.push(t);
    else if (t.bpm >= bpmMin && t.bpm <= bpmMax) inBand.push(t);
    else outOfBand.push(t);
  }

  // 4. build the result: in-band first; top up with closest-by-BPM, then unknowns
  outOfBand.sort((a, b) => Math.abs(a.bpm - mid) - Math.abs(b.bpm - mid));
  let result = [...inBand];
  if (result.length < MIN_KEEP) {
    result = result.concat(outOfBand.slice(0, MIN_KEEP - result.length));
  }
  if (result.length < MIN_KEEP) {
    result = result.concat(unknown.slice(0, MIN_KEEP - result.length));
  }
  // fill remaining space up to `limit` with whatever is closest, keeps list rich
  if (result.length < limit) {
    const used = new Set(result.map((t) => t.id));
    const rest = [...outOfBand, ...unknown].filter((t) => !used.has(t.id));
    result = result.concat(rest.slice(0, limit - result.length));
  }
  return result.slice(0, limit);
}

/** Fetch full detail for one track — includes bpm, gain, isrc. bpm 0 → null. */
export async function trackDetail(id) {
  const t = await get(`/track/${id}`);
  const bpm = t.bpm && t.bpm > 0 ? t.bpm : null;
  return { ...normalizeTrack(t), bpm, gain: t.gain ?? null, isrc: t.isrc || null };
}

/**
 * Enrich a list of search results with BPM via detail calls.
 * Small batches to be polite to the API; failures degrade to bpm:null.
 */
export async function enrichWithBpm(tracks, batchSize = 8) {
  const out = [];
  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize);
    const detailed = await Promise.all(
      batch.map((t) => trackDetail(t.id).catch(() => ({ ...t, bpm: null })))
    );
    out.push(...detailed);
  }
  return out;
}

function normalizeTrack(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist?.name || "Unknown",
    album: t.album?.title || "",
    cover: t.album?.cover_medium || t.album?.cover || null,
    durationSec: t.duration || 0,
    rank: t.rank || 0,           // Deezer popularity signal
    preview: t.preview || null,  // 30s MP3 — signed URL, expires; fetch fresh each session
  };
}
