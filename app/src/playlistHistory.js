/**
 * Cadence — local playlist history
 * Every successful Spotify save appends a record here: the exact tracks,
 * the humanized story, and the session context (mood/weather/place/activity).
 * This is what powers the Profile screen's playlist list + detail view.
 * Capped so AsyncStorage doesn't grow unbounded over long-term use.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const HISTORY_KEY = "cadence:playlistHistory";
const MAX_ENTRIES = 50;

export async function getPlaylistHistory() {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * @param {{name:string, story:string, activityLabel:string, mood:object,
 *   weather:object, place:string, tracks:object[], spotifyUrl:string}} entry
 */
export async function addToPlaylistHistory(entry) {
  try {
    const existing = await getPlaylistHistory();
    const record = { id: `${Date.now()}`, createdAt: new Date().toISOString(), ...entry };
    const next = [record, ...existing].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    return record;
  } catch {
    return null;
  }
}
