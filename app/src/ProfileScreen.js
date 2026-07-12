import React, { useState, useEffect } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator, Linking } from "react-native";
import { personalityType } from "./personalityType";
import { getPlaylistHistory } from "./playlistHistory";

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
        <Pressable onPress={selected ? () => setSelected(null) : onClose}>
          <Text style={s.headerBack}>{selected ? "← back" : "Close"}</Text>
        </Pressable>
        <Text style={s.headerTitle}>{selected ? "PLAYLIST" : "PROFILE"}</Text>
        <View style={{ width: 50 }} />
      </View>

      {selected ? (
        <PlaylistDetail record={selected} />
      ) : (
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          <Text style={s.kicker}>YOUR TYPE</Text>
          <Text style={s.typeText}>{personalityType(traits)}</Text>
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
      {(record.tracks || []).map((t) => (
        <View key={t.id} style={s.trackRow}>
          {t.cover ? <Image source={{ uri: t.cover }} style={s.trackCover} /> : <View style={[s.trackCover, s.trackCoverEmpty]} />}
          <View style={{ flex: 1 }}>
            <Text style={s.trackTitle} numberOfLines={1}>{t.title}</Text>
            <Text style={s.trackArtist} numberOfLines={1}>{t.artist}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 54, paddingBottom: 16 },
  headerBack: { color: "#9A9A9A", fontSize: 13, fontWeight: "700", width: 50 },
  headerTitle: { color: "#FFF", fontSize: 12, fontWeight: "900", letterSpacing: 3 },

  body: { paddingHorizontal: 22, paddingBottom: 60 },
  kicker: { color: "#6E6E6E", fontSize: 12, letterSpacing: 4, fontWeight: "800", marginBottom: 10 },
  typeText: { color: VOLT, fontSize: 38, fontWeight: "900", letterSpacing: -1, marginBottom: 18 },
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
});
