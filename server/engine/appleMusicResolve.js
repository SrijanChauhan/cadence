/**
 * Cadence — server-side Apple Music availability filter
 *
 * Every track handed to the client must actually redirect to something real
 * on tap. iTunes-sourced tracks already carry appleUrl directly (they came
 * FROM Apple's own catalog search, so they're verified by construction).
 * Deezer-sourced tracks need resolving:
 *   1. ISRC lookup — fast, precise WHEN it matches, but verified in practice
 *      to miss often: different platforms frequently distribute different
 *      masters of "the same" recording under different ISRCs, so an exact
 *      ISRC match against Apple's catalog regularly returns nothing even
 *      for artists who are definitely on Apple Music.
 *   2. Title+artist text search, checked against the top 5 results for a
 *      real artist-name match rather than trusting result #1 blindly — a
 *      naive top-hit search on a generic-sounding title can confidently
 *      return a completely different, wrong song (verified live: "Hip Hop"
 *      by "Mos Def" naive-searched straight to a Gorillaz track).
 * Tracks that resolve neither way are dropped rather than shown with a
 * redirect that's guaranteed to fail or point at the wrong song.
 */

const cache = new Map();

function normalizeArtist(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function artistsRoughlyMatch(a, b) {
  const na = normalizeArtist(a), nb = normalizeArtist(b);
  return !!na && !!nb && (na.includes(nb) || nb.includes(na));
}

async function urlForIsrc(isrc, country = "IN") {
  if (!isrc) return null;
  const key = `isrc:${country}:${isrc}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?isrc=${encodeURIComponent(isrc)}&entity=song&country=${country}`);
    const json = await res.json();
    const hit = (json.results || []).find((r) => r.trackViewUrl);
    const url = hit ? hit.trackViewUrl : null;
    cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

async function urlForSearch(title, artist, country = "IN") {
  if (!title) return null;
  const key = `search:${country}:${title}|${artist || ""}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const term = encodeURIComponent(artist ? `${title} ${artist}` : title);
    const res = await fetch(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=5&country=${country}`);
    const json = await res.json();
    const results = json.results || [];
    const hit = artist ? results.find((r) => artistsRoughlyMatch(r.artistName, artist)) : results[0];
    const url = hit ? hit.trackViewUrl : null;
    cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Resolve+attach a verified appleUrl for every track; drop any track with
 * no real Apple Music match instead of passing it through unresolved.
 */
export async function filterToAppleMusicAvailable(tracks, country = "IN", onDiag = () => {}) {
  const resolved = await Promise.all(tracks.map(async (t) => {
    if (t.appleUrl) return t; // iTunes-sourced — already verified by construction
    const url = (await urlForIsrc(t.isrc, country)) || (await urlForSearch(t.title, t.artist, country));
    return url ? { ...t, appleUrl: url } : null;
  }));
  const kept = resolved.filter(Boolean);
  const dropped = tracks.length - kept.length;
  if (dropped > 0) onDiag(`dropped ${dropped} track${dropped === 1 ? "" : "s"} with no verified Apple Music match`);
  return kept;
}
