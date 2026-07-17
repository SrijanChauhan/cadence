import React, { useState, useEffect } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator, Linking, Modal } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPlaylistHistory } from "./playlistHistory";
import PersonalityPlacard from "./PersonalityPlacard";
import TraitGraph from "./TraitGraph";
import { Equalizer } from "./PlaylistScreen";
import { CoverArt } from "./SessionBanner";
import { THEMES, useTheme } from "./theme";
import { useMyPicks } from "./MyPicksContext";
import { usePreviewPlayer } from "./usePreviewPlayer";
import { getTopArtists } from "./engine/spotify";
import { BACKEND_URL } from "./config";

// Persisted the same way the theme pick and the OCEAN profile itself are —
// scoped by a fingerprint of the traits vector so it survives closing/
// reopening Profile (no re-roll every time), but a genuinely new profile
// (Test Again) invalidates it and triggers a fresh /discover call.
const DISCOVER_KEY = "cadence:discover";

export default function ProfileScreen({ visible, traits, onClose, onRecalibrate }) {
  const { theme, themeId, setTheme } = useTheme();
  const { isMyPick, toggleLike } = useMyPicks();
  const player = usePreviewPlayer();
  const [history, setHistory] = useState(null); // null = loading
  const [selected, setSelected] = useState(null); // a history record, or null for list view
  const [personalityOpen, setPersonalityOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [discover, setDiscover] = useState(null); // null = loading, else { tracks, artists }
  const [artistOpen, setArtistOpen] = useState(null); // artist name, or null
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [failedCovers, setFailedCovers] = useState(() => new Set());
  const markCoverFailed = (url) => setFailedCovers((f) => new Set(f).add(url));

  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    setPersonalityOpen(false);
    setArtistOpen(null);
    setDiscoverOpen(false);
    getPlaylistHistory().then(setHistory);
    // Recommendations for You / Top Artists for You — trait-only, no
    // activity/mood/session context (Profile isn't "in" a session the way
    // the main screen is). Real Spotify top artists (if connected) blend in
    // server-side alongside the personality-driven picks — see POST /discover.
    // Cached under DISCOVER_KEY, keyed by a fingerprint of `traits`, so
    // reopening Profile shows the same list instead of re-rolling it every
    // time — only a genuinely new personality profile (Test Again) misses
    // the cache and triggers a fresh call.
    const traitsKey = JSON.stringify(traits);
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DISCOVER_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached.traitsKey === traitsKey) {
            setDiscover({ tracks: cached.tracks, artists: cached.artists });
            return;
          }
        }
      } catch {}

      setDiscover(null);
      try {
        const { names: spotifyArtists } = await getTopArtists();
        const res = await fetch(`${BACKEND_URL}/discover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ traits, spotifyArtists }),
        });
        const json = await res.json();
        const result = res.ok ? json : { tracks: [], artists: [] };
        setDiscover(result);
        if (res.ok) {
          AsyncStorage.setItem(DISCOVER_KEY, JSON.stringify({ traitsKey, tracks: result.tracks, artists: result.artists })).catch(() => {});
        }
      } catch {
        setDiscover({ tracks: [], artists: [] });
      }
    })();
  }, [visible]);

  // Profile's own player instance isn't unmounted when the overlay just
  // hides (visible: false) — App.js keeps ProfileScreen mounted throughout,
  // rendering null — so without this, closing Profile mid-preview would
  // leave audio playing silently in the background.
  useEffect(() => { if (!visible) player.stop(); }, [visible]);

  if (!visible) return null;

  const goBack = () => {
    if (selected) setSelected(null);
    else if (artistOpen) setArtistOpen(null);
    else if (personalityOpen) setPersonalityOpen(false);
    else if (discoverOpen) setDiscoverOpen(false);
    else onClose();
  };

  return (
    <View style={[s.overlay, { backgroundColor: theme.bg }]}>
      <View style={s.header}>
        <Pressable onPress={goBack} hitSlop={12} style={s.headerBackBtn}>
          <Text style={s.headerBack}>{selected || artistOpen || personalityOpen || discoverOpen ? "← Back" : "Close"}</Text>
        </Pressable>
        {/* Absolutely positioned + centered on the FULL header width, not
            balanced via a fixed-width spacer against a variable-width back
            button — that approach only optically centers when the left and
            right elements happen to be the same width, which "Close" vs
            "← Back" never are, hence the title reading as off-center. */}
        <View style={s.headerTitleWrap} pointerEvents="none">
          <Text style={s.headerTitle} numberOfLines={1}>
            {selected ? "PLAYLIST" : artistOpen ? artistOpen.toUpperCase() : personalityOpen ? "PERSONALITY" : discoverOpen ? "RECCOS" : "PROFILE"}
          </Text>
        </View>
      </View>

      {selected ? (
        <PlaylistDetail
          record={selected}
          theme={theme}
          player={player}
          isMyPick={isMyPick}
          onToggleLike={toggleLike}
          failedCovers={failedCovers}
          onCoverFail={markCoverFailed}
        />
      ) : artistOpen ? (
        <ArtistDetail
          name={artistOpen}
          theme={theme}
          player={player}
          isMyPick={isMyPick}
          onToggleLike={toggleLike}
          failedCovers={failedCovers}
          onCoverFail={markCoverFailed}
        />
      ) : personalityOpen ? (
        <PersonalityDetail
          traits={traits}
          theme={theme}
          onGoProfile={() => setPersonalityOpen(false)}
          onGoPlaylist={onClose}
        />
      ) : discoverOpen ? (
        <DiscoverSection
          discover={discover}
          theme={theme}
          player={player}
          isMyPick={isMyPick}
          onToggleLike={toggleLike}
          onOpenArtist={setArtistOpen}
          failedCovers={failedCovers}
          onCoverFail={markCoverFailed}
        />
      ) : (
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: player.nowPlaying ? 96 : 60 }]} showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => setPersonalityOpen(true)}>
            <PersonalityPlacard traits={traits} />
          </Pressable>
          <View style={s.actionRow}>
            <Pressable style={[s.recalBtn, { borderColor: theme.border }]} onPress={onRecalibrate}>
              <Text style={s.recalBtnText}>Test Again</Text>
            </Pressable>
            <Pressable style={[s.recalBtn, { borderColor: theme.border }]} onPress={() => setThemePickerOpen(true)}>
              <Text style={s.recalBtnText}>Theme</Text>
            </Pressable>
            <Pressable style={[s.recalBtn, { borderColor: theme.border }]} onPress={() => setDiscoverOpen(true)}>
              <Text style={s.recalBtnText}>Reccos</Text>
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
                <CoverArt mood={h.mood} weather={h.weather} activityLabel={h.activityLabel} size={44} />
                <View style={{ flex: 1, marginLeft: 12 }}>
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

      {/* One docked now-playing bar for the whole screen — Recommendations,
          a saved playlist, and an artist's top-10 all share the same player
          instance, so whichever one started playback, this is where it shows. */}
      {player.nowPlaying && (
        <View style={[s.nowBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {player.nowPlaying.cover && !failedCovers.has(player.nowPlaying.cover) ? (
            <Image source={{ uri: player.nowPlaying.cover }} style={s.nowCover} onError={() => markCoverFailed(player.nowPlaying.cover)} />
          ) : (
            <View style={[s.nowCover, s.trackCoverEmpty]} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.nowTitle} numberOfLines={1}>{player.nowPlaying.title}</Text>
            <Text style={s.nowArtist} numberOfLines={1}>
              {player.upNext ? "Up Next · " + player.upNext.title : player.nowPlaying.artist + " · Preview"}
            </Text>
          </View>
          {/* Plain double-triangle glyphs (same dingbat family as the play/
              pause icon), not the ⏭ Unicode symbol — that one renders as a
              colorful emoji on iOS/Android instead of a plain icon,
              inconsistent with every other control in this bar. */}
          {player.upPrev && (
            <Pressable style={s.trackPlayBtn} onPress={() => player.play(player.upPrev)} hitSlop={8}>
              <Text style={[s.trackPlayIcon, { fontSize: 16 }]}>{"◀◀"}</Text>
            </Pressable>
          )}
          <Pressable style={s.trackPlayBtn} onPress={() => player.play(player.nowPlaying)} hitSlop={8}>
            <Text style={[s.trackPlayIcon, { color: theme.accent, fontSize: 18 }]}>{"❚❚"}</Text>
          </Pressable>
          {player.upNext && (
            <Pressable style={s.trackPlayBtn} onPress={() => player.play(player.upNext)} hitSlop={8}>
              <Text style={[s.trackPlayIcon, { fontSize: 16 }]}>{"▶▶"}</Text>
            </Pressable>
          )}
        </View>
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

function PersonalityDetail({ traits, theme, onGoProfile, onGoPlaylist }) {
  return (
    <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
      <Text style={s.detailName}>Your OCEAN Profile</Text>
      <Text style={s.detailStory}>The Big Five breakdown from your last test, same as right after you took it.</Text>
      <TraitGraph traits={traits} accent={theme.accent} surface={theme.surface} />
      <View style={[s.actionRow, { marginTop: 28 }]}>
        <Pressable style={[s.recalBtn, { borderColor: theme.border }]} onPress={onGoProfile}>
          <Text style={s.recalBtnText}>Back to Profile</Text>
        </Pressable>
        <Pressable style={[s.recalBtn, { borderColor: theme.border }]} onPress={onGoPlaylist}>
          <Text style={s.recalBtnText}>Go to Playlists</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** Shared by the saved-playlist detail, Recommendations, and an artist's
 * top-10 — same cover+equalizer-overlay, play, and heart-to-My-Picks
 * treatment everywhere a track shows up in Profile. */
function TrackListItem({ t, theme, playing, isPicked, onPlay, onToggleLike, failedCovers, onCoverFail }) {
  return (
    <View style={s.trackRow}>
      <View>
        {t.cover && !failedCovers.has(t.cover) ? (
          <Image source={{ uri: t.cover }} style={s.trackCover} onError={() => onCoverFail(t.cover)} />
        ) : (
          <View style={[s.trackCover, s.trackCoverEmpty]} />
        )}
        {playing && (
          <View style={s.trackCoverEqOverlay} pointerEvents="none">
            <Equalizer bpm={t.bpm} />
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.trackTitle, playing && { color: theme.accent }]} numberOfLines={1}>{t.title}</Text>
        <Text style={s.trackArtist} numberOfLines={1}>{t.artist}</Text>
      </View>
      <Pressable style={s.trackPlayBtn} onPress={onPlay} hitSlop={8}>
        <Text style={[s.trackPlayIcon, playing && { color: theme.accent }]}>{playing ? "❚❚" : "▶"}</Text>
      </Pressable>
      <Pressable style={s.trackPlayBtn} onPress={onToggleLike} hitSlop={8}>
        <Text style={[s.trackPlayIcon, isPicked && { color: theme.accent }]}>{"♥"}</Text>
      </Pressable>
    </View>
  );
}

/** "Recommendations for You" (5 personality-driven tracks) and "Top Artists
 * for You" (5 names, real Spotify/Last.fm artists blended with genre-driven
 * picks server-side — see pickTopArtists) — both live inline on the main
 * Profile view, not a separate page, since they're meant to be glanceable
 * right below the personality placard, not another destination to visit. */
function DiscoverSection({ discover, theme, player, isMyPick, onToggleLike, onOpenArtist, failedCovers, onCoverFail }) {
  return (
    <ScrollView contentContainerStyle={[s.body, { paddingBottom: player.nowPlaying ? 96 : 60 }]} showsVerticalScrollIndicator={false}>
      <Text style={s.kicker}>FOR YOU</Text>
      {discover === null ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} />
      ) : discover.tracks.length === 0 ? (
        <Text style={s.empty}>Nothing to show yet — connect Spotify or take the quiz for better picks.</Text>
      ) : (
        discover.tracks.map((t) => (
          <TrackListItem
            key={t.id}
            t={t}
            theme={theme}
            playing={player.playingId === t.id}
            isPicked={isMyPick(t.id)}
            onPlay={() => player.play(t, discover.tracks)}
            onToggleLike={() => onToggleLike(t)}
            failedCovers={failedCovers}
            onCoverFail={onCoverFail}
          />
        ))
      )}

      <Text style={[s.kicker, { marginTop: 28 }]}>TOP ARTISTS</Text>
      {discover === null ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} />
      ) : discover.artists.length === 0 ? (
        <Text style={s.empty}>Nothing to show yet.</Text>
      ) : (
        discover.artists.map((a) => (
          <Pressable key={a.name} style={s.row} onPress={() => onOpenArtist(a.name)}>
            {a.cover && !failedCovers.has(a.cover) ? (
              <Image source={{ uri: a.cover }} style={s.trackCover} onError={() => onCoverFail(a.cover)} />
            ) : (
              <View style={[s.trackCover, s.trackCoverEmpty]} />
            )}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.rowName} numberOfLines={1}>{a.name}</Text>
            </View>
            <Text style={s.rowChevron}>›</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function ArtistDetail({ name, theme, player, isMyPick, onToggleLike, failedCovers, onCoverFail }) {
  const [tracks, setTracks] = useState(null); // null = loading

  useEffect(() => {
    setTracks(null);
    fetch(`${BACKEND_URL}/artist-tracks?name=${encodeURIComponent(name)}`)
      .then((res) => res.json())
      .then((json) => setTracks(json.tracks || []))
      .catch(() => setTracks([]));
  }, [name]);

  return (
    <ScrollView contentContainerStyle={[s.body, { paddingBottom: player.nowPlaying ? 96 : 60 }]} showsVerticalScrollIndicator={false}>
      <Text style={s.detailName}>{name}</Text>
      <Text style={[s.kicker, { marginTop: 16 }]}>TOP {tracks?.length || 10}</Text>
      {tracks === null ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 16 }} />
      ) : tracks.length === 0 ? (
        <Text style={s.empty}>Couldn't find tracks for this artist right now.</Text>
      ) : (
        tracks.map((t) => (
          <TrackListItem
            key={t.id}
            t={t}
            theme={theme}
            playing={player.playingId === t.id}
            isPicked={isMyPick(t.id)}
            onPlay={() => player.play(t, tracks)}
            onToggleLike={() => onToggleLike(t)}
            failedCovers={failedCovers}
            onCoverFail={onCoverFail}
          />
        ))
      )}
    </ScrollView>
  );
}

function PlaylistDetail({ record, theme, player, isMyPick, onToggleLike, failedCovers, onCoverFail }) {
  const tracks = record.tracks || [];

  return (
    <ScrollView contentContainerStyle={[s.body, { paddingBottom: player.nowPlaying ? 96 : 60 }]} showsVerticalScrollIndicator={false}>
      <View style={{ alignItems: "center", marginBottom: 18 }}>
        <CoverArt mood={record.mood} weather={record.weather} activityLabel={record.activityLabel} size={200} />
      </View>
      <Text style={s.detailName}>{record.name}</Text>
      <Text style={s.detailStory}>{record.story}</Text>
      {record.spotifyUrl && (
        <Pressable onPress={() => Linking.openURL(record.spotifyUrl)}>
          <Text style={[s.detailLink, { color: theme.accent }]}>Open in Spotify →</Text>
        </Pressable>
      )}

      <Text style={[s.kicker, { marginTop: 24 }]}>TRACKS · {tracks.length}</Text>
      {player.playError && <Text style={s.playError}>{player.playError}</Text>}
      {tracks.map((t) => (
        <TrackListItem
          key={t.id}
          t={t}
          theme={theme}
          playing={player.playingId === t.id}
          isPicked={isMyPick(t.id)}
          onPlay={() => player.play(t, tracks)}
          onToggleLike={() => onToggleLike(t)}
          failedCovers={failedCovers}
          onCoverFail={onCoverFail}
        />
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 10 },
  // paddingHorizontal matches body (22) so Close/Back lines up with the
  // content below it; position:relative anchors the absolutely-centered
  // title. paddingTop matches App.js's own top bar (14) — this overlay
  // already sits inside the same SafeAreaView as that bar, so it doesn't
  // need extra clearance on top of the safe-area inset SafeAreaView already
  // applies; the old 54 stacked redundant padding on top of that, pushing
  // PROFILE/PERSONALITY noticeably lower than CADENCE on the screen behind it.
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 22, paddingTop: 14, paddingBottom: 16, position: "relative" },
  headerBackBtn: { zIndex: 1 },
  headerBack: { color: "#9A9A9A", fontSize: 13, fontWeight: "700" },
  headerTitleWrap: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FFF", fontSize: 12, fontWeight: "900", letterSpacing: 3 },

  body: { paddingHorizontal: 22, paddingBottom: 60 },
  kicker: { color: "#6E6E6E", fontSize: 12, letterSpacing: 4, fontWeight: "800", marginBottom: 10 },
  actionRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
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
  trackCoverEqOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  trackTitle: { color: "#EDEDED", fontSize: 13.5, fontWeight: "700" },
  trackArtist: { color: "#7A7A7A", fontSize: 11.5, marginTop: 1 },
  trackPlayBtn: { padding: 8 },
  trackPlayIcon: { color: "#7A7A7A", fontSize: 15, fontWeight: "800" },
  playError: { color: "#FF5A4E", fontSize: 12.5, fontWeight: "600", lineHeight: 18, marginBottom: 10 },

  nowBar: { position: "absolute", left: 12, right: 12, bottom: 14, borderRadius: 20, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  nowCover: { width: 44, height: 44, borderRadius: 12 },
  nowTitle: { color: "#FFF", fontSize: 13.5, fontWeight: "800" },
  nowArtist: { color: "#7A7A7A", fontSize: 11, fontWeight: "600", marginTop: 1 },
});
