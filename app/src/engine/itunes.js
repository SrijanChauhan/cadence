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
