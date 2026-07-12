/**
 * Cadence — Apple Music deep-link adapter
 *
 * Resolution order:
 *   1. track.appleUrl — set directly for iTunes-provider tracks, always
 *      correct, no network call needed.
 *   2. ISRC lookup — fast and precise WHEN it works, but verified in
 *      practice to miss often for Deezer-provider tracks: different
 *      platforms frequently press/distribute different masters of "the
 *      same" recording under different ISRCs, so an exact ISRC match
 *      against Apple's catalog regularly returns zero results even for
 *      artists who are definitely on Apple Music.
 *   3. Title+artist text search, checked against the top 5 results (not
 *      just the first) for a real artist-name match before accepting —
 *      a naive "take result #1" search on a generic-sounding title can
 *      confidently return a completely different, wrong song. Requiring
 *      an artist match on one of the first 5 results is what actually
 *      finds the right track when it isn't the top hit, while still
 *      refusing to redirect to something wrong.
 * No MusicKit / dev account needed for any of this — it's all handoff,
 * not library writes.
 */

import { Linking } from "react-native";

const cache = new Map(); // cache key -> url | null

function normalizeArtist(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function artistsRoughlyMatch(a, b) {
  const na = normalizeArtist(a), nb = normalizeArtist(b);
  return !!na && !!nb && (na.includes(nb) || nb.includes(na));
}

export async function appleMusicUrlForIsrc(isrc, country = "IN") {
  if (!isrc) return null;
  const key = `isrc:${country}:${isrc}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?isrc=${encodeURIComponent(isrc)}&entity=song&country=${country}`
    );
    const json = await res.json();
    const hit = (json.results || []).find((r) => r.trackViewUrl);
    const url = hit ? hit.trackViewUrl : null;
    cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

async function appleMusicUrlForSearch(title, artist, country = "IN") {
  if (!title) return null;
  const key = `search:${country}:${title}|${artist || ""}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const term = encodeURIComponent(artist ? `${title} ${artist}` : title);
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=5&country=${country}`
    );
    const json = await res.json();
    const results = json.results || [];
    const hit = artist
      ? results.find((r) => artistsRoughlyMatch(r.artistName, artist))
      : results[0];
    const url = hit ? hit.trackViewUrl : null;
    cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

export async function openInAppleMusic(track, country = "IN") {
  const url =
    track.appleUrl ||
    (await appleMusicUrlForIsrc(track.isrc, country)) ||
    (await appleMusicUrlForSearch(track.title, track.artist, country));
  if (!url) return false;
  await Linking.openURL(url);
  return true;
}
