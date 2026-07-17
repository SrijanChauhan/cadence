import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator, Animated, TextInput, Keyboard,
} from "react-native";
import { Audio } from "expo-av";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { captureRef } from "react-native-view-shot";
import { BACKEND_URL } from "./config";
import SessionBanner from "./SessionBanner";
import CoverArt from "./CoverArt";
import MyPicksStrip from "./MyPicksStrip";
import { addToPlaylistHistory } from "./playlistHistory";
import { openInAppleMusic } from "./engine/appleMusic";
import { connectSpotify, hasSpotifyAuth, createPlaylistFromTracks, restoreSpotifySession, getTopArtists } from "./engine/spotify";
import { newBucketState, updateBucket, posterior, rankTracks } from "./engine/bayes";
import { useTheme } from "./theme";
import { useMyPicks } from "./MyPicksContext";
import { track as trackEvent } from "./analytics";

/**
 * Cadence — Playlist screen
 *
 * ARCHITECTURE NOTE: track discovery (seed rules, mood analysis, weather,
 * Deezer/iTunes search, BPM/ISRC enrichment) now runs on the Cadence
 * backend (see /server) via a single POST /recommend call. This app makes
 * one network call per activity pick and gets back a ranked pool + a
 * reserve of extra candidates (used to replace removed tracks).
 *
 * What STAYS on-device, deliberately:
 *  - Bayesian re-ranking (bayes.js) — re-sorts tracks already downloaded,
 *    on every tap. Must be instant; a network round trip here would only
 *    add lag with no accuracy benefit, since it's just re-sorting local data.
 *  - Spotify OAuth + playlist save — needs a real browser/redirect on-device.
 */

const MOOD_BUBBLES = ["Energetic", "Happy", "Content", "Calm", "Mellow", "Drained", "Down", "Tense"];

function BounceNumber({ value, style }) {
  const scale = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    scale.setValue(0.4);
    Animated.spring(scale, { toValue: 1, friction: 3.2, tension: 140, useNativeDriver: true }).start();
  }, [value]);
  return <Animated.Text style={[style, { transform: [{ scale }] }]}>{value}</Animated.Text>;
}

const SWIPE_REMOVE_THRESHOLD = 90;

/** Three lines growing/shrinking in height (not moving position) at
 * slightly staggered speeds — the classic "now playing" music-visualizer
 * glyph. Each bar stays vertically centered in its row (alignItems:
 * "center" on the wrap) so growing taller pushes both its top and bottom
 * edge outward symmetrically, rather than the bar's position shifting.
 * height is a layout property, so this can't use the native driver — fine
 * at this size, only three tiny bars looping.
 *
 * Tempo-tuned: one full grow/shrink cycle is pinned to the track's own beat
 * length (60000/bpm ms), not a fixed generic speed, so a 165 BPM workout
 * track visibly moves faster than a 60 BPM wind-down one. iTunes-sourced
 * tracks without a BPM (not yet enriched, or GetSongBPM had no match) fall
 * back to a 120 BPM feel rather than not animating at all.
 *
 * Colour is a fixed neutral grey, deliberately NOT tied to the active
 * theme (unlike almost everything else in this app) — it needs to read
 * clearly over any album art regardless of which of the four themes is
 * active, and a theme-matched accent risked blending into art that
 * happened to share that hue. */
export function Equalizer({ bpm }) {
  const bars = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  const beatMs = bpm && bpm > 0 ? 60000 / bpm : 500;
  const colors = ["#B5B5B5", "#8A8A8A", "#B5B5B5"];

  useEffect(() => {
    const loops = bars.map((bar, i) => {
      const half = beatMs / 2 + i * (beatMs * 0.12); // slight per-bar stagger, still tempo-anchored
      return Animated.loop(
        Animated.sequence([
          Animated.timing(bar, { toValue: 1, duration: half, useNativeDriver: false }),
          Animated.timing(bar, { toValue: 0.3, duration: half, useNativeDriver: false }),
        ])
      );
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [beatMs]);

  return (
    <View style={eqStyles.wrap}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[eqStyles.bar, { backgroundColor: colors[i], height: bar.interpolate({ inputRange: [0, 1], outputRange: ["25%", "100%"] }) }]}
        />
      ))}
    </View>
  );
}

const eqStyles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 2.5, height: 16 },
  bar: { width: 3, height: 7, borderRadius: 1.5 },
});

/**
 * Cadence — track row: tap anywhere to play, swipe to remove, heart to add
 * to the catalog (My Picks). No separate play/remove icons — the whole row
 * is the play target, and "not for me" is a physical swipe-away gesture
 * rather than a tap target, matching how the rest of the interaction model
 * in this app favors gesture over icon-hunting (see MyPicksStrip's own
 * tap/hold-drag/hold-still pattern).
 *
 * The swipe/tap gesture only wraps the cover+text area, not the whole row —
 * the heart stays a plain sibling Pressable outside that GestureDetector
 * subtree, since nesting an interactive Pressable inside a GestureDetector
 * risks the two fighting over the same touch (the same reason MyPicksStrip
 * renders its remove-X through a separate top-layer Modal rather than a
 * Pressable nested inside its own tile gesture).
 */
function TrackRow({ t, s, theme, feedback, playingId, isMyPick, onPlay, onToggleLike, onRemove }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const fb = feedback[t.id];
  const playing = playingId === t.id;
  // t.cover being non-null only means the API gave us a URL, not that it'll
  // actually load — a dead/expired artwork URL previously just rendered
  // blank forever with no fallback. onError below catches that and swaps to
  // the same placeholder box used when there's no cover URL at all.
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => { setCoverFailed(false); }, [t.cover]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onUpdate((e) => translateX.setValue(e.translationX))
    .onEnd((e) => {
      // Right = add to My Picks (same toggle the heart button uses — spring
      // back to place afterward, since liking doesn't remove the track from
      // the feed any more than tapping the heart does). Left = remove.
      if (e.translationX > SWIPE_REMOVE_THRESHOLD) {
        onToggleLike(t);
        Animated.spring(translateX, { toValue: 0, friction: 7, useNativeDriver: true }).start();
      } else if (e.translationX < -SWIPE_REMOVE_THRESHOLD) {
        Animated.timing(translateX, { toValue: -600, duration: 180, useNativeDriver: true }).start(() => onRemove(t));
      } else {
        Animated.spring(translateX, { toValue: 0, friction: 7, useNativeDriver: true }).start();
      }
    });

  const tapGesture = Gesture.Tap()
    .maxDistance(10)
    .onEnd((_e, success) => { if (success) onPlay(t); });

  const gesture = Gesture.Race(tapGesture, panGesture);

  // Two trails, one per direction, each fading in only on its own side —
  // same iOS-style reveal-behind-the-row pattern, but red (remove) on the
  // left and volt/accent (add to My Picks) on the right, so the color
  // itself previews which action a swipe is about to commit to.
  const removeTrailOpacity = translateX.interpolate({ inputRange: [-SWIPE_REMOVE_THRESHOLD, 0], outputRange: [1, 0], extrapolate: "clamp" });
  const likeTrailOpacity = translateX.interpolate({ inputRange: [0, SWIPE_REMOVE_THRESHOLD], outputRange: [0, 1], extrapolate: "clamp" });

  return (
    <View>
      {/* Both trails stack in the same absolute position — each backdrop's
          own opacity (not just its icon's) has to track its direction, or
          the one rendered on top would always fully hide the other. */}
      <Animated.View style={[s.rowRemoveTrail, { opacity: removeTrailOpacity }]} pointerEvents="none">
        <Text style={s.rowRemoveTrailIcon}>{"✕"}</Text>
      </Animated.View>
      <Animated.View style={[s.rowLikeTrail, { backgroundColor: theme.accent, opacity: likeTrailOpacity }]} pointerEvents="none">
        <Text style={s.rowLikeTrailIcon}>{"♥"}</Text>
      </Animated.View>
      <Animated.View style={[s.row, { backgroundColor: theme.bg }, fb && fb.indexOf("skip") === 0 && s.rowSkipped, { transform: [{ translateX }] }]}>
        <GestureDetector gesture={gesture}>
          <View style={s.rowTapArea}>
            <View>
              {t.cover && !coverFailed ? (
                <Image source={{ uri: t.cover }} style={s.cover} onError={() => setCoverFailed(true)} />
              ) : (
                <View style={[s.cover, s.coverEmpty]} />
              )}
              {playing && (
                <View style={s.coverEqOverlay} pointerEvents="none">
                  <Equalizer bpm={t.bpm} />
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.title, playing && s.iconVolt]} numberOfLines={1}>{t.title}</Text>
              <Text style={s.artist} numberOfLines={1}>{t.artist}{t.bpm ? "  ·  " + Math.round(t.bpm) + " BPM" : ""}</Text>
            </View>
          </View>
        </GestureDetector>
        <Pressable style={s.iconBtn} onPress={() => onToggleLike(t)} hitSlop={8}>
          <Text style={[s.icon, isMyPick(t.id) && s.iconVolt]}>{"♥"}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function PlaylistScreen({ traits }) {
  const { theme } = useTheme();
  const s = useMemo(() => buildStyles(theme.accent, theme.bg, theme.surface, theme.border), [theme]);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [diag, setDiag] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [reserve, setReserve] = useState([]);
  const [target, setTarget] = useState(null);
  const [weather, setWeather] = useState(null);
  const [place, setPlace] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  // Cover URLs that failed to actually load (dead/expired artwork link —
  // t.cover being non-null only means the API returned a URL, not that it
  // still resolves). Used by the queue panel and now-playing bar, which
  // aren't their own components the way TrackRow is, so can't hold this as
  // local per-row state the same way.
  const [failedCovers, setFailedCovers] = useState(() => new Set());
  const markCoverFailed = (url) => setFailedCovers((s) => new Set(s).add(url));
  const [feedback, setFeedback] = useState({});
  const [queue, setQueue] = useState([]);
  const [queueOpen, setQueueOpen] = useState(false);
  // My Picks: a persistent, activity-independent set of favourited tracks —
  // deliberately NOT derived from `feedback`, since feedback[id] gets
  // overwritten by whatever the latest event was (a liked track that later
  // completes or gets skipped would otherwise silently drop out of picks),
  // and NOT derived from the current `tracks` list, since that resets on
  // every activity switch. Stores full track snapshots (not just ids) so a
  // pick still renders correctly even when it is not in the currently
  // loaded activity's results. Lives in MyPicksContext now, not local state
  // here — Profile's Recommendations section can heart a track too, and
  // both need to share the exact same live list, not separate copies.
  const { myPicks, addToMyPicks, removeFromMyPicks, isMyPick, toggleLike: toggleMyPick, reorderMyPicks } = useMyPicks();

  // Refresh Playlist: capped at 10 uses per activity session, and excludes
  // the FULL cumulative set of everything shown so far (not just the most
  // recent batch) — otherwise refresh #2 could cycle back to tracks from
  // before refresh #1, since only the immediately-prior batch would be
  // excluded. Reset whenever a genuinely new activity/mode session starts
  // (confirmMood/skipMood), not on every load() call.
  const MAX_REFRESHES = 10;
  const [refreshCount, setRefreshCount] = useState(0);
  const seenTrackIds = useRef(new Set());
  const buckets = useRef({});
  const sound = useRef(null);
  const playStart = useRef(null);
  const queueRef = useRef([]);
  const tracksRef = useRef([]);
  const bannerRef = useRef(null);
  const coverArtRef = useRef(null);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  const [mood, setMood] = useState(null);
  const [moodPromptOpen, setMoodPromptOpen] = useState(false);
  const [pendingActivity, setPendingActivity] = useState(null);
  const [selectedBubbles, setSelectedBubbles] = useState([]);
  const [extraFeeling, setExtraFeeling] = useState("");
  const moodAskedThisSession = useRef(false);

  // Connecting Spotify EARLY (before the first recommend call) is what makes
  // getTopArtists() actually have something to blend in. Previously Spotify
  // only got connected from the Save button, which fires *after* tracks
  // already loaded — so the artist/similar-artist blend silently never ran
  // on a typical session. spotifyConnected mirrors hasSpotifyAuth() so the
  // banner below can reflect it without re-checking on every render.
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [connectingSpotify, setConnectingSpotify] = useState(false);

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true }).catch(() => {});
    restoreSpotifySession().then(() => setSpotifyConnected(hasSpotifyAuth())); // silently reconnect if we have a saved refresh token
    return () => { sound.current?.unloadAsync(); };
  }, []);

  const connectSpotifyNow = async () => {
    setConnectingSpotify(true);
    try {
      const ok = await connectSpotify();
      setSpotifyConnected(ok && hasSpotifyAuth());
      if (ok && activity) load(activity); // refresh with the newly available artist blend
    } finally {
      setConnectingSpotify(false);
    }
  };

  useEffect(() => {
    if (!activity) return;
    AsyncStorage.setItem(`cadence:queue:${activity}`, JSON.stringify({
      ids: queue,
      tracks: tracks.filter((t) => queue.includes(t.id)),
    })).catch(() => {});
  }, [queue, activity]);

  const ACTIVITIES = [
    { key: "deep_work", label: "Deep Work" }, { key: "calls", label: "Calls" },
    { key: "creative", label: "Creative" }, { key: "commute", label: "Commute" },
    { key: "workout", label: "Workout" }, { key: "wind_down", label: "Wind-down" },
  ];

  // road_trip is deliberately NOT in ACTIVITIES above (it needs a from/to
  // form, not a single chip tap) — this covers it wherever the screen
  // otherwise looks up the current activity's display label.
  const activityLabel = () => (activity === "road_trip" ? "Road Trip" : ACTIVITIES.find((a) => a.key === activity)?.label);

  const onPickActivity = (key) => {
    trackEvent("activity_picked", { activity: key });
    if (!moodAskedThisSession.current) {
      setPendingActivity(key);
      setSelectedBubbles([]);
      setExtraFeeling("");
      setMoodPromptOpen(true);
    } else {
      load(key);
    }
  };

  const toggleBubble = (label) => {
    setSelectedBubbles((sel) => sel.includes(label) ? sel.filter((x) => x !== label) : [...sel, label]);
  };

  // Road Trip has its own from/to form (on its own full-screen page) ahead
  // of the shared mood prompt — pendingActivity === "road_trip" is what
  // tells confirmMood/skipMood to call loadRoadTrip instead of load().
  const confirmMood = () => {
    trackEvent("mood_submitted", { activity: pendingActivity, bubble_count: selectedBubbles.length, has_text: !!extraFeeling.trim() });
    moodAskedThisSession.current = true;
    setMoodPromptOpen(false);
    if (pendingActivity === "road_trip") {
      loadRoadTrip(lastRoadTrip.current.from, lastRoadTrip.current.to, { labels: selectedBubbles, text: extraFeeling });
    } else {
      load(pendingActivity, { labels: selectedBubbles, text: extraFeeling });
    }
  };

  const skipMood = () => {
    trackEvent("mood_skipped", { activity: pendingActivity });
    moodAskedThisSession.current = true;
    setMoodPromptOpen(false);
    if (pendingActivity === "road_trip") {
      loadRoadTrip(lastRoadTrip.current.from, lastRoadTrip.current.to, { labels: [], text: "" });
    } else {
      load(pendingActivity, { labels: [], text: "" });
    }
  };

  // Road Trip is its own full-screen page (see the roadTripPageOpen block in
  // the render below), not a modal over the main feed — closing it just
  // hides the page without clearing the loaded trip, so reopening shows the
  // same journey instead of forcing a re-plan.
  const [roadTripPageOpen, setRoadTripPageOpen] = useState(false);
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [route, setRoute] = useState(null); // { from, to, distanceKm, durationMin, terrain }
  const lastRoadTrip = useRef(null); // { from, to } — reused by confirmMood/skipMood/refresh

  const openRoadTripPage = () => {
    // If a different activity ran in between (tracks/target/route are all
    // shared state, not duplicated per-activity), the previously loaded
    // route no longer matches whatever's sitting in tracks/target — reset
    // to a fresh form rather than show a journey next to a mismatched
    // playlist. Reopening the SAME still-active trip (no other activity
    // picked in between) skips this and shows exactly where you left off.
    if (activity !== "road_trip") { setFromInput(""); setToInput(""); setRoute(null); }
    setRoadTripPageOpen(true);
  };
  const closeRoadTripPage = () => setRoadTripPageOpen(false);

  const submitRoadTripForm = () => {
    const from = fromInput.trim(), to = toInput.trim();
    if (!from || !to) return;
    trackEvent("activity_picked", { activity: "road_trip" });
    lastRoadTrip.current = { from, to };
    if (!moodAskedThisSession.current) {
      setPendingActivity("road_trip");
      setSelectedBubbles([]);
      setExtraFeeling("");
      setMoodPromptOpen(true);
    } else {
      loadRoadTrip(from, to);
    }
  };

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return null;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      return { lat: pos.coords.latitude, lon: pos.coords.longitude };
    } catch {
      return null;
    }
  };

  const load = async (act, moodInput, excludeIds = []) => {
    // excludeIds is only ever non-empty when refreshPlaylist() calls this —
    // every other caller (a fresh activity pick, retry, Spotify-reconnect
    // reload) means a new baseline, so the refresh budget/seen-set resets
    if (excludeIds.length === 0) {
      seenTrackIds.current = new Set();
      setRefreshCount(0);
    }
    setActivity(act); setLoading(true); setError(null); setTracks([]); setFeedback({}); setDiag([]);
    // Queue is NOT reset on a refresh (excludeIds.length > 0) — a refresh
    // reload's own setQueue([]) here used to race the queue-persist effect
    // below: that effect fires on every `queue` change and would write the
    // now-empty queue to AsyncStorage before this function's own restore
    // read further down got a chance to run, clobbering the very data it
    // was about to restore. A genuinely new activity/session still clears
    // it, same as tracks/feedback above.
    if (excludeIds.length === 0) setQueue([]);
    const pushDiag = (m) => setDiag((d) => [...d, m]);
    try {
      const loc = await getLocation();
      // Blend in artists (and their genres) you actually listen to on Spotify,
      // when connected — see getTopArtists() for why genres substitute for
      // "adjacent artists" (Spotify closed that API in Nov 2024).
      const { names: spotifyArtists, genres: spotifyGenres } = await getTopArtists();
      const body = {
        traits, activity: act,
        moodLabels: moodInput ? moodInput.labels : (mood?.selected || []),
        moodText: moodInput ? moodInput.text : "",
        lat: loc?.lat, lon: loc?.lon,
        spotifyArtists, spotifyGenres,
        excludeIds,
        limit: 8,
      };
      const res = await fetch(`${BACKEND_URL}/recommend`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Backend ${res.status}`);
      (json.diag || []).forEach(pushDiag);
      if (moodInput) setMood(json.mood);

      if (!buckets.current[act]) {
        try {
          const savedB = await AsyncStorage.getItem(`cadence:bayes:${act}`);
          buckets.current[act] = savedB ? JSON.parse(savedB) : newBucketState((json.target.bpmMin + json.target.bpmMax) / 2);
        } catch {
          buckets.current[act] = newBucketState((json.target.bpmMin + json.target.bpmMax) / 2);
        }
      }

      let merged = json.tracks;
      try {
        const saved = await AsyncStorage.getItem(`cadence:queue:${act}`);
        if (saved) {
          const { ids, tracks: savedTracks } = JSON.parse(saved);
          const have = new Set(merged.map((r) => r.id));
          merged = [...merged, ...savedTracks.filter((t) => !have.has(t.id))];
          setQueue(ids);
          setFeedback(Object.fromEntries(ids.map((id) => [id, "like"])));
        }
      } catch {}

      setTarget(json.target);
      setReserve(json.reserve || []);
      setWeather(json.weather || null);
      setPlace(json.place || null);
      setTracks(rankTracks(merged, buckets.current[act]));
      trackEvent("playlist_loaded", { activity: act, track_count: json.tracks.length, is_refresh: excludeIds.length > 0 });

      // accumulate into the cumulative seen-set (merged already includes any
      // queue-restored tracks, not just this response's own tracks/reserve)
      merged.forEach((t) => seenTrackIds.current.add(t.id));
      (json.reserve || []).forEach((t) => seenTrackIds.current.add(t.id));
    } catch (e) {
      setError(e.message || "Couldn't reach the Cadence backend.");
    } finally {
      setLoading(false);
    }
  };

  // Road Trip's own load path: from/to text instead of an activity key +
  // device GPS, and the backend sizes the batch to the trip's actual
  // driving duration instead of a fixed limit — this is meant to be the
  // one batch for the whole trip, not the first of several, so there's no
  // per-activity queue restore here (a leftover queue from a DIFFERENT
  // previous trip merging into a new one would be wrong, unlike the six
  // normal activities where restoring the same activity's queue makes sense).
  const loadRoadTrip = async (from, to, moodInput, excludeIds = []) => {
    if (excludeIds.length === 0) {
      seenTrackIds.current = new Set();
      setRefreshCount(0);
    }
    setActivity("road_trip"); setLoading(true); setError(null); setTracks([]); setFeedback({}); setDiag([]);
    if (excludeIds.length === 0) setQueue([]);
    lastRoadTrip.current = { from, to };
    const pushDiag = (m) => setDiag((d) => [...d, m]);
    try {
      const { names: spotifyArtists } = await getTopArtists();
      const body = {
        traits, from, to,
        moodLabels: moodInput ? moodInput.labels : (mood?.selected || []),
        moodText: moodInput ? moodInput.text : "",
        spotifyArtists,
        excludeIds,
      };
      const res = await fetch(`${BACKEND_URL}/roadtrip`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Backend ${res.status}`);
      (json.diag || []).forEach(pushDiag);
      if (moodInput) setMood(json.mood);

      if (!buckets.current.road_trip) {
        try {
          const savedB = await AsyncStorage.getItem("cadence:bayes:road_trip");
          buckets.current.road_trip = savedB ? JSON.parse(savedB) : newBucketState((json.target.bpmMin + json.target.bpmMax) / 2);
        } catch {
          buckets.current.road_trip = newBucketState((json.target.bpmMin + json.target.bpmMax) / 2);
        }
      }

      setTarget(json.target);
      setReserve(json.reserve || []);
      setWeather(json.weather || null);
      setRoute(json.route || null);
      // reuses the same `place` slot SessionBanner/CoverArt already render
      // under the weather line — "from → to" reads naturally there
      setPlace(json.route ? `${json.route.from} → ${json.route.to}` : null);
      setTracks(rankTracks(json.tracks, buckets.current.road_trip));
      trackEvent("playlist_loaded", { activity: "road_trip", track_count: json.tracks.length, is_refresh: excludeIds.length > 0, terrain: json.route?.terrain });

      json.tracks.forEach((t) => seenTrackIds.current.add(t.id));
      (json.reserve || []).forEach((t) => seenTrackIds.current.add(t.id));
    } catch (e) {
      setError(e.message || "Couldn't reach the Cadence backend.");
    } finally {
      setLoading(false);
    }
  };

  // iTunes's search ranking is deterministic, so a plain re-load for the same
  // activity would hand back the same tracks — excludeIds tells the backend
  // the FULL cumulative set of everything shown so far this session (not
  // just the current batch), so each of up to 10 refreshes surfaces
  // genuinely different tracks instead of eventually cycling back.
  const refreshPlaylist = () => {
    if (refreshCount >= MAX_REFRESHES || loading) return;
    trackEvent("refresh_playlist", { activity, refresh_number: refreshCount + 1 });
    setRefreshCount((c) => c + 1);
    if (activity === "road_trip" && lastRoadTrip.current) {
      loadRoadTrip(lastRoadTrip.current.from, lastRoadTrip.current.to, undefined, [...seenTrackIds.current]);
    } else {
      load(activity, undefined, [...seenTrackIds.current]);
    }
  };

  const play = async (track) => {
    try {
      if (sound.current) { await sound.current.unloadAsync(); sound.current = null; }
      if (playingId === track.id) { setPlayingId(null); return; }
      if (!track.preview) { setError("This track has no preview clip."); return; }
      const { sound: sd } = await Audio.Sound.createAsync({ uri: track.preview }, { shouldPlay: true });
      sound.current = sd;
      setPlayingId(track.id);
      playStart.current = Date.now();
      trackEvent("track_played", { activity });
      sd.setOnPlaybackStatusUpdate((st) => {
        if (st.didJustFinish) { giveFeedback(track, "complete"); advanceQueue(track.id); }
      });
    } catch {
      setError("Preview playback failed — previews expire; reload the mode.");
    }
  };

  const advanceQueue = (finishedId) => {
    const q = queueRef.current;
    const pos = q.indexOf(finishedId);
    const nextId = pos >= 0 ? q[pos + 1] : null;
    const next = nextId ? tracksRef.current.find((t) => t.id === nextId) : null;
    if (next) play(next); else setPlayingId(null);
  };

  const enqueue = (track) => setQueue((q) => (q.includes(track.id) ? q : [...q, track.id]));
  const dequeue = (id) => setQueue((q) => q.filter((x) => x !== id));

  const skip = (track) => {
    const listened = playingId === track.id && playStart.current ? (Date.now() - playStart.current) / 1000 : 0;
    giveFeedback(track, listened >= 20 ? "skip_late" : "skip_fast");
    if (playingId === track.id) { sound.current?.unloadAsync(); setPlayingId(null); }
  };

  const giveFeedback = (track, type) => {
    setFeedback((f) => ({ ...f, [track.id]: type }));
    buckets.current[activity] = updateBucket(buckets.current[activity], track.bpm, type);
    AsyncStorage.setItem(`cadence:bayes:${activity}`, JSON.stringify(buckets.current[activity])).catch(() => {});
    setTracks((ts) => rankTracks(ts, buckets.current[activity]));
    // shared choke point for like/skip/complete/save — every engagement
    // signal that feeds the Bayesian re-ranker also doubles as a funnel event
    const eventName = type.indexOf("skip") === 0 ? "track_skipped"
      : type === "like" ? "track_liked"
      : type === "save" ? "track_opened_apple_music"
      : "track_completed";
    trackEvent(eventName, { activity, feedback_type: type });
  };

  // addToMyPicks/removeFromMyPicks/isMyPick/reorderMyPicks now come from
  // MyPicksContext (see the hook destructured near the top of this
  // component) — this activity's own queue is what's left to manage here.
  const like = (track) => { giveFeedback(track, "like"); enqueue(track); addToMyPicks(track); };

  // heart is a toggle: tap again to un-favourite, which also drops it from
  // the auto-play queue it was added to (a track that is no longer "picked"
  // should not still be lined up to play next)
  const toggleLike = (track) => {
    if (isMyPick(track.id)) { toggleMyPick(track); dequeue(track.id); }
    else like(track);
  };

  const removeTrack = (track) => {
    dequeue(track.id);
    setReserve((res) => {
      if (res.length === 0) {
        setTracks((ts) => ts.filter((t) => t.id !== track.id));
        return res;
      }
      const [replacement, ...restReserve] = res;
      setTracks((ts) => rankTracks(
        ts.filter((t) => t.id !== track.id).concat(replacement),
        buckets.current[activity]
      ));
      setFeedback((f) => { const n = { ...f }; delete n[track.id]; return n; });
      return restReserve;
    });
  };

  const openApple = async (track) => {
    const ok = await openInAppleMusic(track);
    if (ok) giveFeedback(track, "save"); else setError("No Apple Music match for this one.");
  };

  const [saveState, setSaveState] = useState("idle");
  const [saveMsg, setSaveMsg] = useState("");
  const [picksSaveState, setPicksSaveState] = useState("idle");
  const [picksSaveMsg, setPicksSaveMsg] = useState("");

  // Readable, spaced-out title rather than a dot-joined "Cadence.DeepWork.
  // Energetic" concatenation — that read like a file path, not a playlist
  // name. "Neutral" (analyzeCombined's default when no mood was given) is
  // dropped rather than shown, since it's not a mood the user actually
  // picked.
  const playlistName = () => {
    const actLabel = activityLabel() || "Session";
    const moodLabel = mood?.label && mood.label !== "Neutral" ? mood.label : null;
    return moodLabel ? `Cadence — ${actLabel}, ${moodLabel}` : `Cadence — ${actLabel}`;
  };

  // Turns the session's inputs (when, where, weather, mood, activity, tempo)
  // into a short narrated description instead of a bare label list, so
  // opening the playlist in Spotify tells you why it's built the way it is.
  const playlistStory = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const actLabel = activityLabel() || "your session";

    let story = `Built ${dateStr} at ${timeStr}`;
    if (place) story += ` in ${place}`;
    story += ".";

    if (weather?.tempC != null) {
      const condWord = { rain: "rainy", snow: "snowy", cloudy: "cloudy", clear: "clear" }[weather.condition] || weather.condition;
      story += ` ${Math.round(weather.tempC)}°C and ${condWord} outside.`;
    }

    const moodWords = mood?.selected?.length
      ? mood.selected.join(", ").toLowerCase()
      : (mood?.words?.length ? mood.words.join(", ") : null);
    if (moodWords) story += ` I was feeling ${moodWords}.`;
    else if (mood?.label && mood.label !== "Neutral") story += ` Mood: ${mood.label.toLowerCase()}.`;

    if (target) story += ` Tuned for ${actLabel} at ${target.bpmMin}–${target.bpmMax} BPM.`;

    return `Made by Cadence. ${story}`;
  };

  // best-effort: a failed capture shouldn't block the save, but log why
  // so a cover-art problem is debuggable instead of just silently absent.
  // Captures the dedicated off-screen SQUARE composition (CoverArt), not
  // the wide on-screen banner — Spotify expects a square cover, and a
  // rectangular screenshot would just get cropped/letterboxed. Starts at
  // quality 0.9 (this content is mostly flat color fields, so it usually
  // compresses well under Spotify's 256KB limit even at high quality),
  // but device pixel ratio varies (2x-3x), so falls back to progressively
  // lower quality rather than risk silently exceeding the hard 256KB
  // limit and failing the whole upload — sharper when it can be, but
  // never at the cost of the upload just not happening. Shared by both
  // the per-activity queue save and the My Picks save below.
  const captureCoverArt = async () => {
    let coverImageBase64 = null;
    try {
      if (coverArtRef.current) {
        const SPOTIFY_MAX_BYTES = 256 * 1024;
        for (const quality of [0.9, 0.75, 0.6, 0.45]) {
          const candidate = await captureRef(coverArtRef, { format: "jpg", quality, result: "base64" });
          const approxBytes = candidate.length * 0.75; // base64 -> raw byte estimate
          if (approxBytes <= SPOTIFY_MAX_BYTES) { coverImageBase64 = candidate; break; }
          console.warn(`[cover art] quality ${quality} too large (~${Math.round(approxBytes / 1024)}KB), trying lower`);
        }
        if (!coverImageBase64) console.warn("[cover art] no quality level fit under 256KB — skipping cover upload");
      } else {
        console.warn("[cover art] coverArtRef not attached — CoverArt may not be mounted yet");
      }
    } catch (e) {
      console.warn("[cover art] captureRef failed:", e.message);
    }
    return coverImageBase64;
  };

  const saveToSpotify = async () => {
    trackEvent("spotify_save_attempt", { save_context: "queue", track_count: queue.length });
    try {
      if (!hasSpotifyAuth()) {
        setSaveState("connecting"); setSaveMsg("Opening Spotify sign-in…");
        const ok = await connectSpotify();
        setSpotifyConnected(ok && hasSpotifyAuth());
        if (!ok) { setSaveState("error"); setSaveMsg("Spotify sign-in was cancelled."); trackEvent("spotify_save_fail", { save_context: "queue", reason: "auth_cancelled" }); return; }
      }
      setSaveState("saving"); setSaveMsg("Building your Spotify playlist…");
      const list = queue.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
      const coverImageBase64 = await captureCoverArt();
      const name = playlistName();
      const story = playlistStory();
      const { matchedCount, totalCount, url, coverUploaded } = await createPlaylistFromTracks(list, {
        name, description: story, coverImageBase64,
      });

      addToPlaylistHistory({
        name, story,
        activityLabel: activityLabel(),
        mood, weather, place,
        tracks: list,
        spotifyUrl: url,
      });

      setSaveState("done");
      setSaveMsg(
        `Saved ${matchedCount}/${totalCount} tracks to Spotify${coverUploaded ? " with cover art" : ""}. Open Spotify → Library.`
      );
      trackEvent("spotify_save_success", { save_context: "queue", matched_count: matchedCount, total_count: totalCount });
    } catch (e) {
      setSaveState("error"); setSaveMsg(e.message || "Couldn't save to Spotify.");
      trackEvent("spotify_save_fail", { save_context: "queue", reason: e.message || "unknown" });
    }
  };

  // My Picks spans however many activities/refreshes the session covers —
  // once the catalog "feels done", this saves the whole accumulated
  // favourites strip as its own Spotify playlist, independent of whichever
  // single activity's queue is currently open.
  const saveMyPicksToSpotify = async () => {
    trackEvent("spotify_save_attempt", { save_context: "my_picks", track_count: myPicks.length });
    try {
      if (!hasSpotifyAuth()) {
        setPicksSaveState("connecting"); setPicksSaveMsg("Opening Spotify sign-in…");
        const ok = await connectSpotify();
        setSpotifyConnected(ok && hasSpotifyAuth());
        if (!ok) { setPicksSaveState("error"); setPicksSaveMsg("Spotify sign-in was cancelled."); trackEvent("spotify_save_fail", { save_context: "my_picks", reason: "auth_cancelled" }); return; }
      }
      setPicksSaveState("saving"); setPicksSaveMsg("Building your Spotify playlist…");
      const list = myPicks;
      const coverImageBase64 = await captureCoverArt();
      const name = "Cadence — My Picks";
      const story = `Made by Cadence. My favourited catalog across sessions — ${list.length} track${list.length === 1 ? "" : "s"}.`;
      const { matchedCount, totalCount, url, coverUploaded } = await createPlaylistFromTracks(list, {
        name, description: story, coverImageBase64,
      });

      addToPlaylistHistory({
        name, story,
        activityLabel: "My Picks",
        mood, weather, place,
        tracks: list,
        spotifyUrl: url,
      });

      setPicksSaveState("done");
      setPicksSaveMsg(
        `Saved ${matchedCount}/${totalCount} tracks to Spotify${coverUploaded ? " with cover art" : ""}. Open Spotify → Library.`
      );
      trackEvent("spotify_save_success", { save_context: "my_picks", matched_count: matchedCount, total_count: totalCount });
    } catch (e) {
      setPicksSaveState("error"); setPicksSaveMsg(e.message || "Couldn't save to Spotify.");
      trackEvent("spotify_save_fail", { save_context: "my_picks", reason: e.message || "unknown" });
    }
  };

  const [tripSaveState, setTripSaveState] = useState("idle");
  const [tripSaveMsg, setTripSaveMsg] = useState("");

  // Road Trip saves the WHOLE generated batch, not just favourited tracks —
  // it's a purpose-built one-shot playlist sized to the drive, not an
  // accumulate-as-you-go queue like the other activities, so completing the
  // trip playlist means completing all of it.
  const saveRoadTripToSpotify = async () => {
    trackEvent("spotify_save_attempt", { save_context: "road_trip", track_count: tracks.length });
    try {
      if (!hasSpotifyAuth()) {
        setTripSaveState("connecting"); setTripSaveMsg("Opening Spotify sign-in…");
        const ok = await connectSpotify();
        setSpotifyConnected(ok && hasSpotifyAuth());
        if (!ok) { setTripSaveState("error"); setTripSaveMsg("Spotify sign-in was cancelled."); trackEvent("spotify_save_fail", { save_context: "road_trip", reason: "auth_cancelled" }); return; }
      }
      setTripSaveState("saving"); setTripSaveMsg("Building your road trip playlist…");
      const list = tracks;
      const coverImageBase64 = await captureCoverArt();
      const name = route ? `Cadence — Road Trip: ${route.from} to ${route.to}` : "Cadence — Road Trip";
      const story = route
        ? `Made by Cadence. ${Math.round(route.distanceKm)} km, about ${Math.round(route.durationMin)} min from ${route.from} to ${route.to}. Terrain: ${route.terrain}.${weather?.tempC != null ? ` ${Math.round(weather.tempC)}°C and ${weather.condition} along the way.` : ""} Tuned to ${target ? `${target.bpmMin}–${target.bpmMax} BPM` : "the drive"}.`
        : playlistStory();
      const { matchedCount, totalCount, url, coverUploaded } = await createPlaylistFromTracks(list, {
        name, description: story, coverImageBase64,
      });

      addToPlaylistHistory({
        name, story,
        activityLabel: "Road Trip",
        mood, weather, place,
        tracks: list,
        spotifyUrl: url,
      });

      setTripSaveState("done");
      setTripSaveMsg(
        `Saved ${matchedCount}/${totalCount} tracks to Spotify${coverUploaded ? " with cover art" : ""}. Open Spotify → Library.`
      );
      trackEvent("spotify_save_success", { save_context: "road_trip", matched_count: matchedCount, total_count: totalCount });
    } catch (e) {
      setTripSaveState("error"); setTripSaveMsg(e.message || "Couldn't save to Spotify.");
      trackEvent("spotify_save_fail", { save_context: "road_trip", reason: e.message || "unknown" });
    }
  };

  const post = activity && buckets.current[activity] ? posterior(buckets.current[activity]) : null;
  const nowPlaying = tracks.find((t) => t.id === playingId);
  const queueTracks = queue.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
  const upNext = (() => {
    const pos = queue.indexOf(playingId);
    if (pos >= 0 && pos + 1 < queue.length) return tracks.find((t) => t.id === queue[pos + 1]);
    return null;
  })();

  // Shared by both the main feed and the Road Trip page's track list — same
  // play/like/remove handlers either way, see TrackRow above for why tap
  // plays, swipe removes, and only the heart stays a tappable icon.
  const renderTrackRow = (t) => (
    <TrackRow
      key={t.id}
      t={t}
      s={s}
      theme={theme}
      feedback={feedback}
      playingId={playingId}
      isMyPick={isMyPick}
      onPlay={play}
      onToggleLike={toggleLike}
      onRemove={removeTrack}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: nowPlaying ? 96 : 44 }}>
      {!spotifyConnected && (
        <Pressable style={s.spotifyBanner} onPress={connectSpotifyNow} disabled={connectingSpotify}>
          <Text style={s.spotifyBannerText}>
            {connectingSpotify ? "Connecting…" : "Connect Spotify to personalize picks with artists you actually listen to"}
          </Text>
        </Pressable>
      )}
      {/* No "PICK A MODE" label here — CADENCE sits directly above this in
          the app header, and stacking a second title-style line right below
          it read as a redundant double-heading. The chips are activity
          names (Deep Work, Workout, ...), self-explanatory without a label. */}
      <View style={s.chipsFirst}>
        {ACTIVITIES.map((a) => (
          <Pressable key={a.key} style={[s.chip, activity === a.key && s.chipActive]} onPress={() => onPickActivity(a.key)}>
            <Text style={[s.chipText, activity === a.key && s.chipTextActive]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Deliberately a quiet text link, not a bordered button matching the
          chips' visual weight — Cadence's core experience is context-aware
          music (personality/activity/mood/weather), and Road Trip is one
          specific, occasional use of that, not a second thing competing
          for attention on every visit to this screen. */}
      <Pressable style={s.roadTripLink} onPress={openRoadTripPage} hitSlop={8}>
        <Text style={[s.roadTripLinkText, activity === "road_trip" && s.roadTripLinkTextActive]}>Plan a road trip →</Text>
      </Pressable>

      {/* Road Trip's banner/target/tracks/save all live on its own
          full-screen page instead (see roadTripPageOpen below) — this main
          feed is exclusively the six regular activities. */}
      {target && activity !== "road_trip" && (
        <SessionBanner
          ref={bannerRef}
          mood={mood}
          weather={weather}
          activityLabel={activityLabel()}
          place={place}
        />
      )}

      {target && (
        // Off-screen, mounted (not display:none) so captureRef can grab it —
        // a dedicated square composition for the Spotify cover upload, kept
        // separate from the wide on-screen banner above. Never visible to
        // the user; stays in sync with mood/weather/place as they change.
        // Stays unconditional regardless of activity — every save path,
        // including the Road Trip page's, reads from this same ref.
        <View style={s.coverArtOffscreen} pointerEvents="none">
          <CoverArt
            ref={coverArtRef}
            mood={mood}
            weather={weather}
            activityLabel={activityLabel()}
            place={place}
          />
        </View>
      )}

      {target && activity !== "road_trip" && (
        <View style={s.targetRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.targetBig}>{target.bpmMin}–{target.bpmMax}</Text>
            <Text style={s.targetUnit}>BPM · Tuned to You</Text>
          </View>
          {post && (
            <View style={s.lambdaBox}>
              <BounceNumber value={`${Math.round(post.lambda * 100)}`} style={s.lambdaNum} />
              <Text style={s.lambdaLabel}>% PERSONALITY</Text>
            </View>
          )}
        </View>
      )}

      <MyPicksStrip
        picks={myPicks}
        onOpenApple={openApple}
        onReorder={reorderMyPicks}
        onRemove={removeFromMyPicks}
      />

      {myPicks.length > 0 && (
        // Saves the whole accumulated My Picks strip as its own Spotify
        // playlist — independent of the current activity's queue, so it
        // stays available once the catalog spans several activities/
        // refreshes, not just whatever's queued right now.
        <Pressable
          style={[s.picksSaveBtn, picksSaveState === "saving" && s.refreshBtnMaxed]}
          onPress={saveMyPicksToSpotify}
          disabled={picksSaveState === "saving" || picksSaveState === "connecting"}
        >
          <Text style={s.picksSaveBtnText}>
            {picksSaveState === "saving" ? "SAVING…" : picksSaveState === "connecting" ? "CONNECTING…" : `SAVE MY PICKS TO SPOTIFY (${myPicks.length})`}
          </Text>
        </Pressable>
      )}
      {!!picksSaveMsg && (
        <Text style={[s.saveMsg, picksSaveState === "error" && s.saveMsgError]}>{picksSaveMsg}</Text>
      )}

      {loading && activity !== "road_trip" && (
        <View style={{ marginTop: 26, alignItems: "center" }}>
          <ActivityIndicator color={theme.accent} />
          <Text style={s.loadingNote}>tuning to you…</Text>
        </View>
      )}
      {error && activity !== "road_trip" && (
        <View>
          <Text style={s.error}>{error}</Text>
          <Pressable style={s.retry} onPress={() => load(activity)}><Text style={s.retryText}>RETRY</Text></Pressable>
        </View>
      )}
      {diag.length > 0 && (error || loading) && activity !== "road_trip" && (
        <View style={s.diagBox}>{diag.map((d, i) => (<Text key={i} style={s.diagLine}>{'\u203a'} {d}</Text>))}</View>
      )}

      {activity !== "road_trip" && tracks.map(renderTrackRow)}

      {activity && activity !== "road_trip" && tracks.length > 0 && (
        // Re-fetches this activity's pool from scratch, excluding everything
        // shown so far this session. Deliberately does NOT touch myPicks —
        // that store is fully decoupled from `tracks`/`feedback` (see
        // like()/addToMyPicks), so a refresh has nothing to reset there.
        // Capped at MAX_REFRESHES; resets on a genuinely new activity/mode pick.
        <Pressable
          style={[s.refreshBtn, refreshCount >= MAX_REFRESHES && s.refreshBtnMaxed]}
          onPress={refreshPlaylist}
          disabled={loading || refreshCount >= MAX_REFRESHES}
        >
          <Text style={s.refreshBtnText}>
            {loading ? "REFRESHING…" : refreshCount >= MAX_REFRESHES ? "REFRESH LIMIT REACHED" : "REFRESH PLAYLIST"}
          </Text>
        </Pressable>
      )}

      {tracks.length > 0 && activity !== "road_trip" && (
        <Text style={s.footnote}>
          Tap a track to play. Swipe it away if it's not for you — a fresh one swaps in automatically. Heart to add it to your catalog, then tap the queue icon in the bar below to see it and save.
        </Text>
      )}
    </ScrollView>

    {queueTracks.length > 0 && queueOpen && (
      <View style={s.queuePanel}>
        <View style={s.queueHead}>
          <Text style={s.queueTitle}>QUEUE {'\u00b7'} {queueTracks.length}</Text>
          <Pressable onPress={() => setQueueOpen(false)}><Text style={s.queueClose}>Close</Text></Pressable>
        </View>
        <Pressable style={s.spotifyBtn} onPress={saveToSpotify} disabled={saveState === "saving" || saveState === "connecting"}>
          <Text style={s.spotifyBtnText}>
            {saveState === "saving" ? "SAVING\u2026" : saveState === "connecting" ? "CONNECTING\u2026" : (queueTracks.length === 1 ? "ADD TO SPOTIFY" : "SAVE QUEUE TO SPOTIFY")}
          </Text>
        </Pressable>
        {saveMsg ? <Text style={[s.saveMsg, saveState === "error" && s.saveMsgError]}>{saveMsg}</Text> : null}
        <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
          {queueTracks.map((t) => (
            <View key={t.id} style={s.qRow}>
              <Text style={[s.qIndex, t.id === playingId && s.iconVolt]}>{t.id === playingId ? "\u25b6" : "\u2022"}</Text>
              {t.cover && !failedCovers.has(t.cover) ? (
                <Image source={{ uri: t.cover }} style={s.qCover} onError={() => markCoverFailed(t.cover)} />
              ) : (
                <View style={[s.qCover, s.coverEmpty]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.qTitle} numberOfLines={1}>{t.title}</Text>
                <Text style={s.qArtist} numberOfLines={1}>{t.artist}</Text>
              </View>
              <Pressable style={s.iconBtn} onPress={() => play(t)}>
                <Text style={[s.icon, playingId === t.id && s.iconVolt]}>{playingId === t.id ? "\u275a\u275a" : "\u25b6"}</Text>
              </Pressable>
              <Pressable style={s.iconBtn} onPress={() => dequeue(t.id)}><Text style={s.icon}>{"\u2715"}</Text></Pressable>
            </View>
          ))}
        </ScrollView>
      </View>
    )}

    {nowPlaying && (
      <View style={s.nowBar}>
        {nowPlaying.cover && !failedCovers.has(nowPlaying.cover) ? (
          <Image source={{ uri: nowPlaying.cover }} style={s.nowCover} onError={() => markCoverFailed(nowPlaying.cover)} />
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={s.nowTitle} numberOfLines={1}>{nowPlaying.title}</Text>
          <Text style={s.nowArtist} numberOfLines={1}>{upNext ? "Up Next \u00b7 " + upNext.title : nowPlaying.artist + " \u00b7 Preview"}</Text>
        </View>
        {queueTracks.length > 0 && (
          <Pressable style={s.iconBtn} onPress={() => setQueueOpen((o) => !o)}>
            <Text style={[s.icon, queueOpen && s.iconVolt, { fontSize: 18 }]}>{"\u2630"}</Text>
          </Pressable>
        )}
        <Pressable style={s.iconBtn} onPress={() => play(nowPlaying)}><Text style={[s.icon, s.iconVolt, { fontSize: 20 }]}>{"\u275a\u275a"}</Text></Pressable>
        <Pressable style={s.iconBtn} onPress={() => skip(nowPlaying)}><Text style={[s.icon, { fontSize: 18 }]}>{"\u2715"}</Text></Pressable>
      </View>
    )}

    {moodPromptOpen && (
      <Pressable style={s.moodOverlay} onPress={Keyboard.dismiss}>
        <View style={s.moodCard}>
          <Text style={s.moodKicker}>ONE-TIME {'\u00b7'} THIS SESSION</Text>
          <Text style={s.moodQ}>How are you feeling right now?</Text>
          <Text style={s.moodSub}>Pick as many as fit. This won't be asked again until you reopen the app.</Text>
          <View style={s.bubbleWrap}>
            {MOOD_BUBBLES.map((label) => {
              const sel = selectedBubbles.indexOf(label) !== -1;
              return (
                <Pressable key={label} style={[s.bubble, sel && s.bubbleActive]} onPress={() => toggleBubble(label)}>
                  <Text style={[s.bubbleText, sel && s.bubbleTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={s.moodInput}
            placeholder="add more, in your own words (optional)..."
            placeholderTextColor="#5A5A5A"
            value={extraFeeling}
            onChangeText={setExtraFeeling}
            multiline
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
          />
          <Pressable style={s.moodGo} onPress={confirmMood}><Text style={s.moodGoText}>BUILD MY PLAYLIST</Text></Pressable>
          <Pressable onPress={skipMood} hitSlop={12}><Text style={s.moodSkip}>Skip {"\u2014"} Just Use Activity</Text></Pressable>
        </View>
      </Pressable>
    )}

    {roadTripPageOpen && (
      <View style={s.roadTripPage}>
        <View style={s.header}>
          <Pressable onPress={closeRoadTripPage} hitSlop={12} style={s.headerBackBtn}>
            <Text style={s.headerBack}>Close</Text>
          </Pressable>
          <View style={s.headerTitleWrap} pointerEvents="none">
            <Text style={s.headerTitle}>ROAD TRIP</Text>
          </View>
        </View>

        {!route ? (
          <View style={s.roadTripFormBody}>
            <Text style={s.moodQ}>Where are you headed?</Text>
            <Text style={s.moodSub}>Distance, driving time, and terrain along the route all shape the playlist.</Text>
            <TextInput
              style={[s.moodInput, { minHeight: 0 }]}
              placeholder="From (e.g. San Francisco, CA)"
              placeholderTextColor="#5A5A5A"
              value={fromInput}
              onChangeText={setFromInput}
              returnKeyType="next"
            />
            <TextInput
              style={[s.moodInput, { minHeight: 0 }]}
              placeholder="To (e.g. Los Angeles, CA)"
              placeholderTextColor="#5A5A5A"
              value={toInput}
              onChangeText={setToInput}
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={Keyboard.dismiss}
            />
            <Pressable
              style={[s.moodGo, (!fromInput.trim() || !toInput.trim() || loading) && s.refreshBtnMaxed]}
              onPress={submitRoadTripForm}
              disabled={!fromInput.trim() || !toInput.trim() || loading}
            >
              <Text style={s.moodGoText}>PLAN TRIP</Text>
            </Pressable>
            {loading && (
              <View style={{ marginTop: 26, alignItems: "center" }}>
                <ActivityIndicator color={theme.accent} />
                <Text style={s.loadingNote}>mapping the drive…</Text>
              </View>
            )}
            {error && <Text style={s.error}>{error}</Text>}
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.roadTripBody} showsVerticalScrollIndicator={false}>
            <View style={s.journeyStrip}>
              <Text style={s.journeyPlace} numberOfLines={1}>{route.from}</Text>
              <Text style={s.journeyArrow}>→</Text>
              <Text style={s.journeyPlace} numberOfLines={1}>{route.to}</Text>
            </View>
            <Text style={s.routeLine}>
              {Math.round(route.distanceKm)} km · ~{Math.round(route.durationMin)} min · {route.terrain.charAt(0).toUpperCase() + route.terrain.slice(1)} terrain
            </Text>

            {/* the "feeling placard" — same generated mood/weather art as
                every other activity's session banner */}
            {target && <SessionBanner mood={mood} weather={weather} activityLabel="Road Trip" place={null} />}

            {target && (
              <View style={s.targetRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.targetBig}>{target.bpmMin}–{target.bpmMax}</Text>
                  <Text style={s.targetUnit}>BPM · Tuned to the Drive</Text>
                </View>
              </View>
            )}

            {tracks.length > 0 && (
              // Spotify-branded (not the generic volt button) since this is
              // specifically a Spotify action — same style already used for
              // the queue's save button, for visual consistency across the app.
              <Pressable
                style={s.spotifyBtn}
                onPress={saveRoadTripToSpotify}
                disabled={tripSaveState === "saving" || tripSaveState === "connecting"}
              >
                <Text style={s.spotifyBtnText}>
                  {tripSaveState === "saving" ? "SAVING…" : tripSaveState === "connecting" ? "CONNECTING…" : `SAVE TRIP TO SPOTIFY (${tracks.length})`}
                </Text>
              </Pressable>
            )}
            {!!tripSaveMsg && (
              <Text style={[s.saveMsg, tripSaveState === "error" && s.saveMsgError]}>{tripSaveMsg}</Text>
            )}

            {loading && (
              <View style={{ marginTop: 14, alignItems: "center" }}>
                <ActivityIndicator color={theme.accent} />
                <Text style={s.loadingNote}>refreshing…</Text>
              </View>
            )}
            {error && (
              <View>
                <Text style={s.error}>{error}</Text>
                <Pressable style={s.retry} onPress={() => loadRoadTrip(lastRoadTrip.current.from, lastRoadTrip.current.to)}><Text style={s.retryText}>RETRY</Text></Pressable>
              </View>
            )}

            {tracks.map(renderTrackRow)}

            {tracks.length > 0 && (
              <Pressable
                style={[s.refreshBtn, refreshCount >= MAX_REFRESHES && s.refreshBtnMaxed]}
                onPress={refreshPlaylist}
                disabled={loading || refreshCount >= MAX_REFRESHES}
              >
                <Text style={s.refreshBtnText}>
                  {loading ? "REFRESHING…" : refreshCount >= MAX_REFRESHES ? "REFRESH LIMIT REACHED" : "REFRESH PLAYLIST"}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </View>
    )}
    </View>
  );
}

// Built as a function of the theme's accent/background rather than a static
// module-level StyleSheet, so switching themes (see ProfileScreen's Theme
// picker) restyles every screen without touching any of the JSX below —
// `s` is computed once per theme change via useMemo inside the component.
const buildStyles = (VOLT, BG, SURFACE, BORDER) => StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 22, paddingTop: 4 },
  coverArtOffscreen: { position: "absolute", left: -2000, top: -2000 },
  spotifyBanner: { backgroundColor: SURFACE, borderWidth: 1.5, borderColor: "#1DB954", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16 },
  spotifyBannerText: { color: "#1DB954", fontSize: 12.5, fontWeight: "700", lineHeight: 17 },
  chipsFirst: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 18, marginTop: 10 },
  chip: { borderRadius: 999, borderWidth: 2, borderColor: BORDER, paddingVertical: 10, paddingHorizontal: 18, backgroundColor: SURFACE },
  chipActive: { backgroundColor: VOLT, borderColor: VOLT },
  chipText: { color: "#DADADA", fontSize: 13.5, fontWeight: "800" },
  chipTextActive: { color: "#000" },

  roadTripLink: { alignSelf: "flex-start", marginBottom: 18, paddingVertical: 2 },
  roadTripLinkText: { color: "#6E6E6E", fontSize: 12.5, fontWeight: "700" },
  roadTripLinkTextActive: { color: VOLT },

  targetRow: { flexDirection: "row", gap: 14, alignItems: "flex-start", marginBottom: 14 },
  targetBig: { color: "#FFF", fontSize: 44, fontWeight: "900", letterSpacing: -2, lineHeight: 48 },
  targetUnit: { color: "#8A8A8A", fontSize: 12.5, fontWeight: "700", marginBottom: 6 },
  explain: { color: "#6E6E6E", fontSize: 11.5, lineHeight: 16 },
  lambdaBox: { alignItems: "center" },
  lambdaNum: { color: VOLT, fontSize: 56, fontWeight: "900", letterSpacing: -2, lineHeight: 58 },
  lambdaLabel: { color: "#6E6E6E", fontSize: 9, letterSpacing: 1.5, fontWeight: "800" },

  routeLine: { color: "#8A8A8A", fontSize: 12, fontWeight: "700", marginBottom: 18 },

  // Road Trip's own full-screen page (see roadTripPageOpen) — same
  // full-overlay pattern ProfileScreen uses, but zIndex 5 rather than 10 so
  // the now-playing bar/queue panel (zIndex 10) still show on top of it.
  roadTripPage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, zIndex: 5 },
  // paddingTop matches App.js's own top bar (14) — this overlay already
  // sits inside the same SafeAreaView, so it doesn't need extra clearance
  // stacked on top of the safe-area inset SafeAreaView already applies.
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 22, paddingTop: 14, paddingBottom: 16, position: "relative" },
  headerBackBtn: { zIndex: 1 },
  headerBack: { color: "#9A9A9A", fontSize: 13, fontWeight: "700" },
  headerTitleWrap: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FFF", fontSize: 12, fontWeight: "900", letterSpacing: 3 },
  roadTripFormBody: { paddingHorizontal: 22 },
  roadTripBody: { paddingHorizontal: 22, paddingBottom: 60 },
  journeyStrip: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  journeyPlace: { color: "#FFF", fontSize: 16, fontWeight: "800", flexShrink: 1 },
  journeyArrow: { color: VOLT, fontSize: 16, fontWeight: "900" },

  loadingNote: { color: "#6E6E6E", fontSize: 11.5, marginTop: 8, fontWeight: "600" },
  error: { color: "#FF5A4E", fontSize: 13.5, fontWeight: "700", marginTop: 14, lineHeight: 19 },
  retry: { backgroundColor: VOLT, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 24, alignSelf: "flex-start", marginTop: 10 },
  retryText: { color: "#000", fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },
  diagBox: { backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 12, marginTop: 12 },
  diagLine: { color: "#7A7A7A", fontSize: 11, fontFamily: "Menlo", lineHeight: 16 },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: "#141414" },
  rowSkipped: { opacity: 0.3 },
  // sits behind the row (row has an opaque background so this is hidden
  // until swiped) — revealed as the row translates away, so removing a
  // track leaves a red trail rather than just sliding off silently
  rowRemoveTrail: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#FF5A4E", alignItems: "center", justifyContent: "center" },
  rowRemoveTrailIcon: { color: "#2A0E0E", fontSize: 18, fontWeight: "900" },
  rowLikeTrail: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  rowLikeTrailIcon: { color: "#000", fontSize: 18, fontWeight: "900" },
  // wraps just the cover+text (the tap-to-play/swipe-to-remove gesture
  // area) — the heart stays outside this as a plain sibling, see TrackRow
  rowTapArea: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10 },
  cover: { width: 46, height: 46, borderRadius: 12 },
  coverEmpty: { backgroundColor: "#141414" },
  coverEqOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  title: { color: "#FFF", fontSize: 14.5, fontWeight: "800" },
  artist: { color: "#7A7A7A", fontSize: 12, marginTop: 2, fontWeight: "600" },
  iconBtn: { padding: 7 },
  icon: { color: "#7A7A7A", fontSize: 16, fontWeight: "800" },
  iconVolt: { color: VOLT },
  footnote: { color: "#6E6E6E", fontSize: 11.5, lineHeight: 17, marginTop: 18 },
  refreshBtn: { borderRadius: 999, borderWidth: 1.5, borderColor: BORDER, paddingVertical: 13, alignItems: "center", marginTop: 18, marginBottom: 8 },
  refreshBtnMaxed: { opacity: 0.4 },
  refreshBtnText: { color: "#DADADA", fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },

  picksSaveBtn: { backgroundColor: VOLT, borderRadius: 999, paddingVertical: 13, alignItems: "center", marginBottom: 6 },
  picksSaveBtnText: { color: "#000", fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },

  nowBar: { position: "absolute", left: 12, right: 12, bottom: 14, backgroundColor: SURFACE, borderRadius: 20, borderWidth: 1, borderColor: BORDER, flexDirection: "row", alignItems: "center", gap: 10, padding: 10, zIndex: 10 },
  nowCover: { width: 44, height: 44, borderRadius: 12 },
  nowTitle: { color: "#FFF", fontSize: 13.5, fontWeight: "800" },
  nowArtist: { color: "#7A7A7A", fontSize: 11, fontWeight: "600", marginTop: 1 },

  queuePanel: { position: "absolute", left: 12, right: 12, bottom: 82, backgroundColor: SURFACE, borderRadius: 20, borderWidth: 1, borderColor: BORDER, padding: 12, zIndex: 10 },
  queueHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  queueTitle: { color: VOLT, fontSize: 10.5, letterSpacing: 2, fontWeight: "900" },
  queueClose: { color: "#7A7A7A", fontSize: 12, fontWeight: "700" },
  spotifyBtn: { backgroundColor: "#1DB954", borderRadius: 999, paddingVertical: 12, alignItems: "center", marginBottom: 8 },
  spotifyBtnText: { color: "#000", fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  saveMsg: { color: "#9A9A9A", fontSize: 11.5, textAlign: "center", marginBottom: 8, lineHeight: 16 },
  saveMsgError: { color: "#FF5A4E" },
  qRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 7 },
  qIndex: { color: "#5A5A5A", width: 14, fontSize: 12, textAlign: "center" },
  qCover: { width: 38, height: 38, borderRadius: 9 },
  qTitle: { color: "#EDEDED", fontSize: 13, fontWeight: "700" },
  qArtist: { color: "#7A7A7A", fontSize: 11, marginTop: 1 },

  moodOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000E6", justifyContent: "center", paddingHorizontal: 24, zIndex: 20 },
  moodCard: { backgroundColor: SURFACE, borderRadius: 22, borderWidth: 1, borderColor: BORDER, padding: 22 },
  moodKicker: { color: VOLT, fontSize: 10.5, letterSpacing: 2, fontWeight: "900", marginBottom: 10 },
  moodQ: { color: "#FFF", fontSize: 21, fontWeight: "800", lineHeight: 27, marginBottom: 6 },
  moodSub: { color: "#8A8A8A", fontSize: 12, lineHeight: 17, marginBottom: 16 },
  bubbleWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  bubble: { borderRadius: 999, borderWidth: 1.5, borderColor: BORDER, paddingVertical: 9, paddingHorizontal: 16, backgroundColor: SURFACE },
  bubbleActive: { backgroundColor: VOLT, borderColor: VOLT },
  bubbleText: { color: "#DADADA", fontSize: 13, fontWeight: "700" },
  bubbleTextActive: { color: "#000" },
  moodInput: { backgroundColor: BG, borderRadius: 14, borderWidth: 1, borderColor: BORDER, color: "#EDEDED", fontSize: 14, padding: 14, minHeight: 70, textAlignVertical: "top", marginBottom: 16 },
  moodGo: { backgroundColor: VOLT, borderRadius: 999, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
  moodGoText: { color: "#000", fontWeight: "900", fontSize: 13, letterSpacing: 1 },
  moodSkip: { color: "#7A7A7A", fontSize: 12.5, fontWeight: "700", textAlign: "center" },
});

