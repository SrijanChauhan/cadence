/**
 * Cadence — Apple Music deep-link adapter
 * If the track already carries a direct Apple Music URL (iTunes provider),
 * open it straight away. Otherwise resolve via free iTunes ISRC lookup
 * (Deezer provider path). No MusicKit / dev account needed for handoff.
 */

import { Linking } from "react-native";

const cache = new Map(); // isrc -> url | null

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
    return null;
  }
}

export async function openInAppleMusic(track, country = "IN") {
  const url = track.appleUrl || (await appleMusicUrlForIsrc(track.isrc, country));
  if (!url) return false;
  await Linking.openURL(url);
  return true;
}
