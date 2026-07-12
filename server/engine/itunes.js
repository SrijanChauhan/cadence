/**
 * Cadence — iTunes Search API provider
 * Free, no auth, works in India (Deezer's catalog is territory-blocked there).
 * Gives: 30s previews, artwork, popularity-ish ordering, and the Apple Music
 * URL directly (trackViewUrl) — no ISRC lookup hop needed for handoff.
 * Does NOT give: BPM. Tracks come back with bpm:null; the ranker falls back
 * to popularity and the Bayesian layer simply doesn't update on them until a
 * BPM source is added (see musicProvider notes).
 */

const BASE = "https://itunes.apple.com/search";

export async function itunesSearchTracks({ seedTerms, limit = 25, country = "IN", onDiag = () => {} }) {
  const url = `${BASE}?term=${encodeURIComponent(seedTerms)}&media=music&entity=song&limit=${limit}&country=${country}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
  const json = await res.json();
  const tracks = (json.results || []).map(normalize).filter((t) => t.id);
  onDiag(`itunes "${seedTerms}" (${country}) → ${tracks.length} tracks`);
  return tracks;
}

function normalize(r) {
  return {
    id: `it_${r.trackId}`,
    title: r.trackName,
    artist: r.artistName || "Unknown",
    album: r.collectionName || "",
    cover: r.artworkUrl100 ? r.artworkUrl100.replace("100x100", "200x200") : null,
    durationSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
    rank: 0,                     // iTunes returns relevance-ordered; keep order weight neutral
    preview: r.previewUrl || null, // 30s clip, plays in expo-av
    isrc: null,
    appleUrl: r.trackViewUrl || null, // direct Apple Music deep link
    genre: r.primaryGenreName || null,
    bpm: null,                   // iTunes has no tempo data
  };
}

/**
 * NOT CURRENTLY WIRED IN (see musicProvider.js) — verified against a live
 * response that the public, unauthenticated iTunes Lookup API does NOT
 * include an isrc field despite what an earlier version of this comment
 * claimed. Left here in case a real ISRC source (MusicKit w/ dev token,
 * MusicBrainz) gets wired in later; calling this today just returns null.
 */
export async function isrcForTrackId(rawId, country = "IN") {
  const numeric = String(rawId).replace(/^it_/, "");
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${numeric}&country=${country}`);
    const json = await res.json();
    return json.results?.[0]?.isrc || null;
  } catch {
    return null;
  }
}

/** Enrich iTunes tracks with ISRC (batched). */
export async function enrichIsrc(tracks, batchSize = 8, country = "IN") {
  const out = [];
  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize);
    const done = await Promise.all(
      batch.map(async (t) => (t.isrc ? t : { ...t, isrc: await isrcForTrackId(t.id, country) }))
    );
    out.push(...done);
  }
  return out;
}
