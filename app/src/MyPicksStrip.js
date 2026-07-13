import React, { useState, useRef } from "react";
import { View, Text, Image, StyleSheet, Pressable, ScrollView, Modal, Animated } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

/**
 * Cadence — My Picks strip with tap / hold-to-remove / hold-and-drag-to-reorder.
 *
 * Three gestures share one touch, disambiguated by TIME then MOVEMENT:
 *   - released quickly (< ~300ms), barely moved  -> tap  -> open in Apple Music
 *   - held past the long-press threshold (350ms), then released without
 *     moving far -> hold-still -> shows a remove confirmation
 *   - held past the threshold, then moved         -> drag -> reorders picks
 *
 * Built on react-native-gesture-handler (confirmed bundled in Expo Go, no
 * dev-build risk) using its plain-JS-callback Gesture API rather than
 * worklets, specifically to avoid also pulling in react-native-reanimated,
 * which nothing else in this codebase uses yet. Pan's built-in
 * `activateAfterLongPress` is what lets a quick horizontal swipe pass
 * through to the surrounding ScrollView untouched — the pan gesture simply
 * doesn't claim the touch at all until the hold threshold elapses, so
 * normal scrolling of the strip is unaffected.
 *
 * NOTE: this gesture composition could not be visually verified on a device
 * in this environment — the logic follows gesture-handler's documented
 * patterns, but the exact hold-duration/movement-threshold feel is worth
 * checking on-device and adjusting LONG_PRESS_MS / MOVE_THRESHOLD if needed.
 */
const VOLT = "#D6FF3D";
const TILE_WIDTH = 84;
const TILE_GAP = 10;
const TILE_STRIDE = TILE_WIDTH + TILE_GAP;
const LONG_PRESS_MS = 350;
const MOVE_THRESHOLD = 14; // px of net movement below which a hold-then-release counts as "held still"

function PickTile({ track, index, total, onOpenApple, onReorder, onHoldStill }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => setDragging(true))
    .onUpdate((e) => translateX.setValue(e.translationX))
    .onEnd((e) => {
      const dx = e.translationX;
      if (Math.abs(dx) < MOVE_THRESHOLD) {
        onHoldStill(track);
      } else {
        const indexDelta = Math.round(dx / TILE_STRIDE);
        const newIndex = Math.max(0, Math.min(total - 1, index + indexDelta));
        if (newIndex !== index) onReorder(index, newIndex);
      }
    })
    .onFinalize(() => {
      setDragging(false);
      Animated.spring(translateX, { toValue: 0, friction: 7, useNativeDriver: true }).start();
    });

  const tapGesture = Gesture.Tap()
    .maxDuration(LONG_PRESS_MS - 100)
    .onEnd((_e, success) => { if (success) onOpenApple(track); });

  // whichever resolves first wins: a quick release completes the tap before
  // the pan's long-press threshold is ever reached; a held touch lets the
  // pan claim it instead, and the tap fails on its own maxDuration
  const gesture = Gesture.Race(tapGesture, panGesture);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[s.pick, { transform: [{ translateX }], zIndex: dragging ? 10 : 0 }]}>
        {track.cover ? <Image source={{ uri: track.cover }} style={s.pickCover} /> : <View style={[s.pickCover, s.coverEmpty]} />}
        <Text style={s.pickTitle} numberOfLines={1}>{track.title}</Text>
      </Animated.View>
    </GestureDetector>
  );
}

export default function MyPicksStrip({ picks, onOpenApple, onReorder, onRemove }) {
  const [confirmTrack, setConfirmTrack] = useState(null);

  if (picks.length === 0) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>MY PICKS · {picks.length}</Text>
      <Text style={s.hint}>tap to open · hold to remove · hold + drag to reorder</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {picks.map((t, i) => (
          <PickTile
            key={t.id}
            track={t}
            index={i}
            total={picks.length}
            onOpenApple={onOpenApple}
            onReorder={onReorder}
            onHoldStill={setConfirmTrack}
          />
        ))}
      </ScrollView>

      {/* Modal (not an on-tile overlay) so "tap outside dismisses" is exact
          and reliable regardless of where the tile has scrolled to — no
          fragile z-index/position math against a horizontally-scrolling
          sibling. The backdrop Pressable is the "outside" target; the card
          itself stops propagation by being its own Pressable underneath. */}
      <Modal transparent visible={!!confirmTrack} animationType="fade" onRequestClose={() => setConfirmTrack(null)}>
        <Pressable style={s.backdrop} onPress={() => setConfirmTrack(null)}>
          <Pressable style={s.confirmCard} onPress={() => {}}>
            {confirmTrack?.cover ? <Image source={{ uri: confirmTrack.cover }} style={s.confirmCover} /> : null}
            <Text style={s.confirmTitle} numberOfLines={1}>{confirmTrack?.title}</Text>
            <Text style={s.confirmArtist} numberOfLines={1}>{confirmTrack?.artist}</Text>
            <Pressable
              style={s.confirmRemoveBtn}
              onPress={() => { onRemove(confirmTrack.id); setConfirmTrack(null); }}
              hitSlop={10}
            >
              <Text style={s.confirmRemoveIcon}>✕</Text>
            </Pressable>
            <Text style={s.confirmSub}>Remove from My Picks</Text>
            <Text style={s.confirmHint}>Tap outside to cancel</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 14 },
  title: { color: VOLT, fontSize: 10.5, letterSpacing: 2, fontWeight: "900", marginBottom: 4 },
  hint: { color: "#5A5A5A", fontSize: 10, marginBottom: 8 },

  pick: { width: TILE_WIDTH, marginRight: TILE_GAP },
  pickCover: { width: TILE_WIDTH, height: TILE_WIDTH, borderRadius: 14, marginBottom: 4 },
  coverEmpty: { backgroundColor: "#141414" },
  pickTitle: { color: "#BABABA", fontSize: 10.5, fontWeight: "700" },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  confirmCard: { backgroundColor: "#111", borderRadius: 22, borderWidth: 1, borderColor: "#242424", padding: 22, alignItems: "center", width: "100%" },
  confirmCover: { width: 72, height: 72, borderRadius: 16, marginBottom: 12 },
  confirmTitle: { color: "#FFF", fontSize: 15, fontWeight: "800", marginBottom: 2, maxWidth: 220 },
  confirmArtist: { color: "#8A8A8A", fontSize: 12.5, fontWeight: "600", marginBottom: 18, maxWidth: 220 },
  confirmRemoveBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#2A0E0E", borderWidth: 1.5, borderColor: "#FF5A4E", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  confirmRemoveIcon: { color: "#FF5A4E", fontSize: 20, fontWeight: "900" },
  confirmSub: { color: "#DADADA", fontSize: 12.5, fontWeight: "700" },
  confirmHint: { color: "#5A5A5A", fontSize: 11, marginTop: 10 },
});
