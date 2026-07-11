import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator, Animated,
} from "react-native";
import { Audio } from "expo-av";
import { ACTIVITIES, seedTarget } from "./engine/seedEngine";
import { searchTracks } from "./engine/deezer";
import { openInAppleMusic } from "./engine/appleMusic";
import { newBucketState, updateBucket, posterior, rankTracks } from "./engine/bayes";

/**
 * Cadence — Playlist screen (Bounce edition)
 * Black / volt / huge bouncing λ readout. Engine logic unchanged.
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [target, setTarget] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const [feedback, setFeedback] = useState({});
  const buckets = useRef({});
  const sound = useRef(null);
  const playStart = useRef(null);

  useEffect(() => () => { sound.current?.unloadAsync(); }, []);

  const load = async (act) => {
    setActivity(act); setLoading(true); setError(null); setTracks([]); setFeedback({});
    try {
      const t = seedTarget(traits, act);
      setTarget(t);
      if (!buckets.current[act]) {
        buckets.current[act] = newBucketState((t.bpmMin + t.bpmMax) / 2);
      }
      const results = await searchTracks({ seedTerms: t.seedTerms, bpmMin: t.bpmMin, bpmMax: t.bpmMax, limit: 20 });
      if (results.length === 0) throw new Error("No tracks came back. Try another mode.");
      setTracks(rankTracks(results, buckets.current[act]));
    } catch (e) {
      setError(e.message || "Couldn't reach Deezer.");
    } finally {
      setLoading(false);
    }
  };

  const play = async (track) => {
    try {
      if (sound.current) { await sound.current.unloadAsync(); sound.current = null; }
      if (playingId === track.id) { setPlayingId(null); return; }
      if (!track.preview) return;
      const { sound: sd } = await Audio.Sound.createAsync({ uri: track.preview }, { shouldPlay: true });
      sound.current = sd;
      setPlayingId(track.id);
      playStart.current = Date.now();
      sd.setOnPlaybackStatusUpdate((st) => {
        if (st.didJustFinish) { giveFeedback(track, "complete"); setPlayingId(null); }
      });
    } catch {
      setError("Preview playback failed — previews expire; reload the mode.");
    }
  };

  const skip = (track) => {
    const listened = playingId === track.id && playStart.current ? (Date.now() - playStart.current) / 1000 : 0;
    giveFeedback(track, listened >= 20 ? "skip_late" : "skip_fast");
    if (playingId === track.id) { sound.current?.unloadAsync(); setPlayingId(null); }
  };

  const giveFeedback = (track, type) => {
    setFeedback((f) => ({ ...f, [track.id]: type }));
    buckets.current[activity] = updateBucket(buckets.current[activity], track.bpm, type);
    setTracks((ts) => rankTracks(ts, buckets.current[activity]));
  };

  const openApple = async (track) => {
    const ok = await openInAppleMusic(track);
    if (ok) giveFeedback(track, "save");
    else setError("No Apple Music match for this one.");
  };

  const post = activity && buckets.current[activity] ? posterior(buckets.current[activity]) : null;

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 44 }}>
      <Text style={s.kicker}>PICK A MODE</Text>
      <View style={s.chips}>
        {ACTIVITIES.map((a) => (
          <Pressable key={a.key} style={[s.chip, activity === a.key && s.chipActive]} onPress={() => load(a.key)}>
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
          </View>
          {post && (
            <View style={s.lambdaBox}>
              <BounceNumber value={`${Math.round(post.lambda * 100)}`} style={s.lambdaNum} />
              <Text style={s.lambdaLabel}>% PERSONALITY</Text>
            </View>
          )}
        </View>
      )}

      {loading && <ActivityIndicator color={VOLT} style={{ marginTop: 30 }} />}
      {error && <Text style={s.error}>{error}</Text>}

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
            <Pressable style={s.iconBtn} onPress={() => giveFeedback(t, "like")}>
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
          ♥ / ✕ / completions re-rank this list live — the big number is how much of the blend is still your
          personality prior; it falls as evidence builds.  opens the full song in Apple Music (counts as a strong
          positive). Previews are 30s Deezer clips.
        </Text>
      )}
    </ScrollView>
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

  targetRow: { flexDirection: "row", gap: 14, alignItems: "flex-start", marginBottom: 16 },
  targetBig: { color: "#FFF", fontSize: 44, fontWeight: "900", letterSpacing: -2, lineHeight: 48 },
  targetUnit: { color: "#8A8A8A", fontSize: 12.5, fontWeight: "700", marginBottom: 6 },
  explain: { color: "#6E6E6E", fontSize: 11.5, lineHeight: 16 },
  lambdaBox: { alignItems: "center" },
  lambdaNum: { color: VOLT, fontSize: 56, fontWeight: "900", letterSpacing: -2, lineHeight: 58 },
  lambdaLabel: { color: "#6E6E6E", fontSize: 9, letterSpacing: 1.5, fontWeight: "800" },

  error: { color: "#FF5A4E", fontSize: 13.5, fontWeight: "700", marginTop: 14, lineHeight: 19 },

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
});
