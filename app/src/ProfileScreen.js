import React, { useState, useEffect, useRef } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator, Linking } from "react-native";
import { Audio } from "expo-av";
import { getPlaylistHistory } from "./playlistHistory";
import PersonalityPlacard from "./PersonalityPlacard";

const VOLT = "#D6FF3D";

export default function ProfileScreen({ visible, traits, onClose, onRecalibrate }) {
  const [history, setHistory] = useState(null); // null = loading
  const [selected, setSelected] = useState(null); // a history record, or null for list view

  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    getPlaylistHistory().then(setHistory);
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={s.overlay}>
      <View style={s.header}>
        <Pressable onPress={selected ? () => setSelected(null) : onClose} hitSlop={12} style={s.headerBackBtn}>
          <Text style={s.headerBack}>{selected ? "← Back" : "Close"}</Text>
        </Pressable>
        {/* Absolutely positioned + centered on the FULL header width, not
            balanced via a fixed-width spacer against a variable-width back
            button — that approach only optically centers when the left and
            right elements happen to be the same width, which "Close" vs
            "← Back" never are, hence the title reading as off-center. */}
        <View style={s.headerTitleWrap} pointerEvents="none">
          <Text style={s.headerTitle}>{selected ? "PLAYLIST" : "PROFILE"}</Text>
        </View>
      </View>

      {selected ? (
        <PlaylistDetail record={selected} />
      ) : (
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          <PersonalityPlacard traits={traits} />
          <Pressable style={s.recalBtn} onPress={onRecalibrate}>
            <Text style={s.recalBtnText}>Recalibrate</Text>
          </Pressable>

          <Text style={[s.kicker, { marginTop: 32 }]}>YOUR PLAYLISTS</Text>
          {history === null ? (
            <ActivityIndicator color={VOLT} style={{ marginTop: 16 }} />
          ) : history.length === 0 ? (
            <Text style={s.empty}>Nothing saved yet — build a playlist and save it to Spotify to see it here.</Text>
          ) : (
            history.map((h) => (
              <Pressable key={h.id} style={s.row} onPress={() => setSelected(h)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName} numberOfLines={1}>{h.name}</Text>
                  <Text style={s.rowMeta} numberOfLines={1}>
                    {new Date(h.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {h.activityLabel ? ` · ${h.activityLabel}` : ""}
                    {h.mood?.label ? ` · ${h.mood.label}` : ""}
                  </Text>
                </View>
                <Text style={s.rowChevron}>›</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function PlaylistDetail({ record }) {
  const [playingId, setPlayingId] = useState(null);
  const [playError, setPlayError] = useState(null);
  const sound = useRef(null);

  // stop playback if the user navigates back out of this detail view
  useEffect(() => () => { sound.current?.unloadAsync(); }, []);

  const play = async (track) => {
    setPlayError(null);
    try {
      if (sound.current) { await sound.current.unloadAsync(); sound.current = null; }
      if (playingId === track.id) { setPlayingId(null); return; }
      if (!track.preview) { setPlayError("This track has no preview clip."); return; }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true }).catch(() => {});
      const { sound: sd } = await Audio.Sound.createAsync({ uri: track.preview }, { shouldPlay: true });
      sound.current = sd;
      setPlayingId(track.id);
      sd.setOnPlaybackStatusUpdate((st) => { if (st.didJustFinish) setPlayingId(null); });
    } catch {
      // saved playlists can be old — iTunes preview links are far more
      // stable than Deezer's ever were, but not guaranteed to never expire
      setPlayError("Preview playback failed — this link may have expired since it was saved.");
    }
  };

  return (
    <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
      <Text style={s.detailName}>{record.name}</Text>
      <Text style={s.detailStory}>{record.story}</Text>
      {record.spotifyUrl && (
        <Pressable onPress={() => Linking.openURL(record.spotifyUrl)}>
          <Text style={s.detailLink}>Open in Spotify →</Text>
        </Pressable>
      )}

      <Text style={[s.kicker, { marginTop: 24 }]}>TRACKS · {record.tracks?.length || 0}</Text>
      {playError && <Text style={s.playError}>{playError}</Text>}
      {(record.tracks || []).map((t) => (
        <View key={t.id} style={s.trackRow}>
          {t.cover ? <Image source={{ uri: t.cover }} style={s.trackCover} /> : <View style={[s.trackCover, s.trackCoverEmpty]} />}
          <View style={{ flex: 1 }}>
            <Text style={s.trackTitle} numberOfLines={1}>{t.title}</Text>
            <Text style={s.trackArtist} numberOfLines={1}>{t.artist}</Text>
          </View>
          <Pressable style={s.trackPlayBtn} onPress={() => play(t)} hitSlop={8}>
            <Text style={[s.trackPlayIcon, playingId === t.id && s.trackPlayIconActive]}>
              {playingId === t.id ? "❚❚" : "▶"}
            </Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 10 },
  // paddingHorizontal matches body (22) so Close/Back lines up with the
  // content below it; position:relative anchors the absolutely-centered title
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 22, paddingTop: 54, paddingBottom: 16, position: "relative" },
  headerBackBtn: { zIndex: 1 },
  headerBack: { color: "#9A9A9A", fontSize: 13, fontWeight: "700" },
  headerTitleWrap: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FFF", fontSize: 12, fontWeight: "900", letterSpacing: 3 },

  body: { paddingHorizontal: 22, paddingBottom: 60 },
  kicker: { color: "#6E6E6E", fontSize: 12, letterSpacing: 4, fontWeight: "800", marginBottom: 10 },
  recalBtn: { alignSelf: "flex-start", borderRadius: 999, borderWidth: 1.5, borderColor: "#2E2E2E", paddingVertical: 10, paddingHorizontal: 20 },
  recalBtnText: { color: "#DADADA", fontSize: 13, fontWeight: "700" },

  empty: { color: "#6E6E6E", fontSize: 13, lineHeight: 19, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderColor: "#161616" },
  rowName: { color: "#FFF", fontSize: 14.5, fontWeight: "800" },
  rowMeta: { color: "#7A7A7A", fontSize: 12, marginTop: 3, fontWeight: "600" },
  rowChevron: { color: "#4A4A4A", fontSize: 20, marginLeft: 8 },

  detailName: { color: "#FFF", fontSize: 20, fontWeight: "900", marginBottom: 10 },
  detailStory: { color: "#B5B5B5", fontSize: 13.5, lineHeight: 20, marginBottom: 10 },
  detailLink: { color: VOLT, fontSize: 13, fontWeight: "800" },

  trackRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: "#141414" },
  trackCover: { width: 42, height: 42, borderRadius: 10 },
  trackCoverEmpty: { backgroundColor: "#141414" },
  trackTitle: { color: "#EDEDED", fontSize: 13.5, fontWeight: "700" },
  trackArtist: { color: "#7A7A7A", fontSize: 11.5, marginTop: 1 },
  trackPlayBtn: { padding: 8 },
  trackPlayIcon: { color: "#7A7A7A", fontSize: 15, fontWeight: "800" },
  trackPlayIconActive: { color: VOLT },
  playError: { color: "#FF5A4E", fontSize: 12.5, fontWeight: "600", lineHeight: 18, marginBottom: 10 },
});
