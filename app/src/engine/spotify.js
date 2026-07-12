/**
 * Cadence — Spotify playlist adapter (Path 2: create a real saved playlist)
 *
 * Auth: Authorization Code with PKCE (no client secret — safe for mobile).
 * Flow:
 *   1. connectSpotify() opens Spotify's login in an in-app browser via
 *      WebBrowser.openAuthSessionAsync, which resolves with the
 *      cadence://spotify-auth?code=... redirect URL directly — no App.js
 *      deep-link listener needed (openAuthSessionAsync doesn't fire one).
 *   2. connectSpotify() extracts the code from that result and calls
 *      exchangeCode(code) itself.
 *   3. createPlaylistFromTracks() searches each track by title+artist,
 *      creates a playlist in the user's library, and adds the matches.
 *
 * Requires Spotify Premium on the connected account (Feb 2026 policy).
 * Endpoints use the current (Feb 2026) Web API shapes:
 *   POST /me/playlists , POST /playlists/{id}/tracks (add items).
 */

import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CLIENT_ID = "5cb328659de34b61bf3a437fd42e20c0";
const REDIRECT_URI = "cadence://spotify-auth";
// user-top-read powers the "blend in artists you actually listen to" search —
// see getTopArtists(). Everything else is playlist-write, unchanged.
const SCOPES = "playlist-modify-private playlist-modify-public user-top-read";
const TOKEN_KEY = "cadence:spotify:refreshToken";

let accessToken = null;
let refreshToken = null;
let tokenExpiry = 0;
let pkceVerifier = null;
let cachedUserId = null;

export function hasSpotifyAuth() {
  return !!accessToken && Date.now() < tokenExpiry;
}

/**
 * Try to silently resume a previous Spotify session using a persisted
 * refresh token, so the user isn't asked to reconnect every app launch.
 * Returns true if it worked. Safe to call even with no saved token.
 */
export async function restoreSpotifySession() {
  try {
    const saved = await AsyncStorage.getItem(TOKEN_KEY);
    if (!saved) return false;
    refreshToken = saved;
    tokenExpiry = 0; // force refreshIfNeeded() to actually refresh
    await refreshIfNeeded();
    return true;
  } catch {
    return false;
  }
}

// ---- PKCE helpers ----
function randomString(len = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let out = "";
  const bytes = Crypto.getRandomBytes(len);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function sha256Base64Url(input) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  // base64 -> base64url
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Step 1+3: open Spotify login, capture the returned code, exchange for tokens.
 *  Returns true on success. The code arrives in the browser result URL — we do
 *  NOT rely on a deep-link listener (it doesn't fire for openAuthSessionAsync). */
export async function connectSpotify() {
  pkceVerifier = randomString(64);
  const challenge = await sha256Base64Url(pkceVerifier);
  const url =
    "https://accounts.spotify.com/authorize" +
    `?client_id=${CLIENT_ID}` +
    "&response_type=code" +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    "&code_challenge_method=S256" +
    `&code_challenge=${challenge}`;
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_URI);
  if (result.type !== "success" || !result.url) return false;
  const match = result.url.match(/[?&]code=([^&]+)/);
  if (!match) return false;
  await exchangeCode(decodeURIComponent(match[1]));
  return true;
}

/** Step 3: exchange the returned code for tokens. Called from the deep-link handler. */
export async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: pkceVerifier,
  }).toString();

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${json.error_description || json.error}`);
  accessToken = json.access_token;
  refreshToken = json.refresh_token;
  tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  if (refreshToken) AsyncStorage.setItem(TOKEN_KEY, refreshToken).catch(() => {});
}

async function refreshIfNeeded() {
  if (Date.now() < tokenExpiry) return;
  if (!refreshToken) throw new Error("Session expired — reconnect Spotify.");
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error("Couldn't refresh Spotify session.");
  accessToken = json.access_token;
  tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  if (json.refresh_token) {
    refreshToken = json.refresh_token;
    AsyncStorage.setItem(TOKEN_KEY, refreshToken).catch(() => {});
  }
}

async function api(path, opts = {}) {
  await refreshIfNeeded();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${json.error?.message || "error"}`);
  return json;
}

async function getUserId() {
  if (cachedUserId) return cachedUserId;
  const me = await api("/me");
  cachedUserId = me.id;
  return cachedUserId;
}

/**
 * Your actual top artists (medium_term = ~last 6 months), for blending real
 * listening history into search instead of generic genre terms. Spotify
 * closed Related Artists/Recommendations in Nov 2024 (see music-data-layer.md)
 * so there's no free "similar artist" API left — genres on each top artist
 * are the closest free substitute for "adjacent" discovery.
 * Returns { names: string[], genres: string[] }, both deduped, or empty
 * arrays (never throws) if not connected or the call fails.
 */
export async function getTopArtists(limit = 8) {
  if (!hasSpotifyAuth()) return { names: [], genres: [] };
  try {
    const json = await api(`/me/top/artists?limit=${limit}&time_range=medium_term`);
    const items = json.items || [];
    const names = [...new Set(items.map((a) => a.name).filter(Boolean))];
    const genres = [...new Set(items.flatMap((a) => a.genres || []))];
    return { names, genres };
  } catch {
    return { names: [], genres: [] };
  }
}

/** Search Spotify for one track by title + artist; return its URI or null. */
async function findTrackUri(track) {
  const q = encodeURIComponent(`track:${track.title} artist:${track.artist}`);
  try {
    const json = await api(`/search?q=${q}&type=track&limit=1`);
    const hit = json.tracks?.items?.[0];
    if (hit) return hit.uri;
    // looser retry without field filters
    const q2 = encodeURIComponent(`${track.title} ${track.artist}`);
    const json2 = await api(`/search?q=${q2}&type=track&limit=1`);
    return json2.tracks?.items?.[0]?.uri || null;
  } catch {
    return null;
  }
}

/**
 * Create a playlist in the user's Spotify library from Cadence tracks.
 * Returns { url, matchedCount, totalCount }.
 */
export async function createPlaylistFromTracks(tracks, { name = "Cadence Session", description = "" } = {}) {
  if (!hasSpotifyAuth()) throw new Error("Not connected to Spotify — connect first.");
  // match tracks -> spotify URIs
  const uris = [];
  for (const t of tracks) {
    const uri = await findTrackUri(t);
    if (uri) uris.push(uri);
  }
  if (uris.length === 0) throw new Error("None of your tracks were found on Spotify.");

  // create the (private) playlist
  const playlist = await api(`/me/playlists`, {
    method: "POST",
    body: JSON.stringify({ name, description, public: false }),
  });

  // add items (max 100 per request; we're well under)
  // NB: POST /playlists/{id}/tracks was removed in Spotify's Feb 2026 API
  // migration — /items is the replacement, same { uris } body shape.
  await api(`/playlists/${playlist.id}/items`, {
    method: "POST",
    body: JSON.stringify({ uris }),
  });

  return {
    url: playlist.external_urls?.spotify || null,
    matchedCount: uris.length,
    totalCount: tracks.length,
  };
}
