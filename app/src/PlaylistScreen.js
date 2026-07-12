import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator, Animated, TextInput,
} from "react-native";
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ACTIVITIES, seedTarget } from "./engine/seedEngine";
import { analyzeFeeling, arousalToBpmShift } from "./engine/moodEngine";
import { searchTracks } from "./engine/musicProvider";
import { openInAppleMusic } from "./engine/appleMusic";
import { connectSpotify, hasSpotifyAuth, createPlaylistFromTracks } from "./engine/spotify";
import { newBucketState, updateBucket, posterior, rankTracks } from "./engine/bayes";

/**
 * Cadence — Playlist screen v3 (Bounce)
 * New: session picks strip, now-playing bar, retry, on-screen diagnostics
 * so data-layer failures are visible on-device.
 */

const VOLT = "#D6FF3D";

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
  const [moodPromptFor, setMoodPromptFor] = useState(null); // activity key awaiting a feeling
  const [feelingText, setFeelingText] = useState("");
  const [mood, setMood] = useState(null); // { valence, arousal, label, words }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [diag, setDiag] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [target, setTarget] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [queue, setQueue] = useState([]);        // ordered track ids to play
  const [queueOpen, setQueueOpen] = useState(false);
  const buckets = useRef({});
  const sound = useRef(null);
  const playStart = useRef(null);
  const queueRef = useRef([]);                    // mirror for use inside audio callback
  const tracksRef = useRef([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  useEffect(() => {
    // allow previews to play even when the iPhone ring switch is silent
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true }).catch(() => {});
    return () => { sound.current?.unloadAsync(); };
  }, []);

  // V3: persist the favourited queue so it survives app restarts (in-app library)
  useEffect(() => {
    if (!activity) return;
    AsyncStorage.setItem(`cadence:queue:${activity}`, JSON.stringify({
      ids: queue,
      tracks: tracks.filter((t) => queue.includes(t.id)),
    })).catch(() => {});
  }, [queue, activity]);

  const load = async (act, moodResult = null) => {
    setActivity(act); setLoading(true); setError(null); setTracks([]); setFeedback({}); setDiag([]); setQueue([]);
    setMood(moodResult);
    const pushDiag = (m) => setDiag((d) => [...d, m]);
    try {
      const shift = moodResult ? arousalToBpmShift(moodResult.arousal) : 0;
      const t = seedTarget(traits, act, shift);
      setTarget(t);
      if (!buckets.current[act]) {
        // restore learned Bayesian state for this mode if saved
        try {
          const savedB = await AsyncStorage.getItem(`cadence:bayes:${act}`);
          buckets.current[act] = savedB ? JSON.parse(savedB) : newBucketState((t.bpmMin + t.bpmMax) / 2);
        } catch {
          buckets.current[act] = newBucketState((t.bpmMin + t.bpmMax) / 2);
        }
      }
      const results = await searchTracks({
        seedTerms: t.seedTerms, bpmMin: t.bpmMin, bpmMax: t.bpmMax, limit: 20, onDiag: pushDiag,
      });
      if (results.length === 0) throw new Error("Pipeline returned zero tracks — see diagnostics below.");
      let merged = results;
      try {
        const saved = await AsyncStorage.getItem(`cadence:queue:${act}`);
        if (saved) {
          const { ids, tracks: savedTracks } = JSON.parse(saved);
          // add any saved favourites not already in the fresh results
          const have = new Set(results.map((r) => r.id));
          merged = [...results, ...savedTracks.filter((t) => !have.has(t.id))];
          setQueue(ids);
          setFeedback(Object.fromEntries(ids.map((id) => [id, "like"])));
        }
      } catch {}
      setTracks(rankTracks(merged, buckets.current[act]));
    } catch (e) {
      setError(e.message || "Couldn't reach Deezer.");
    } finally {
      setLoading(false);
    }
  };

  const submitFeeling = () => {
    const result = analyzeFeeling(feelingText);
    const act = moodPromptFor;
    setMoodPromptFor(null);
    load(act, result);
  };

  const skipFeeling = () => {
    const act = moodPromptFor;
    setMoodPromptFor(null);
    load(act, null);
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
        if (st.didJustFinish) {
          giveFeedback(track, "complete");
          advanceQueue(track.id); // play the next queued track automatically
        }
      });
    } catch {
      setError("Preview playback failed — previews expire; reload the mode.");
    }
  };

  // when the current track ends, play the next item in the queue after it
  const advanceQueue = (finishedId) => {
    const q = queueRef.current;
    const pos = q.indexOf(finishedId);
    const nextId = pos >= 0 ? q[pos + 1] : null;
    const next = nextId ? tracksRef.current.find((t) => t.id === nextId) : null;
    if (next) { play(next); } else { setPlayingId(null); }
  };

  // favouriting adds to the play queue (if not already in it)
  const enqueue = (track) => {
    setQueue((q) => (q.includes(track.id) ? q : [...q, track.id]));
  };
  const dequeue = (id) => setQueue((q) => q.filter((x) => x !== id));

  const [saveState, setSaveState] = useState("idle"); // idle | connecting | saving | done | error
  const [saveMsg, setSaveMsg] = useState("");

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

  const openApple = async (track) => {
    const ok = await openInAppleMusic(track);
    if (ok) giveFeedback(track, "save");
    else setError("No Apple Music match for this one.");
  };

  const like = (track) => {
    giveFeedback(track, "like");
    enqueue(track); // favouriting queues it up to play next in line
  };

  const playlistName = () => {
    const actLabel = ACTIVITIES.find((a) => a.key === activity)?.label.replace(/\s+/g, "") || "Session";
    const moodLabel = mood?.label || "Mixed";
    return `Cadence.${actLabel}.${moodLabel}`;
  };

  const saveToSpotify = async () => {
    try {
      if (!hasSpotifyAuth()) {
        setSaveState("connecting");
        setSaveMsg("Opening Spotify sign-in…");
        const ok = await connectSpotify();
        if (!ok) { setSaveState("error"); setSaveMsg("Spotify sign-in was cancelled."); return; }
      }
      setSaveState("saving");
      setSaveMsg("Building your Spotify playlist…");
      const list = queue.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
      const { matchedCount, totalCount } = await createPlaylistFromTracks(list, {
        name: playlistName(),
        description: `Made by Cadence — personality + mood tuned (${mood?.label || "no mood set"}).`,
      });
      setSaveState("done");
      setSaveMsg(`Saved ${matchedCount}/${totalCount} tracks to Spotify. Open Spotify → Library.`);
    } catch (e) {
      setSaveState("error");
      setSaveMsg(e.message || "Couldn't save to Spotify.");
    }
  };

  const post = activity && buckets.current[activity] ? posterior(buckets.current[activity]) : null;
  const picks = tracks.filter((t) => feedback[t.id] === "like" || feedback[t.id] === "save");
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
      <Text style={s.kicker}>PICK A MODE</Text>
      <View style={s.chips}>
        {ACTIVITIES.map((a) => (
          <Pressable key={a.key} style={[s.chip, activity === a.key && s.chipActive]} onPress={() => { setFeelingText(""); setMoodPromptFor(a.key); }}>
            <Text style={[s.chipText, activity === a.key && s.chipTextActive]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {target && (
        <View style={s.targetRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.targetBig}>{target.bpmMin}–{target.bpmMax}</Text>
            <Text style={s.targetUnit}>BPM · "{target.seedTerms}"</Text>
            {target.explain.map((e, i) => (<Text key={i} style={s.explain}>• {e}</Text>))}
            {mood && mood.label !== "Neutral" && (
              <Text style={s.moodTag}>feeling: {mood.label}{mood.words.length ? ` (${mood.words.join(", ")})` : ""}</Text>
            )}
          </View>
          {post && (
            <View style={s.lambdaBox}>
              <BounceNumber value={`${Math.round(post.lambda * 100)}`} style={s.lambdaNum} />
              <Text style={s.lambdaLabel}>% PERSONALITY</Text>
            </View>
          )}
        </View>
      )}

      {picks.length > 0 && (
        <View style={s.picksWrap}>
          <Text style={s.picksTitle}>SESSION PICKS · {picks.length}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {picks.map((t) => (
              <Pressable key={t.id} onPress={() => openApple(t)} style={s.pick}>
                {t.cover ? <Image source={{ uri: t.cover }} style={s.pickCover} /> : <View style={[s.pickCover, s.coverEmpty]} />}
                <Text style={s.pickTitle} numberOfLines={1}>{t.title}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {loading && (
        <View style={{ marginTop: 26, alignItems: "center" }}>
          <ActivityIndicator color={VOLT} />
          <Text style={s.loadingNote}>fetching + reading BPMs…</Text>
        </View>
      )}
      {error && (
        <View>
          <Text style={s.error}>{error}</Text>
          {activity && (
            <Pressable style={s.retry} onPress={() => load(activity)}>
              <Text style={s.retryText}>RETRY</Text>
            </Pressable>
          )}
        </View>
      )}
      {diag.length > 0 && (error || loading) && (
        <View style={s.diagBox}>
          {diag.map((d, i) => (<Text key={i} style={s.diagLine}>› {d}</Text>))}
        </View>
      )}

      {tracks.map((t) => {
        const fb = feedback[t.id];
        return (
          <View key={t.id} style={[s.row, fb?.startsWith("skip") && s.rowSkipped]}>
            {t.cover ? <Image source={{ uri: t.cover }} style={s.cover} /> : <View style={[s.cover, s.coverEmpty]} />}
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>{t.title}</Text>
              <Text style={s.artist} numberOfLines={1}>{t.artist}{t.bpm ? `  ·  ${Math.round(t.bpm)} BPM` : ""}</Text>
            </View>
            <Pressable style={s.iconBtn} onPress={() => play(t)}>
              <Text style={[s.icon, playingId === t.id && s.iconVolt]}>{playingId === t.id ? "❚❚" : "▶"}</Text>
            </Pressable>
            <Pressable style={s.iconBtn} onPress={() => openApple(t)}>
              <Text style={[s.icon, fb === "save" && s.iconVolt]}></Text>
            </Pressable>
            <Pressable style={s.iconBtn} onPress={() => like(t)}>
              <Text style={[s.icon, fb === "like" && s.iconVolt]}>♥</Text>
            </Pressable>
            <Pressable style={s.iconBtn} onPress={() => skip(t)}>
              <Text style={s.icon}>✕</Text>
            </Pressable>
          </View>
        );
      })}

      {tracks.length > 0 && (
        <Text style={s.footnote}>
          ♥ favourites a track and adds it to the play queue — it'll auto-play in order after the current preview.
           opens the full song in Apple Music. Tap ☰ in the bar to see the queue. Tempo data by GetSongBPM.com.
        </Text>
      )}
    </ScrollView>

    {queueTracks.length > 0 && queueOpen && (
      <View style={s.queuePanel}>
        <View style={s.queueHead}>
          <Text style={s.queueTitle}>QUEUE · {queueTracks.length}</Text>
          <Pressable onPress={() => setQueueOpen(false)}><Text style={s.queueClose}>close</Text></Pressable>
        </View>
        <Pressable style={s.spotifyBtn} onPress={saveToSpotify} disabled={saveState === "saving" || saveState === "connecting"}>
          <Text style={s.spotifyBtnText}>SAVE QUEUE TO SPOTIFY</Text>
        </Pressable>
        {saveMsg ? <Text style={[s.saveMsg, saveState === "error" && s.saveMsgError]}>{saveMsg}</Text> : null}
        <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
          {queueTracks.map((t) => (
            <View key={t.id} style={s.qRow}>
              <Text style={[s.qIndex, t.id === playingId && s.iconVolt]}>{t.id === playingId ? "▶" : "•"}</Text>
              {t.cover ? <Image source={{ uri: t.cover }} style={s.qCover} /> : <View style={[s.qCover, s.coverEmpty]} />}
              <View style={{ flex: 1 }}>
                <Text style={s.qTitle} numberOfLines={1}>{t.title}</Text>
                <Text style={s.qArtist} numberOfLines={1}>{t.artist}</Text>
              </View>
              <Pressable style={s.iconBtn} onPress={() => play(t)}>
                <Text style={[s.icon, playingId === t.id && s.iconVolt]}>{playingId === t.id ? "❚❚" : "▶"}</Text>
              </Pressable>
              <Pressable style={s.iconBtn} onPress={() => dequeue(t.id)}>
                <Text style={s.icon}>✕</Text>
              </Pressable>
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
          <Text style={s.nowArtist} numberOfLines={1}>
            {upNext ? `up next · ${upNext.title}` : `${nowPlaying.artist} · preview`}
          </Text>
        </View>
        {queueTracks.length > 0 && (
          <Pressable style={s.iconBtn} onPress={() => setQueueOpen((o) => !o)}>
            <Text style={[s.icon, queueOpen && s.iconVolt, { fontSize: 18 }]}>☰</Text>
          </Pressable>
        )}
        <Pressable style={s.iconBtn} onPress={() => play(nowPlaying)}>
          <Text style={[s.icon, s.iconVolt, { fontSize: 20 }]}>❚❚</Text>
        </Pressable>
        <Pressable style={s.iconBtn} onPress={() => skip(nowPlaying)}>
          <Text style={[s.icon, { fontSize: 18 }]}>✕</Text>
        </Pressable>
      </View>
    )}

    {moodPromptFor && (
      <View style={s.moodOverlay}>
        <View style={s.moodCard}>
          <Text style={s.moodKicker}>BEFORE WE BUILD IT</Text>
          <Text style={s.moodQ}>How are you feeling right now?</Text>
          <TextInput
            style={s.moodInput}
            placeholder="e.g. a bit tired but hopeful, restless, calm and focused…"
            placeholderTextColor="#5A5A5A"
            value={feelingText}
            onChangeText={setFeelingText}
            multiline
            autoFocus
          />
          <Pressable style={s.moodGo} onPress={submitFeeling}>
            <Text style={s.moodGoText}>BUILD MY PLAYLIST</Text>
          </Pressable>
          <Pressable onPress={skipFeeling}><Text style={s.moodSkip}>skip — just use activity</Text></Pressable>
        </View>
      </View>
    )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", paddingHorizontal: 22, paddingTop: 4 },
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
  moodTag: { color: VOLT, fontSize: 11.5, fontWeight: "800", marginTop: 6 },
  lambdaBox: { alignItems: "center" },
  lambdaNum: { color: VOLT, fontSize: 56, fontWeight: "900", letterSpacing: -2, lineHeight: 58 },
  lambdaLabel: { color: "#6E6E6E", fontSize: 9, letterSpacing: 1.5, fontWeight: "800" },

  picksWrap: { marginBottom: 14 },
  picksTitle: { color: VOLT, fontSize: 10.5, letterSpacing: 2, fontWeight: "900", marginBottom: 8 },
  pick: { width: 84, marginRight: 10 },
  pickCover: { width: 84, height: 84, borderRadius: 14, marginBottom: 4 },
  pickTitle: { color: "#BABABA", fontSize: 10.5, fontWeight: "700" },

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

  moodOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000E6", justifyContent: "center", paddingHorizontal: 24 },
  moodCard: { backgroundColor: "#111", borderRadius: 22, borderWidth: 1, borderColor: "#242424", padding: 22 },
  moodKicker: { color: VOLT, fontSize: 10.5, letterSpacing: 2, fontWeight: "900", marginBottom: 10 },
  moodQ: { color: "#FFF", fontSize: 21, fontWeight: "800", lineHeight: 27, marginBottom: 16 },
  moodInput: { backgroundColor: "#000", borderRadius: 14, borderWidth: 1, borderColor: "#242424", color: "#EDEDED", fontSize: 14.5, padding: 14, minHeight: 90, textAlignVertical: "top", marginBottom: 16 },
  moodGo: { backgroundColor: VOLT, borderRadius: 999, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
  moodGoText: { color: "#000", fontWeight: "900", fontSize: 13, letterSpacing: 1 },
  moodSkip: { color: "#7A7A7A", fontSize: 12.5, fontWeight: "700", textAlign: "center" },

  queuePanel: { position: "absolute", left: 12, right: 12, bottom: 82, backgroundColor: "#0C0C0C", borderRadius: 20, borderWidth: 1, borderColor: "#222", padding: 12 },
  queueHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  queueTitle: { color: VOLT, fontSize: 10.5, letterSpacing: 2, fontWeight: "900" },
  queueClose: { color: "#7A7A7A", fontSize: 12, fontWeight: "700" },
  saveBtn: { backgroundColor: VOLT, borderRadius: 999, paddingVertical: 12, alignItems: "center", marginBottom: 8 },
  saveBtnText: { color: "#000", fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  spotifyBtn: { backgroundColor: "#1DB954", borderRadius: 999, paddingVertical: 12, alignItems: "center", marginBottom: 8 },
  spotifyBtnText: { color: "#000", fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  saveMsg: { color: "#9A9A9A", fontSize: 11.5, textAlign: "center", marginBottom: 8, lineHeight: 16 },
  saveMsgError: { color: "#FF5A4E" },
  qRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 7 },
  qIndex: { color: "#5A5A5A", width: 14, fontSize: 12, textAlign: "center" },
  qCover: { width: 38, height: 38, borderRadius: 9 },
  qTitle: { color: "#EDEDED", fontSize: 13, fontWeight: "700" },
  qArtist: { color: "#7A7A7A", fontSize: 11, marginTop: 1 },
});
