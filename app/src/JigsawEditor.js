import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, TextInput, Pressable, ScrollView } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useJigsaw, JIGSAW_BLOCKS } from "./jigsaw";

/**
 * Cadence — Jigsaw board: drag-and-drop reordering of the main playlist
 * screen's five sections, styled as actual puzzle pieces (bordered cards
 * with visible gaps between them, a corner grip, a slight raised shadow)
 * instead of a plain list with up/down buttons — you can see the layout
 * you're building as you drag, before deciding to save it.
 *
 * Gesture approach mirrors MyPicksStrip.js's hold-and-drag reorder
 * (same react-native-gesture-handler plain-JS-callback Pan API, no
 * Reanimated) just transposed to a vertical stack: the dragged piece
 * follows the finger via translateY, and on release the vertical
 * distance moved is rounded to a whole number of piece-slots to compute
 * the new index — same "snap on release" model, not a live neighbor-
 * shifting animation.
 */
const PIECE_HEIGHT = 236;
const PIECE_GAP = 16;
const PIECE_STRIDE = PIECE_HEIGHT + PIECE_GAP;

// Real My Picks tile dimensions (MyPicksStrip.js) — matched exactly, not
// approximated, since the cover row is the tallest/widest piece of content
// any block preview needs to fit.
const PICK_TILE = 84;
const PICK_GAP = 10;

/**
 * The actual homepage widgets at 100% real scale — every size/weight/
 * colour/letter-spacing below is copied directly from PlaylistScreen.js's
 * own modeFeelBtn/targetRow/refreshBtn styles and MyPicksStrip.js's own
 * tile styles, not approximated. Card height fits the tallest of these
 * (My Picks, with its 84px cover art); shorter content (Mode & Feel,
 * Refresh) sits vertically centered in the extra room.
 */
function PiecePreview({ blockKey, theme }) {
  switch (blockKey) {
    case "modeFeel":
      // matches PlaylistScreen.js modeFeelBtn/modeFeelBtnText exactly
      return (
        <View style={s.fullRow}>
          <View style={[s.fullPill, { backgroundColor: theme.surface }]}>
            <Text style={s.fullPillText}>MODE</Text>
          </View>
          <View style={[s.fullPill, { backgroundColor: theme.surface }]}>
            <Text style={s.fullPillText}>FEEL</Text>
          </View>
        </View>
      );
    case "bpm":
      // matches PlaylistScreen.js targetRow/targetBig/targetUnit/lambdaBox/
      // lambdaNum/lambdaLabel exactly, including that the BPM number is
      // plain white (not accent) while the personality number is accent
      return (
        <View style={s.targetRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.targetBig}>120–140</Text>
            <Text style={s.targetUnit}>BPM · Tuned to You</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={[s.lambdaNum, { color: theme.accent }]}>78</Text>
            <Text style={s.lambdaLabel}>% PERSONALITY</Text>
          </View>
        </View>
      );
    case "myPicks":
      return (
        <View>
          <Text style={[s.picksTitle, { color: theme.accent }]}>MY PICKS · 4</Text>
          <Text style={s.picksHint}>Tap to Open · Hold to Remove · Hold + Drag to Reorder</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {[0, 1, 2, 3].map((i) => <View key={i} style={[s.pickCover, { backgroundColor: theme.border }]} />)}
          </ScrollView>
          <View style={[s.fullBar, { backgroundColor: theme.accent, marginTop: 10 }]}>
            <Text style={s.fullBarText} numberOfLines={1}>SAVE MY PICKS TO SPOTIFY (4)</Text>
          </View>
        </View>
      );
    case "songs":
      // matches PlaylistScreen.js row/cover/title/artist/icon exactly
      return (
        <View>
          {[0, 1].map((i) => (
            <View key={i} style={s.trackRow}>
              <View style={[s.trackCover, { backgroundColor: theme.border }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.trackTitle} numberOfLines={1}>Track Title</Text>
                <Text style={s.trackArtist} numberOfLines={1}>Artist Name  ·  128 BPM</Text>
              </View>
              <Text style={s.trackHeart}>♥</Text>
            </View>
          ))}
        </View>
      );
    case "refresh":
      // matches PlaylistScreen.js refreshBtn/refreshBtnText exactly
      return (
        <View style={[s.fullOutlineBar, { borderColor: theme.border }]}>
          <Text style={s.fullOutlineBarText}>REFRESH PLAYLIST</Text>
        </View>
      );
    default:
      return null;
  }
}

const LONG_PRESS_MS = 350;

function JigsawPiece({ block, index, total, onReorder, theme }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);

  // activateAfterLongPress, same as MyPicksStrip's drag reorder — without
  // it this Pan would swallow every touch that starts on a piece, including
  // a plain scroll of the surrounding Canvas ScrollView. Requiring a hold
  // first lets a quick scroll pass through untouched, and only a deliberate
  // hold-then-drag (matching the grip handle's "tactile" hold feel) claims
  // the touch to reorder.
  const panGesture = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => setDragging(true))
    .onUpdate((e) => translateY.setValue(e.translationY))
    .onEnd((e) => {
      const indexDelta = Math.round(e.translationY / PIECE_STRIDE);
      const newIndex = Math.max(0, Math.min(total - 1, index + indexDelta));
      if (newIndex !== index) onReorder(index, newIndex);
    })
    .onFinalize(() => {
      setDragging(false);
      Animated.spring(translateY, { toValue: 0, friction: 7, useNativeDriver: true }).start();
    });

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[
          s.piece,
          { backgroundColor: theme.surface, borderColor: theme.border },
          { transform: [{ translateY }], zIndex: dragging ? 10 : 0 },
          dragging && s.pieceDragging,
        ]}
      >
        {/* Three actual dot elements, not a "⋮" font glyph — renders
            crisp and consistent size across devices instead of relying
            on however a given font draws that character. */}
        <View style={s.pieceGrip}>
          <View style={s.gripDot} />
          <View style={s.gripDot} />
          <View style={s.gripDot} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.pieceLabel, { color: theme.accent }]}>{block.label}</Text>
          <PiecePreview blockKey={block.key} theme={theme} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export function JigsawEditor({ theme }) {
  const { order, presets, activeId, selectPreset, savePreset } = useJigsaw();
  const [localOrder, setLocalOrder] = useState(order);
  const [name, setName] = useState(`Jigsaw #${presets.length + 1}`);

  // Re-sync the editable copy whenever a different saved preset is
  // selected below, so dragging always starts from what's actually active.
  React.useEffect(() => { setLocalOrder(order); }, [activeId]);

  const onReorder = (from, to) => {
    setLocalOrder((cur) => {
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const onSave = () => {
    savePreset(localOrder, name);
    setName(`Jigsaw #${presets.length + 2}`);
  };

  return (
    <View>
      <Text style={s.kicker}>DRAG TO REORDER</Text>
      <Text style={s.hint}>Hold a piece and drag it up or down to build your own layout.</Text>
      <View style={{ height: localOrder.length * PIECE_STRIDE - PIECE_GAP }}>
        {localOrder.map((key, i) => {
          const block = JIGSAW_BLOCKS.find((b) => b.key === key);
          return (
            <View key={key} style={{ position: "absolute", top: i * PIECE_STRIDE, left: 0, right: 0 }}>
              <JigsawPiece block={block} index={i} total={localOrder.length} onReorder={onReorder} theme={theme} />
            </View>
          );
        })}
      </View>

      <Text style={[s.kicker, { marginTop: 24 }]}>SAVE AS</Text>
      <TextInput
        style={[s.nameInput, { borderColor: theme.border }]}
        value={name}
        onChangeText={setName}
        placeholder="Preset name"
        placeholderTextColor="#5A5A5A"
        returnKeyType="done"
      />
      <Pressable style={[s.saveBtn, { backgroundColor: theme.accent }]} onPress={onSave}>
        <Text style={s.saveBtnText}>SAVE PRESET</Text>
      </Pressable>

      <Text style={[s.kicker, { marginTop: 24 }]}>PRESETS</Text>
      {presets.map((p) => (
        <Pressable key={p.id} style={s.presetRow} onPress={() => selectPreset(p.id)}>
          <Text style={s.presetRowLabel}>{p.name}</Text>
          {p.id === activeId && <Text style={[s.presetCheck, { color: theme.accent }]}>✓</Text>}
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  kicker: { color: "#6E6E6E", fontSize: 12, letterSpacing: 4, fontWeight: "800", marginBottom: 10 },
  hint: { color: "#5A5A5A", fontSize: 11.5, lineHeight: 16, marginBottom: 14, marginTop: -4 },

  // Puzzle-piece look: a bordered, slightly raised card per block with real
  // vertical gap (PIECE_GAP) between pieces — not a flat, edge-to-edge list.
  piece: {
    height: PIECE_HEIGHT, borderRadius: 16, borderWidth: 1.5, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
  },
  pieceDragging: { shadowOpacity: 0.5, shadowRadius: 10, elevation: 8 },
  pieceGrip: { width: 28, alignItems: "center", justifyContent: "center", gap: 4 },
  gripDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: "#6E6E6E" },
  pieceLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 1, marginBottom: 6 },

  // Real homepage proportions — same shapes/sizes as PlaylistScreen's own
  // modeFeelBtn/targetRow/picksSaveBtn/trackRow/refreshBtn styles.
  // --- everything below is copied 1:1 from PlaylistScreen.js's own
  // buildStyles() and MyPicksStrip.js's stylesheet, not approximated ---
  fullRow: { flexDirection: "row", alignItems: "center", gap: 12 },

  // modeFeelBtn / modeFeelBtnText
  fullPill: { flex: 1, borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  fullPillText: { color: "#DADADA", fontSize: 13.5, fontWeight: "900", letterSpacing: 1 },

  // targetRow / targetBig / targetUnit / lambdaNum / lambdaLabel
  targetRow: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  targetBig: { color: "#FFF", fontSize: 44, fontWeight: "900", letterSpacing: -2, lineHeight: 48 },
  targetUnit: { color: "#8A8A8A", fontSize: 12.5, fontWeight: "700", marginBottom: 6 },
  lambdaNum: { fontSize: 56, fontWeight: "900", letterSpacing: -2, lineHeight: 58 },
  lambdaLabel: { color: "#6E6E6E", fontSize: 9, letterSpacing: 1.5, fontWeight: "800" },

  // MyPicksStrip.js title / hint / pickCover
  picksTitle: { fontSize: 10.5, letterSpacing: 2, fontWeight: "900", marginBottom: 4 },
  picksHint: { color: "#5A5A5A", fontSize: 10 },
  pickCover: { width: PICK_TILE, height: PICK_TILE, borderRadius: 14, marginRight: PICK_GAP },

  // picksSaveBtn / picksSaveBtnText
  fullBar: { borderRadius: 999, paddingVertical: 13, alignItems: "center" },
  fullBarText: { color: "#000", fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },

  // row / cover / title / artist / icon
  trackRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: "#141414" },
  trackCover: { width: 46, height: 46, borderRadius: 12 },
  trackTitle: { color: "#FFF", fontSize: 14.5, fontWeight: "800" },
  trackArtist: { color: "#7A7A7A", fontSize: 12, marginTop: 2, fontWeight: "600" },
  trackHeart: { color: "#7A7A7A", fontSize: 16, fontWeight: "800" },

  // refreshBtn / refreshBtnText
  fullOutlineBar: { borderRadius: 999, borderWidth: 1.5, paddingVertical: 13, alignItems: "center" },
  fullOutlineBarText: { color: "#DADADA", fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },

  nameInput: { backgroundColor: "#141414", borderRadius: 14, borderWidth: 1, color: "#EDEDED", fontSize: 14, padding: 14, marginBottom: 14 },
  saveBtn: { borderRadius: 999, paddingVertical: 13, alignItems: "center", marginBottom: 8 },
  saveBtnText: { color: "#000", fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },

  presetRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderColor: "#161616" },
  presetRowLabel: { color: "#EDEDED", fontSize: 14.5, fontWeight: "800" },
  presetCheck: { fontSize: 16, fontWeight: "900" },
});
