import React, { useState, useEffect, useRef } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator, Linking, Modal } from "react-native";
import { Audio } from "expo-av";
import { getPlaylistHistory } from "./playlistHistory";
import PersonalityPlacard from "./PersonalityPlacard";
import { THEMES, useTheme } from "./theme";

export default function ProfileScreen({ visible, traits, onClose, onRecalibrate }) {
  const { theme, themeId, setTheme } = useTheme();
  const [history, setHistory] = useState(null); // null = loading
  const [selected, setSelected] = useState(null); // a history record, or null for list view
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    getPlaylistHistory().then(setHistory);
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={[s.overlay, { backgroundColor: theme.bg }]}>
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
          <View style={s.actionRow}>
            <Pressable style={[s.recalBtn, { borderColor: theme.border }]} onPress={onRecalibrate}>
              <Text style={s.recalBtnText}>Test Again</Text>
            </Pressable>
            <Pressable style={[s.recalBtn, { borderColor: theme.border }]} onPress={() => setThemePickerOpen(true)}>
              <Text style={s.recalBtnText}>Theme</Text>
            </Pressable>
          </View>

          <Text style={[s.kicker, { marginTop: 32 }]}>YOUR PLAYLISTS</Text>
          {history === null ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: 16 }} />
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

      <Modal transparent visible={themePickerOpen} animationType="fade" onRequestClose={() => setThemePickerOpen(false)}>
        <Pressable style={s.themeBackdrop} onPress={() => setThemePickerOpen(false)}>
          <Pressable style={[s.themeCard, { backgroundColor: theme.surface, borderColor: theme.accent }]} onPress={() => {}}>
            <Text style={s.themeCardTitle}>THEME</Text>
            {Object.values(THEMES).map((t) => (
              <Pressable
                key={t.id}
                style={[s.themeRow, t.id === themeId && { borderColor: t.accent }]}
                onPress={() => { setTheme(t.id); setThemePickerOpen(false); }}
              >
                <View style={s.themeSwatches}>
                  <View style={[s.themeSwatch, { backgroundColor: t.accent }]} />
                  <View style={[s.themeSwatch, { backgroundColor: t.accent2 }]} />
                </View>
                <Text style={s.themeRowLabel}>{t.name}</Text>
                {t.id === themeId && <Text style={[s.themeRowCheck, { color: t.accent }]}>✓</Text>}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function PlaylistDetail({ record }) {
  const { theme } = useTheme();
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
          <Text style={[s.detailLink, { color: theme.accent }]}>Open in Spotify →</Text>
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
            <Text style={[s.trackPlayIcon, playingId === t.id && { color: theme.accent }]}>
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
  actionRow: { flexDirection: "row", gap: 10 },
  recalBtn: { alignSelf: "flex-start", borderRadius: 999, borderWidth: 1.5, borderColor: "#2E2E2E", paddingVertical: 10, paddingHorizontal: 20 },
  recalBtnText: { color: "#DADADA", fontSize: 13, fontWeight: "700" },

  themeBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  themeCard: { width: "100%", borderRadius: 22, borderWidth: 1, padding: 18 },
  themeCardTitle: { color: "#8A8A8A", fontSize: 11, letterSpacing: 3, fontWeight: "800", marginBottom: 14 },
  themeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1.5, borderColor: "transparent", marginBottom: 6 },
  themeSwatches: { flexDirection: "row" },
  themeSwatch: { width: 20, height: 20, borderRadius: 10, marginRight: -6, borderWidth: 2, borderColor: "#000" },
  themeRowLabel: { color: "#EDEDED", fontSize: 14.5, fontWeight: "700", flex: 1, marginLeft: 6 },
  themeRowCheck: { fontSize: 16, fontWeight: "900" },

  empty: { color: "#6E6E6E", fontSize: 13, lineHeight: 19, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderColor: "#161616" },
  rowName: { color: "#FFF", fontSize: 14.5, fontWeight: "800" },
  rowMeta: { color: "#7A7A7A", fontSize: 12, marginTop: 3, fontWeight: "600" },
  rowChevron: { color: "#4A4A4A", fontSize: 20, marginLeft: 8 },

  detailName: { color: "#FFF", fontSize: 20, fontWeight: "900", marginBottom: 10 },
  detailStory: { color: "#B5B5B5", fontSize: 13.5, lineHeight: 20, marginBottom: 10 },
  detailLink: { fontSize: 13, fontWeight: "800" },

  trackRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: "#141414" },
  trackCover: { width: 42, height: 42, borderRadius: 10 },
  trackCoverEmpty: { backgroundColor: "#141414" },
  trackTitle: { color: "#EDEDED", fontSize: 13.5, fontWeight: "700" },
  trackArtist: { color: "#7A7A7A", fontSize: 11.5, marginTop: 1 },
  trackPlayBtn: { padding: 8 },
  trackPlayIcon: { color: "#7A7A7A", fontSize: 15, fontWeight: "800" },
  playError: { color: "#FF5A4E", fontSize: 12.5, fontWeight: "600", lineHeight: 18, marginBottom: 10 },
});
