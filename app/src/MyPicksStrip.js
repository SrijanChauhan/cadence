import React, { useState, useRef } from "react";
import { View, Text, Image, StyleSheet, Pressable, ScrollView, Modal, Animated } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useTheme } from "./theme";

/**
 * Cadence — My Picks strip with tap / hold-to-remove / hold-and-drag-to-reorder.
 *
 * Three gestures share one touch, disambiguated by TIME then MOVEMENT:
 *   - released quickly (< ~300ms), barely moved  -> tap  -> open in Apple Music
 *   - held past the long-press threshold (350ms), then released without
 *     moving far -> hold-still -> shows an X directly on the album art
 *   - held past the threshold, then moved         -> drag -> reorders picks
 *
 * The remove X is measured to the tile's actual on-screen position and
 * rendered in a transparent, chrome-less Modal at those exact coordinates —
 * not a card/dialog. Modal is used purely as a rendering mechanism (RN
 * stacking rules mean a plain in-place overlay can't reliably sit above a
 * separate full-screen dismiss layer, since zIndex only orders siblings
 * sharing the same parent, not a deeply-nested tile against a layer several
 * levels up), not as a visible "dialog box" — there is no card, no text, no
 * backdrop dimming, just the X floating over the art plus an invisible
 * full-screen tap-outside-to-dismiss layer.
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
const TILE_WIDTH = 84;
const TILE_GAP = 10;
const TILE_STRIDE = TILE_WIDTH + TILE_GAP;
const LONG_PRESS_MS = 350;
const MOVE_THRESHOLD = 14; // px of net movement below which a hold-then-release counts as "held still"
const X_SIZE = 40;

function PickTile({ track, index, total, onOpenApple, onReorder, onHoldStill }) {
  const tileRef = useRef(null);
  const translateX = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => setDragging(true))
    .onUpdate((e) => translateX.setValue(e.translationX))
    .onEnd((e) => {
      const dx = e.translationX;
      if (Math.abs(dx) < MOVE_THRESHOLD) {
        // measure the ALREADY-RENDERED tile (not the cover specifically —
        // same width/position) so the X can be placed exactly over the art
        tileRef.current?.measureInWindow((x, y, width) => {
          onHoldStill(track, { x, y, width });
        });
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
      <Animated.View ref={tileRef} style={[s.pick, { transform: [{ translateX }], zIndex: dragging ? 10 : 0 }]}>
        {track.cover ? <Image source={{ uri: track.cover }} style={s.pickCover} /> : <View style={[s.pickCover, s.coverEmpty]} />}
        <Text style={s.pickTitle} numberOfLines={1}>{track.title}</Text>
      </Animated.View>
    </GestureDetector>
  );
}

export default function MyPicksStrip({ picks, onOpenApple, onReorder, onRemove }) {
  const { theme } = useTheme();
  // { id, x, y, width } of the tile currently showing the remove X, or null
  const [confirm, setConfirm] = useState(null);

  if (picks.length === 0) return null;

  const handleHoldStill = (track, rect) => setConfirm({ id: track.id, ...rect });

  return (
    <View style={s.wrap}>
      <Text style={[s.title, { color: theme.accent }]}>MY PICKS · {picks.length}</Text>
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
            onHoldStill={handleHoldStill}
          />
        ))}
      </ScrollView>

      <Modal transparent visible={!!confirm} animationType="none" onRequestClose={() => setConfirm(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setConfirm(null)}>
          {confirm && (
            <Pressable
              style={[s.removeX, { left: confirm.x + confirm.width / 2 - X_SIZE / 2, top: confirm.y + confirm.width / 2 - X_SIZE / 2 }]}
              onPress={() => { onRemove(confirm.id); setConfirm(null); }}
              hitSlop={8}
            >
              <Text style={s.removeXIcon}>✕</Text>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 14 },
  title: { fontSize: 10.5, letterSpacing: 2, fontWeight: "900", marginBottom: 4 },
  hint: { color: "#5A5A5A", fontSize: 10, marginBottom: 8 },

  pick: { width: TILE_WIDTH, marginRight: TILE_GAP },
  pickCover: { width: TILE_WIDTH, height: TILE_WIDTH, borderRadius: 14, marginBottom: 4 },
  coverEmpty: { backgroundColor: "#141414" },
  pickTitle: { color: "#BABABA", fontSize: 10.5, fontWeight: "700" },

  removeX: {
    position: "absolute", width: X_SIZE, height: X_SIZE, borderRadius: X_SIZE / 2,
    backgroundColor: "rgba(0,0,0,0.55)", borderWidth: 1.5, borderColor: "#FF5A4E",
    alignItems: "center", justifyContent: "center",
  },
  removeXIcon: { color: "#FF5A4E", fontSize: 18, fontWeight: "900" },
});
