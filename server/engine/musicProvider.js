/**
 * Cadence — unified music provider
 *
 * iTunes Search API only. Previously tried Deezer first (native BPM) with
 * an iTunes fallback for territory-blocked requests (e.g. from India), but
 * that's been dropped: every track handed to the client must have a
 * verified Apple Music redirect (see appleMusicResolve.js), and Deezer
 * tracks require resolving that after the fact via ISRC/text-search —
 * which, measured live in production, fails 75-100% of the time for
 * instrumental/ambient/focus genres specifically (different masters/
 * catalogs across platforms), sometimes returning zero playable tracks for
 * Deep Work and Calls modes entirely. iTunes tracks carry their Apple
 * Music URL directly from the same search that found them, so they're
 * verified by construction with zero drop rate — that's the whole
 * category of failure this removes, not just a mitigation.
 *
 * BPM comes from GetSongBPM enrichment (iTunes itself has no tempo data).
 * The Bayesian layer ignores null-BPM feedback (by design), so λ stays at
 * 100% only for tracks GetSongBPM couldn't match — same graceful
 * degradation as before, just without Deezer as an alternate BPM source.
 */

import { itunesSearchTracks } from "./itunes.js";
import { enrichBpm } from "./getSongBpm.js";
import { filterToAppleMusicAvailable } from "./appleMusicResolve.js";

export async function searchTracks(opts) {
  const { onDiag = () => {} } = opts;
  return enrichItunes(await itunesSearchTracks(opts), onDiag);
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
  // instrumental/ambient/focus library brands use a different vocabulary
  // entirely from the workout-oriented words above ("Piano Ambient",
  // "Focus Zone") — added once this list started also screening candidate
  // ARTIST names for Top Artists, not just track titles (see pickTopArtists).
  "ambient", "piano", "instrumental", "focus", "lounge", "zone", "study",
  "concentration", "calm", "relax", "relaxing", "meditation", "spa", "acoustic",
  "sounds", "sound",
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
 *
 * excludeIds: iTunes's search ranking is deterministic — the same query
 * returns the same top results every time, so a plain re-call (e.g. a
 * "Refresh Playlist" tap) would silently hand back the identical track set.
 * When the client sends track ids it has already seen, this fetches a
 * larger per-term pool specifically to compensate, then drops those ids
 * before ranking, so a refresh surfaces genuinely different tracks instead
 * of re-serving the same ones.
 */
export async function searchAcrossGenres({ seedPool, bpmMin, bpmMax, limit = 20, excludeIds = [], onDiag = () => {} }) {
  const terms = seedPool && seedPool.length ? seedPool : [undefined];
  const excludeSet = new Set(excludeIds);
  // iTunes search is deterministic — same term + same limit always returns
  // the same top-N results in the same order, there's no offset param. So a
  // FIXED perTerm doesn't just need "extra headroom" once; it needs to grow
  // with excludeSet.size every call, or repeated refreshes fetch the exact
  // same top slice each time and an ever-larger fraction of it gets filtered
  // out as already-seen, shrinking the surviving pool refresh over refresh.
  // Scaling by excludeSet.size reaches deeper into each term's ranked
  // results as more tracks accumulate as "seen", so fresh ones keep surfacing.
  // Capped at 200, the documented max for iTunes's `limit` parameter.
  const perTerm = Math.min(200, Math.max(6, Math.ceil((limit * 1.5 + excludeSet.size) / terms.length)));

  // Every term is caught individually (including what used to be a special-
  // cased, uncaught "first" term) — iTunes rate-limits per IP, and even
  // with fetchWithRetry's backoff a term can still fail. One failed term
  // should just contribute zero tracks, not take down the whole refresh.
  const results = await Promise.all(
    terms.map((seedTerms) =>
      searchTracks({ seedTerms, bpmMin, bpmMax, limit: perTerm, onDiag }).catch((e) => {
        onDiag(`"${seedTerms}" search failed, skipping: ${e.message}`);
        return [];
      })
    )
  );
  onDiag(`explored ${terms.length} genre${terms.length === 1 ? "" : "s"}: ${terms.join(", ")}`);

  let merged = results.flat();
  const beforeJunkFilter = merged.length;
  merged = merged.filter((t) => !isStockMusic(t));
  if (beforeJunkFilter !== merged.length) {
    onDiag(`dropped ${beforeJunkFilter - merged.length} stock/library-music junk tracks`);
  }

  if (excludeSet.size) {
    const beforeExclude = merged.length;
    merged = merged.filter((t) => !excludeSet.has(t.id));
    onDiag(`dropped ${beforeExclude - merged.length} already-seen tracks (refresh)`);
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

  // defensive pass-through: every current track already carries appleUrl
  // (iTunes-only source, verified by construction) so this is a fast no-op
  // in practice, kept as a safety net if that ever stops being true
  const verified = await filterToAppleMusicAvailable(deduped, "IN", onDiag);

  const mid = (bpmMin + bpmMax) / 2;
  const distance = (t) => (t.bpm == null ? Infinity : Math.abs(t.bpm - mid));
  verified.sort((a, b) => distance(a) - distance(b));

  return verified.slice(0, limit);
}

/**
 * Cadence — "Top Artists for You" (Profile's personality-driven artist
 * list, see POST /discover in index.js). Real artists — your actual
 * Spotify top artists plus their real Last.fm similar artists, passed in
 * already deduped — fill slots first; whatever's left over is filled with
 * one representative artist per genre seed, so the list stays genre-diverse
 * and "consistent to behaviour and personality" (discoverSeedTarget's seed
 * pool is already trait-filtered) even when Spotify isn't connected and
 * there's no real listening data to draw on at all.
 *
 * Returns { name, cover } objects, not plain names — the Profile UI shows a
 * picture per artist the same way it does per track, and needs something to
 * point at. Genre-driven picks already have one for free (they came from an
 * iTunes track search); real artists (from Spotify/Last.fm, name-only) get
 * one via a cheap extra one-track iTunes lookup per name, done in parallel
 * since these are independent of each other and of the genre-fill pass.
 *
 * fetchCovers defaults on for real callers; musicProvider.test.js passes
 * false to keep exercising the pure real-artists-fill-the-limit path
 * without hitting a live API (covers come back null in that case).
 */
export async function pickTopArtists({ seedPool, realArtists = [], limit = 5, onDiag = () => {}, fetchCovers = true }) {
  const seen = new Set();
  const names = [];
  const covers = new Map(); // lowercased name -> cover url or null
  const realCount = Math.min(realArtists.length, limit);

  for (const name of realArtists) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name.trim());
    if (names.length >= limit) break;
  }

  if (names.length < limit && seedPool?.length) {
    const shuffled = [...seedPool].sort(() => Math.random() - 0.5);
    for (const term of shuffled) {
      if (names.length >= limit) break;
      try {
        const results = await itunesSearchTracks({ seedTerms: term, limit: 10 });
        // isStockMusic only checks the TRACK title — a genre-driven artist
        // pick also needs the ARTIST name itself screened, since library-
        // music publishers use brand-like names ("Jazz Lounge Zone") that
        // isGenericTitle's ">=2 generic words" heuristic catches just as
        // well applied to a name as to a title.
        const candidate = results.find((r) => {
          const key = (r.artist || "").trim().toLowerCase();
          return key && !seen.has(key) && !isStockMusic(r) && !isGenericTitle(r.artist);
        });
        if (candidate) {
          const key = candidate.artist.trim().toLowerCase();
          seen.add(key);
          names.push(candidate.artist.trim());
          covers.set(key, candidate.cover || null);
        }
      } catch (e) {
        onDiag(`artist pick for "${term}" failed: ${e.message}`);
      }
    }
  }

  const picks = names.slice(0, limit);

  if (fetchCovers) {
    await Promise.all(
      picks.map(async (name) => {
        const key = name.trim().toLowerCase();
        if (covers.has(key)) return;
        try {
          const results = await itunesSearchTracks({ seedTerms: name, limit: 1 });
          covers.set(key, results[0]?.cover || null);
        } catch {
          covers.set(key, null);
        }
      })
    );
  }

  onDiag(`top artists: ${realCount} real, ${picks.length - realCount} genre-driven`);
  return picks.map((name) => ({ name, cover: covers.get(name.trim().toLowerCase()) ?? null }));
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
