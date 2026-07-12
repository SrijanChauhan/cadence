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

let provider = null; // 'deezer' | 'itunes' — sticky per session

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
