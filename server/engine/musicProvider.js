/**
 * Cadence — unified music provider
 * Tries Deezer first (has BPM). If Deezer is territory-blocked — detectable
 * as data:[] with total>0, exactly what an India IP sees — falls back to the
 * iTunes Search API (no BPM, but previews + direct Apple Music links).
 * The chosen provider is remembered for the session so we don't re-probe.
 *
 * BPM note: with iTunes as source, tracks have bpm:null. The Bayesian layer
 * ignores null-BPM feedback (by design), so λ stays at 100% until a BPM
 * source is added (e.g. GetSongBPM lookup — future step). Everything else
 * (previews, feedback capture, Apple handoff, picks) works fully.
 */

import { searchTracks as deezerSearch } from "./deezer.js";
import { itunesSearchTracks } from "./itunes.js";
import { enrichBpm } from "./getSongBpm.js";
import { filterToAppleMusicAvailable } from "./appleMusicResolve.js";

// 'deezer' | 'itunes' — sticky WITHIN one /recommend call (avoids re-probing
// Deezer on every genre term in the same request), but must be reset at the
// start of each request via resetProvider() — this used to be a true module-
// level global with no reset, meaning the first successful probe from ANY
// user locked the provider for every other user for the server's entire
// uptime. See server/index.js's /recommend handler for the reset call.
let provider = null;

export function resetProvider() {
  provider = null;
}

export async function searchTracks(opts) {
  const { onDiag = () => {} } = opts;

  if (provider === "itunes") return enrichItunes(await itunesSearchTracks(opts), onDiag);
  if (provider === "deezer") return deezerSearch(opts);

  // probe: try Deezer once
  try {
    const results = await deezerSearch(opts);
    if (results.length > 0) {
      provider = "deezer";
      onDiag("provider locked: deezer (BPM available)");
      return results;
    }
    onDiag("deezer returned empty — likely territory-blocked; switching to iTunes");
  } catch (e) {
    onDiag(`deezer failed (${e.message}) — switching to iTunes`);
  }

  provider = "itunes";
  onDiag("provider locked: itunes — enriching BPM (GetSongBPM)");
  return enrichItunes(await itunesSearchTracks(opts), onDiag);
}

export function currentProvider() {
  return provider;
}

/**
 * Stock/library-music detector. Generic search terms like "edm workout" or
 * "power rock" are flooded on iTunes by production-music publishers, under
 * randomized-looking fake artist names ("331Music", "Saltonbria", "Jason
 * Xtreme Shap") that don't share a reliable naming pattern — so matching on
 * the ARTIST name alone misses most of them. The one thing that IS reliable:
 * their TITLE is built entirely out of generic genre/activity descriptor
 * words ("EDM Workout", "Power Rock", "Gym Workout"), because the title is
 * effectively just the search term restated. Real songs occasionally use
 * ONE generic word as a title ("Power" by Kanye West is real) but almost
 * never string two-or-more of these words together as the whole title —
 * so this only flags titles with >=2 words where every word is generic.
 * These junk tracks often carry accurate BPM tags too (publishers tag tempo
 * deliberately), so a naive BPM-proximity sort ranks them ABOVE real
 * artists if they aren't filtered out first.
 */
const GENERIC_TITLE_WORDS = new Set([
  "edm", "workout", "gym", "power", "rock", "running", "run", "music", "fitness",
  "cardio", "training", "train", "motivation", "motivational", "mix", "session",
  "sessions", "playlist", "hits", "songs", "song", "beats", "beat", "dance",
  "cool", "down", "chill", "ibiza", "xtreme", "sport", "sports", "bodybuilding",
  "bootcamp", "boot", "camp", "walk", "walking", "jogging", "pump", "pumped",
  "intense", "energy", "trainer", "series", "squad", "crew", "prodigy", "for",
  "the", "and", "of", "a", "to",
]);

function isGenericTitle(title) {
  const words = (title || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const contentWords = words.filter((w) => w !== "for" && w !== "the" && w !== "and" && w !== "of" && w !== "a" && w !== "to");
  if (contentWords.length < 2) return false; // single generic word is very likely a real title
  return words.every((w) => GENERIC_TITLE_WORDS.has(w));
}

function isStockMusic(track) {
  return isGenericTitle(track.title);
}

/**
 * Cross-genre search: queries every term in seedPool (instead of one random
 * pick), merges the results, drops stock/library-music junk and repeat
 * artists (first occurrence wins — results are already roughly rank/BPM-
 * ordered per source), then sorts the merged pool by closeness to the
 * target BPM band so genre variety doesn't come at the cost of tempo match.
 * First term runs alone so the sticky Deezer/iTunes provider decision locks
 * before the rest fire in parallel.
 */
export async function searchAcrossGenres({ seedPool, bpmMin, bpmMax, limit = 20, onDiag = () => {} }) {
  const terms = seedPool && seedPool.length ? seedPool : [undefined];
  const perTerm = Math.max(6, Math.ceil((limit * 1.5) / terms.length));

  const [first, ...rest] = terms;
  const results = [await searchTracks({ seedTerms: first, bpmMin, bpmMax, limit: perTerm, onDiag })];
  if (rest.length) {
    const more = await Promise.all(
      rest.map((seedTerms) => searchTracks({ seedTerms, bpmMin, bpmMax, limit: perTerm, onDiag }).catch(() => []))
    );
    results.push(...more);
  }
  onDiag(`explored ${terms.length} genre${terms.length === 1 ? "" : "s"}: ${terms.join(", ")}`);

  let merged = results.flat();
  const beforeJunkFilter = merged.length;
  merged = merged.filter((t) => !isStockMusic(t));
  if (beforeJunkFilter !== merged.length) {
    onDiag(`dropped ${beforeJunkFilter - merged.length} stock/library-music junk tracks`);
  }

  const seenArtists = new Set();
  const deduped = [];
  for (const t of merged) {
    const key = (t.artist || "").trim().toLowerCase();
    if (key && seenArtists.has(key)) continue;
    if (key) seenArtists.add(key);
    deduped.push(t);
  }
  onDiag(`merged ${merged.length} → ${deduped.length} after dropping repeat artists`);

  // every track shown to the client must actually redirect to something
  // real on tap — iTunes tracks are verified by construction, Deezer tracks
  // get resolved (ISRC, then validated text search) and dropped if neither
  // finds a real match
  const verified = await filterToAppleMusicAvailable(deduped, "IN", onDiag);

  const mid = (bpmMin + bpmMax) / 2;
  const distance = (t) => (t.bpm == null ? Infinity : Math.abs(t.bpm - mid));
  verified.sort((a, b) => distance(a) - distance(b));

  return verified.slice(0, limit);
}

/**
 * iTunes tracks lack BPM; fill it so the seed band + Bayesian learning work.
 * ISRC is NOT enriched here — Apple's public iTunes Lookup API (verified
 * against a live response) doesn't expose an isrc field at all, so a lookup
 * call would just be a wasted round-trip per track. isrc stays null for
 * iTunes-sourced tracks, same as before enrichment; nothing currently reads
 * it for them (Apple handoff uses appleUrl directly, Spotify match is by
 * title+artist) so this is a no-op removed, not a feature lost.
 */
async function enrichItunes(tracks, onDiag = () => {}) {
  const out = await enrichBpm(tracks);
  const withBpm = out.filter((t) => t.bpm != null).length;
  onDiag(`enriched: ${withBpm}/${out.length} have BPM`);
  return out;
}
