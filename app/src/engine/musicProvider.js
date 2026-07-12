/**
 * Cadence — unified music provider
 * Tries Deezer first (has BPM + ISRC natively). If Deezer is territory-blocked
 * — detectable as data:[] with total>0, exactly what an India IP sees — falls
 * back to the iTunes Search API (previews + direct Apple Music links).
 * The chosen provider is remembered for the session so we don't re-probe.
 *
 * BPM/ISRC on iTunes tracks: itunes.js enriches bpm via GetSongBPM before
 * returning, so the Bayesian layer activates the same as it does for Deezer.
 * ISRC is joined separately and in the background (musicbrainzIsrc.js, rate
 * limited to 1req/sec) since nothing here blocks on it being present yet.
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
