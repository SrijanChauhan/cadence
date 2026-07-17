import { useState, useRef, useEffect } from "react";
import { Audio } from "expo-av";

/**
 * Cadence — shared 30s-preview playback + auto-advance, for anywhere in
 * Profile that plays a track list end to end: saved playlists, the
 * Recommendations section, and an artist's top-10. Previously each of
 * these duplicated the same play/pause/auto-advance/error-handling logic
 * (PlaylistDetail had its own copy); this factors it into one hook so
 * ProfileScreen can render a single docked now-playing bar that works
 * consistently no matter which section started playback.
 *
 * `list` is genuinely part of the returned state (not just a ref) — the
 * docked bar needs to read nowPlaying/upNext by combining it with
 * playingId, and a caller switching to a different track list (e.g.
 * backing out of an artist's top-10 into a saved playlist) should make
 * that visible immediately.
 */
export function usePreviewPlayer() {
  const [playingId, setPlayingId] = useState(null);
  const [playError, setPlayError] = useState(null);
  const [list, setList] = useState([]);
  const sound = useRef(null);
  const listRef = useRef([]);

  useEffect(() => { listRef.current = list; }, [list]);
  useEffect(() => () => { sound.current?.unloadAsync(); }, []);

  const play = async (track, trackList) => {
    if (trackList) { setList(trackList); listRef.current = trackList; }
    setPlayError(null);
    try {
      if (sound.current) { await sound.current.unloadAsync(); sound.current = null; }
      if (playingId === track.id) { setPlayingId(null); return; }
      if (!track.preview) { setPlayError("This track has no preview clip."); return; }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true }).catch(() => {});
      const { sound: sd } = await Audio.Sound.createAsync({ uri: track.preview }, { shouldPlay: true });
      sound.current = sd;
      setPlayingId(track.id);
      sd.setOnPlaybackStatusUpdate((st) => {
        if (!st.didJustFinish) return;
        const l = listRef.current;
        const pos = l.findIndex((t) => t.id === track.id);
        const next = pos >= 0 ? l[pos + 1] : null;
        if (next) play(next); else setPlayingId(null);
      });
    } catch {
      // previews can be old/expired links, not guaranteed to always resolve
      setPlayError("Preview playback failed — this link may have expired.");
    }
  };

  const nowPlaying = list.find((t) => t.id === playingId) || null;
  const upNext = (() => {
    if (!nowPlaying) return null;
    const pos = list.findIndex((t) => t.id === playingId);
    return pos >= 0 ? list[pos + 1] : null;
  })();

  const stop = async () => {
    if (sound.current) { await sound.current.unloadAsync(); sound.current = null; }
    setPlayingId(null);
  };

  return { playingId, playError, nowPlaying, upNext, play, stop };
}
