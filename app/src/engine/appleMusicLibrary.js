/**
 * Cadence — Apple Music LIBRARY write layer
 * (creating a real playlist in the user's Apple Music account)
 *
 * Distinct from appleMusic.js (which just deep-links to play a single song —
 * no auth needed). This file WRITES to the user's library, which requires:
 *   - a developer token (see musickit-auth/generate-dev-token.js)
 *   - a user token (obtained via the auth.html web flow, opened in-app)
 *
 * Flow:
 *   1. openAppleMusicAuth() opens musickit-auth/auth.html (hosted on GitHub
 *      Pages) in an in-app browser.
 *   2. User taps Connect -> Apple's native auth sheet -> auth.html redirects
 *      back into the app via cadence://apple-music-auth?token=...
 *   3. App catches that deep link (wired in App.js), stores the user token.
 *   4. createPlaylistFromQueue() uses both tokens to:
 *        a) resolve each queued track's ISRC to an Apple catalog song ID
 *        b) POST a new playlist to /v1/me/library/playlists with those songs
 */

import * as WebBrowser from "expo-web-browser";

const DEVELOPER_TOKEN = "PASTE_YOUR_DEVELOPER_TOKEN_HERE"; // same token as auth.html
const AUTH_PAGE_URL = "https://YOUR_GITHUB_USERNAME.github.io/cadence-musickit-auth/auth.html";
const STOREFRONT = "in"; // Apple storefront code for India

let userToken = null;

export function setUserToken(token) { userToken = token; }
export function hasAppleMusicAuth() { return !!userToken; }

/** Opens the web auth page. Resolves once the browser tab is dismissed;
 *  the actual token arrives separately via the cadence:// deep link. */
export async function openAppleMusicAuth() {
  await WebBrowser.openBrowserAsync(AUTH_PAGE_URL);
}

async function appleFetch(path, opts = {}) {
  const res = await fetch(`https://api.music.apple.com/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${DEVELOPER_TOKEN}`,
      "Music-User-Token": userToken,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Apple Music API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** ISRC -> Apple catalog song id, using the (free, no-auth) developer-token-only endpoint. */
async function catalogIdForIsrc(isrc) {
  if (!isrc) return null;
  try {
    const json = await appleFetch(`/catalog/${STOREFRONT}/songs?filter[isrc]=${encodeURIComponent(isrc)}`);
    return json.data?.[0]?.id || null;
  } catch {
    return null;
  }
}

/**
 * Create a playlist in the user's Apple Music library from a list of
 * Cadence tracks (needs .isrc on each — present when sourced via Deezer;
 * iTunes-sourced tracks don't carry ISRC yet, see note in music-data-layer.md).
 */
export async function createPlaylistFromQueue(tracks, { name = "Cadence Session", description = "" } = {}) {
  if (!userToken) throw new Error("Not connected to Apple Music yet — call openAppleMusicAuth() first.");

  const ids = [];
  for (const t of tracks) {
    const id = t.appleCatalogId || (await catalogIdForIsrc(t.isrc));
    if (id) ids.push(id);
  }
  if (ids.length === 0) throw new Error("None of the queued tracks matched the Apple Music catalog.");

  const playlist = await appleFetch("/me/library/playlists", {
    method: "POST",
    body: JSON.stringify({
      attributes: { name, description },
      relationships: {
        tracks: { data: ids.map((id) => ({ id, type: "songs" })) },
      },
    }),
  });

  return { playlist, matchedCount: ids.length, totalCount: tracks.length };
}
