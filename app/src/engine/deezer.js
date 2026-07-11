/**
 * Cadence — Deezer adapter v3
 *
 * Changes vs v2:
 *  - DIAGNOSTICS: searchTracks accepts onDiag(msg) so the UI can show where
 *    the pipeline is (searched N, enriched M, in-band K) — debuggable on-device.
 *  - FALLBACK CHAIN: text search → (if empty) genre-stripped shorter query →
 *    (if still empty) Deezer global chart tracks. Something always loads.
 *  - RATE-LIMIT FRIENDLY: Deezer allows ~50 req/5s per IP. We cap search at 25
 *    results and batch detail calls (8 at a time, 600ms gap between batches).
 *  - Track availability: skips tracks flagged unreadable in this territory.
 */

const BASE = "https://api.deezer.com";
const MIN_KEEP = 5;

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Deezer API: ${json.error.message || JSON.stringify(json.error)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function searchTracks({ seedTerms, bpmMin, bpmMax, limit = 20, onDiag = () => {} }) {
  // ---- 1. candidate fetch with fallback chain ----
  let raw = [];
  let source = "search";
  try {
    const json = await get(`/search?q=${encodeURIComponent(seedTerms)}&limit=25&order=RANKING`);
    raw = (json.data || []).map(normalizeTrack);
  } catch (e) {
    onDiag(`search failed: ${e.message}`);
  }
  onDiag(`search "${seedTerms}" → ${raw.length} tracks`);

  if (raw.length === 0) {
    // shorter query: first word only (e.g. "slow jazz" → "jazz")
    const shortQ = seedTerms.split(" ").pop();
    try {
      const json = await get(`/search?q=${encodeURIComponent(shortQ)}&limit=25&order=RANKING`);
      raw = (json.data || []).map(normalizeTrack);
      source = "short-search";
      onDiag(`fallback search "${shortQ}" → ${raw.length}`);
    } catch (e) { onDiag(`fallback search failed: ${e.message}`); }
  }

  if (raw.length === 0) {
    // last resort: global chart — always populated, proves connectivity
    try {
      const json = await get(`/chart/0/tracks?limit=25`);
      raw = (json.data || []).map(normalizeTrack);
      source = "chart";
      onDiag(`chart fallback → ${raw.length}`);
    } catch (e) {
      onDiag(`chart failed: ${e.message}`);
      throw new Error(`Deezer unreachable from this network (${e.message}). Check the diag line.`);
    }
  }

  // drop tracks with no preview AND no id (junk), keep unreadable ones out
  raw = raw.filter((t) => t.id);

  // ---- 2. enrich with BPM, rate-limit friendly ----
  const detailed = await enrichWithBpm(raw, 8, onDiag);
  const withBpm = detailed.filter((t) => t.bpm != null).length;
  onDiag(`enriched: ${withBpm}/${detailed.length} have BPM`);

  // ---- 3. client-side band filter with closest-match fallback ----
  const mid = (bpmMin + bpmMax) / 2;
  const inBand = [], outOfBand = [], unknown = [];
  for (const t of detailed) {
    if (t.bpm == null) unknown.push(t);
    else if (t.bpm >= bpmMin && t.bpm <= bpmMax) inBand.push(t);
    else outOfBand.push(t);
  }
  onDiag(`band ${bpmMin}-${bpmMax}: ${inBand.length} in, ${outOfBand.length} out, ${unknown.length} unknown (src: ${source})`);

  outOfBand.sort((a, b) => Math.abs(a.bpm - mid) - Math.abs(b.bpm - mid));
  let result = [...inBand];
  if (result.length < MIN_KEEP) result = result.concat(outOfBand.slice(0, MIN_KEEP - result.length));
  if (result.length < MIN_KEEP) result = result.concat(unknown.slice(0, MIN_KEEP - result.length));
  if (result.length < limit) {
    const used = new Set(result.map((t) => t.id));
    const rest = [...outOfBand, ...unknown].filter((t) => !used.has(t.id));
    result = result.concat(rest.slice(0, limit - result.length));
  }
  return result.slice(0, limit);
}

export async function trackDetail(id) {
  const t = await get(`/track/${id}`);
  const bpm = t.bpm && t.bpm > 0 ? t.bpm : null;
  return { ...normalizeTrack(t), bpm, gain: t.gain ?? null, isrc: t.isrc || null };
}

export async function enrichWithBpm(tracks, batchSize = 8, onDiag = () => {}) {
  const out = [];
  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize);
    const detailed = await Promise.all(
      batch.map((t) => trackDetail(t.id).catch(() => ({ ...t, bpm: null })))
    );
    out.push(...detailed);
    if (i + batchSize < tracks.length) await sleep(600); // stay under 50 req / 5s
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
    rank: t.rank || 0,
    preview: t.preview || null,
    isrc: t.isrc || null,
  };
}
