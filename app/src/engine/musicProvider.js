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

import { searchTracks as deezerSearch } from "./deezer";
import { itunesSearchTracks } from "./itunes";

let provider = null; // 'deezer' | 'itunes' — sticky per session

export async function searchTracks(opts) {
  const { onDiag = () => {} } = opts;

  if (provider === "itunes") return itunesSearchTracks(opts);
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
  onDiag("provider locked: itunes (no BPM; previews + Apple links direct)");
  return itunesSearchTracks(opts);
}

export function currentProvider() {
  return provider;
}
