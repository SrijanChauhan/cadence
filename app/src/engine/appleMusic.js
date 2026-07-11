/**
 * Cadence — Apple Music deep-link adapter (no MusicKit, no dev account)
 *
 * Uses Apple's free iTunes Lookup API to resolve an ISRC into an
 * Apple Music URL, then opens it — the Apple Music app takes over and
 * plays the FULL song under the user's own subscription.
 *
 * Limits (until the MusicKit phase):
 *  - one-way handoff: we can't control playback or read what happened
 *  - can't write playlists into the user's library (needs Music User Token)
 *
 * Lookup: https://itunes.apple.com/lookup?isrc=<ISRC>&entity=song&country=<CC>
 * Results are cached in-memory: ISRC→URL mappings are stable per session.
 */

import { Linking } from "react-native";

const cache = new Map(); // isrc -> url | null

/**
 * Resolve an ISRC to an Apple Music track URL.
 * @param {string} isrc
 * @param {string} country storefront country code (default IN)
 * @returns {Promise<string|null>}
 */
export async function appleMusicUrlForIsrc(isrc, country = "IN") {
  if (!isrc) return null;
  const key = `${country}:${isrc}`;
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
    return null; // network hiccup — treat as no match, don't cache
  }
}

/**
 * Open a track in the Apple Music app. Returns true if a match was
 * found and the redirect fired, false if no Apple Music match exists.
 */
export async function openInAppleMusic(track, country = "IN") {
  const url = await appleMusicUrlForIsrc(track.isrc, country);
  if (!url) return false;
  await Linking.openURL(url);
  return true;
}
