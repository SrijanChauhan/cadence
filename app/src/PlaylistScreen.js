import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator, Animated, TextInput, Keyboard,
} from "react-native";
import { Audio } from "expo-av";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { captureRef } from "react-native-view-shot";
import { BACKEND_URL } from "./config";
import SessionBanner from "./SessionBanner";
import CoverArt from "./CoverArt";
import { addToPlaylistHistory } from "./playlistHistory";
import { openInAppleMusic } from "./engine/appleMusic";
import { connectSpotify, hasSpotifyAuth, createPlaylistFromTracks, restoreSpotifySession, getTopArtists } from "./engine/spotify";
import { newBucketState, updateBucket, posterior, rankTracks } from "./engine/bayes";

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

const VOLT = "#D6FF3D";

const MOOD_BUBBLES = ["Energetic", "Happy", "Content", "Calm", "Mellow", "Drained", "Down", "Tense"];

function BounceNumber({ value, style }) {
  const scale = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    scale.setValue(0.4);
    Animated.spring(scale, { toValue: 1, friction: 3.2, tension: 140, useNativeDriver: true }).start();
  }, [value]);
  return <Animated.Text style={[style, { transform: [{ scale }] }]}>{value}</Animated.Text>;
}

export default function PlaylistScreen({ traits }) {
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
  // loaded activity's results.
  const [myPicks, setMyPicks] = useState([]);
  const myPicksLoaded = useRef(false);
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
    AsyncStorage.getItem("cadence:myPicks")
      .then((raw) => { if (raw) setMyPicks(JSON.parse(raw)); })
      .catch(() => {})
      .finally(() => { myPicksLoaded.current = true; });
    return () => { sound.current?.unloadAsync(); };
  }, []);

  // persist on every change, but not before the initial load above has run —
  // otherwise the empty initial state would overwrite a previously saved list
  useEffect(() => {
    if (!myPicksLoaded.current) return;
    AsyncStorage.setItem("cadence:myPicks", JSON.stringify(myPicks)).catch(() => {});
  }, [myPicks]);

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

  const onPickActivity = (key) => {
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

  const confirmMood = () => {
    moodAskedThisSession.current = true;
    setMoodPromptOpen(false);
    load(pendingActivity, { labels: selectedBubbles, text: extraFeeling });
  };

  const skipMood = () => {
    moodAskedThisSession.current = true;
    setMoodPromptOpen(false);
    load(pendingActivity, { labels: [], text: "" });
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

  const load = async (act, moodInput) => {
    setActivity(act); setLoading(true); setError(null); setTracks([]); setFeedback({}); setDiag([]); setQueue([]);
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
        limit: 15,
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
    } catch (e) {
      setError(e.message || "Couldn't reach the Cadence backend.");
    } finally {
      setLoading(false);
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
  };

  const addToMyPicks = (track) => {
    setMyPicks((ps) => (ps.some((p) => p.id === track.id) ? ps : [...ps, track]));
  };
  const removeFromMyPicks = (id) => setMyPicks((ps) => ps.filter((p) => p.id !== id));
  const isMyPick = (id) => myPicks.some((p) => p.id === id);

  const like = (track) => { giveFeedback(track, "like"); enqueue(track); addToMyPicks(track); };

  // heart is a toggle: tap again to un-favourite, which also drops it from
  // the auto-play queue it was added to (a track that is no longer "picked"
  // should not still be lined up to play next)
  const toggleLike = (track) => {
    if (isMyPick(track.id)) { removeFromMyPicks(track.id); dequeue(track.id); }
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

  // Each word capitalized, spaces stripped: "Deep Work" -> "DeepWork"
  const capitalizeWords = (s) => (s || "").split(/\s+/).filter(Boolean).join("");

  const playlistName = () => {
    const actLabel = capitalizeWords(ACTIVITIES.find((a) => a.key === activity)?.label) || "Session";
    const moodLabel = capitalizeWords(mood?.label) || "Mixed";
    return `Cadence.${actLabel}.${moodLabel}`;
  };

  // Turns the session's inputs (when, where, weather, mood, activity, tempo)
  // into a short narrated description instead of a bare label list, so
  // opening the playlist in Spotify tells you why it's built the way it is.
  const playlistStory = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const actLabel = ACTIVITIES.find((a) => a.key === activity)?.label || "your session";

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
    if (moodWords) story += ` You were feeling ${moodWords}.`;
    else if (mood?.label && mood.label !== "Neutral") story += ` Mood: ${mood.label.toLowerCase()}.`;

    if (target) story += ` Tuned for ${actLabel} at ${target.bpmMin}–${target.bpmMax} BPM.`;

    return `Made by Cadence. ${story}`;
  };

  const saveToSpotify = async () => {
    try {
      if (!hasSpotifyAuth()) {
        setSaveState("connecting"); setSaveMsg("Opening Spotify sign-in…");
        const ok = await connectSpotify();
        setSpotifyConnected(ok && hasSpotifyAuth());
        if (!ok) { setSaveState("error"); setSaveMsg("Spotify sign-in was cancelled."); return; }
      }
      setSaveState("saving"); setSaveMsg("Building your Spotify playlist…");
      const list = queue.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);

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
      // never at the cost of the upload just not happening.
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

      const name = playlistName();
      const story = playlistStory();
      const { matchedCount, totalCount, url, coverUploaded } = await createPlaylistFromTracks(list, {
        name, description: story, coverImageBase64,
      });

      addToPlaylistHistory({
        name, story,
        activityLabel: ACTIVITIES.find((a) => a.key === activity)?.label,
        mood, weather, place,
        tracks: list,
        spotifyUrl: url,
      });

      setSaveState("done");
      setSaveMsg(
        `Saved ${matchedCount}/${totalCount} tracks to Spotify${coverUploaded ? " with cover art" : ""}. Open Spotify → Library.`
      );
    } catch (e) {
      setSaveState("error"); setSaveMsg(e.message || "Couldn't save to Spotify.");
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
      <Text style={s.kicker}>PICK A MODE</Text>
      <View style={s.chips}>
        {ACTIVITIES.map((a) => (
          <Pressable key={a.key} style={[s.chip, activity === a.key && s.chipActive]} onPress={() => onPickActivity(a.key)}>
            <Text style={[s.chipText, activity === a.key && s.chipTextActive]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {target && (
        <SessionBanner
          ref={bannerRef}
          mood={mood}
          weather={weather}
          activityLabel={ACTIVITIES.find((a) => a.key === activity)?.label}
          place={place}
        />
      )}

      {target && (
        // Off-screen, mounted (not display:none) so captureRef can grab it —
        // a dedicated square composition for the Spotify cover upload, kept
        // separate from the wide on-screen banner above. Never visible to
        // the user; stays in sync with mood/weather/place as they change.
        <View style={s.coverArtOffscreen} pointerEvents="none">
          <CoverArt
            ref={coverArtRef}
            mood={mood}
            weather={weather}
            activityLabel={ACTIVITIES.find((a) => a.key === activity)?.label}
            place={place}
          />
        </View>
      )}

      {target && (
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

      {myPicks.length > 0 && (
        <View style={s.picksWrap}>
          <Text style={s.picksTitle}>MY PICKS · {myPicks.length}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {myPicks.map((t) => (
              <View key={t.id} style={s.pick}>
                <Pressable onPress={() => openApple(t)}>
                  {t.cover ? <Image source={{ uri: t.cover }} style={s.pickCover} /> : <View style={[s.pickCover, s.coverEmpty]} />}
                  <Text style={s.pickTitle} numberOfLines={1}>{t.title}</Text>
                </Pressable>
                <Pressable style={s.pickRemove} onPress={() => removeFromMyPicks(t.id)} hitSlop={8}>
                  <Text style={s.pickRemoveText}>{"✕"}</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {loading && (
        <View style={{ marginTop: 26, alignItems: "center" }}>
          <ActivityIndicator color={VOLT} />
          <Text style={s.loadingNote}>tuning to you…</Text>
        </View>
      )}
      {error && (
        <View>
          <Text style={s.error}>{error}</Text>
          {activity && <Pressable style={s.retry} onPress={() => load(activity)}><Text style={s.retryText}>RETRY</Text></Pressable>}
        </View>
      )}
      {diag.length > 0 && (error || loading) && (
        <View style={s.diagBox}>{diag.map((d, i) => (<Text key={i} style={s.diagLine}>{'\u203a'} {d}</Text>))}</View>
      )}

      {tracks.map((t) => {
        const fb = feedback[t.id];
        return (
          <View key={t.id} style={[s.row, fb && fb.indexOf("skip") === 0 && s.rowSkipped]}>
            {t.cover ? <Image source={{ uri: t.cover }} style={s.cover} /> : <View style={[s.cover, s.coverEmpty]} />}
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>{t.title}</Text>
              <Text style={s.artist} numberOfLines={1}>{t.artist}{t.bpm ? "  \u00b7  " + Math.round(t.bpm) + " BPM" : ""}</Text>
            </View>
            <Pressable style={s.iconBtn} onPress={() => play(t)}>
              <Text style={[s.icon, playingId === t.id && s.iconVolt]}>{playingId === t.id ? "\u275a\u275a" : "\u25b6"}</Text>
            </Pressable>
            <Pressable style={s.iconBtn} onPress={() => toggleLike(t)}>
              <Text style={[s.icon, isMyPick(t.id) && s.iconVolt]}>{"\u2665"}</Text>
            </Pressable>
            <Pressable style={s.iconBtn} onPress={() => removeTrack(t)}>
              <Text style={s.icon}>{"\u2715"}</Text>
            </Pressable>
          </View>
        );
      })}

      {tracks.length > 0 && (
        <Text style={s.footnote}>
          Favourite queues a track. Remove swaps in a fresh one automatically. Tap the queue icon in the bar below to see the queue and save it.
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
              {t.cover ? <Image source={{ uri: t.cover }} style={s.qCover} /> : <View style={[s.qCover, s.coverEmpty]} />}
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
        {nowPlaying.cover ? <Image source={{ uri: nowPlaying.cover }} style={s.nowCover} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={s.nowTitle} numberOfLines={1}>{nowPlaying.title}</Text>
          <Text style={s.nowArtist} numberOfLines={1}>{upNext ? "up next \u00b7 " + upNext.title : nowPlaying.artist + " \u00b7 preview"}</Text>
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
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", paddingHorizontal: 22, paddingTop: 4 },
  coverArtOffscreen: { position: "absolute", left: -2000, top: -2000 },
  spotifyBanner: { backgroundColor: "#0A0A0A", borderWidth: 1.5, borderColor: "#1DB954", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16 },
  spotifyBannerText: { color: "#1DB954", fontSize: 12.5, fontWeight: "700", lineHeight: 17 },
  kicker: { color: "#6E6E6E", fontSize: 12, letterSpacing: 4, fontWeight: "800", marginBottom: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 18 },
  chip: { borderRadius: 999, borderWidth: 2, borderColor: "#242424", paddingVertical: 10, paddingHorizontal: 18, backgroundColor: "#0A0A0A" },
  chipActive: { backgroundColor: VOLT, borderColor: VOLT },
  chipText: { color: "#DADADA", fontSize: 13.5, fontWeight: "800" },
  chipTextActive: { color: "#000" },

  targetRow: { flexDirection: "row", gap: 14, alignItems: "flex-start", marginBottom: 14 },
  targetBig: { color: "#FFF", fontSize: 44, fontWeight: "900", letterSpacing: -2, lineHeight: 48 },
  targetUnit: { color: "#8A8A8A", fontSize: 12.5, fontWeight: "700", marginBottom: 6 },
  explain: { color: "#6E6E6E", fontSize: 11.5, lineHeight: 16 },
  lambdaBox: { alignItems: "center" },
  lambdaNum: { color: VOLT, fontSize: 56, fontWeight: "900", letterSpacing: -2, lineHeight: 58 },
  lambdaLabel: { color: "#6E6E6E", fontSize: 9, letterSpacing: 1.5, fontWeight: "800" },

  picksWrap: { marginBottom: 14 },
  picksTitle: { color: VOLT, fontSize: 10.5, letterSpacing: 2, fontWeight: "900", marginBottom: 8 },
  pick: { width: 84, marginRight: 10, position: "relative" },
  pickCover: { width: 84, height: 84, borderRadius: 14, marginBottom: 4 },
  pickTitle: { color: "#BABABA", fontSize: 10.5, fontWeight: "700" },
  pickRemove: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#1A1A1A", borderWidth: 1, borderColor: "#333", alignItems: "center", justifyContent: "center" },
  pickRemoveText: { color: "#DADADA", fontSize: 11, fontWeight: "900" },

  loadingNote: { color: "#6E6E6E", fontSize: 11.5, marginTop: 8, fontWeight: "600" },
  error: { color: "#FF5A4E", fontSize: 13.5, fontWeight: "700", marginTop: 14, lineHeight: 19 },
  retry: { backgroundColor: VOLT, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 24, alignSelf: "flex-start", marginTop: 10 },
  retryText: { color: "#000", fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },
  diagBox: { backgroundColor: "#0A0A0A", borderRadius: 14, borderWidth: 1, borderColor: "#1C1C1C", padding: 12, marginTop: 12 },
  diagLine: { color: "#7A7A7A", fontSize: 11, fontFamily: "Menlo", lineHeight: 16 },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: "#141414" },
  rowSkipped: { opacity: 0.3 },
  cover: { width: 46, height: 46, borderRadius: 12 },
  coverEmpty: { backgroundColor: "#141414" },
  title: { color: "#FFF", fontSize: 14.5, fontWeight: "800" },
  artist: { color: "#7A7A7A", fontSize: 12, marginTop: 2, fontWeight: "600" },
  iconBtn: { padding: 7 },
  icon: { color: "#7A7A7A", fontSize: 16, fontWeight: "800" },
  iconVolt: { color: VOLT },
  footnote: { color: "#6E6E6E", fontSize: 11.5, lineHeight: 17, marginTop: 18 },

  nowBar: { position: "absolute", left: 12, right: 12, bottom: 14, backgroundColor: "#111", borderRadius: 20, borderWidth: 1, borderColor: "#222", flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  nowCover: { width: 44, height: 44, borderRadius: 12 },
  nowTitle: { color: "#FFF", fontSize: 13.5, fontWeight: "800" },
  nowArtist: { color: "#7A7A7A", fontSize: 11, fontWeight: "600", marginTop: 1 },

  queuePanel: { position: "absolute", left: 12, right: 12, bottom: 82, backgroundColor: "#0C0C0C", borderRadius: 20, borderWidth: 1, borderColor: "#222", padding: 12 },
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

  moodOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000E6", justifyContent: "center", paddingHorizontal: 24 },
  moodCard: { backgroundColor: "#111", borderRadius: 22, borderWidth: 1, borderColor: "#242424", padding: 22 },
  moodKicker: { color: VOLT, fontSize: 10.5, letterSpacing: 2, fontWeight: "900", marginBottom: 10 },
  moodQ: { color: "#FFF", fontSize: 21, fontWeight: "800", lineHeight: 27, marginBottom: 6 },
  moodSub: { color: "#8A8A8A", fontSize: 12, lineHeight: 17, marginBottom: 16 },
  bubbleWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  bubble: { borderRadius: 999, borderWidth: 1.5, borderColor: "#2E2E2E", paddingVertical: 9, paddingHorizontal: 16, backgroundColor: "#0A0A0A" },
  bubbleActive: { backgroundColor: VOLT, borderColor: VOLT },
  bubbleText: { color: "#DADADA", fontSize: 13, fontWeight: "700" },
  bubbleTextActive: { color: "#000" },
  moodInput: { backgroundColor: "#000", borderRadius: 14, borderWidth: 1, borderColor: "#242424", color: "#EDEDED", fontSize: 14, padding: 14, minHeight: 70, textAlignVertical: "top", marginBottom: 16 },
  moodGo: { backgroundColor: VOLT, borderRadius: 999, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
  moodGoText: { color: "#000", fontWeight: "900", fontSize: 13, letterSpacing: 1 },
  moodSkip: { color: "#7A7A7A", fontSize: 12.5, fontWeight: "700", textAlign: "center" },
});
