import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, TextInput, Pressable } from "react-native";
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
const PIECE_HEIGHT = 76;
const PIECE_GAP = 14;
const PIECE_STRIDE = PIECE_HEIGHT + PIECE_GAP;

function PiecePreview({ blockKey, theme }) {
  // A small representative sketch of each section's actual content, not
  // live data — enough to recognize "this is the song list" at a glance
  // while dragging, without wiring real state into the editor.
  switch (blockKey) {
    case "modeFeel":
      return (
        <View style={s.previewRow}>
          <View style={[s.previewPill, { borderColor: theme.accent }]} />
          <View style={[s.previewPill, { borderColor: theme.border }]} />
        </View>
      );
    case "bpm":
      return (
        <View style={s.previewRow}>
          <Text style={[s.previewBpm, { color: theme.accent }]}>120–140</Text>
          <View style={[s.previewDot, { borderColor: theme.accent }]} />
        </View>
      );
    case "myPicks":
      return (
        <View style={s.previewRow}>
          {[0, 1, 2, 3].map((i) => <View key={i} style={[s.previewSquare, { backgroundColor: theme.border }]} />)}
        </View>
      );
    case "songs":
      return (
        <View>
          <View style={[s.previewLine, { width: "80%", backgroundColor: theme.border }]} />
          <View style={[s.previewLine, { width: "55%", backgroundColor: theme.border }]} />
          <View style={[s.previewLine, { width: "65%", backgroundColor: theme.border }]} />
        </View>
      );
    case "refresh":
      return <View style={[s.previewBar, { borderColor: theme.accent }]} />;
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
        <View style={s.pieceGrip}>
          <Text style={s.pieceGripDots}>⋮</Text>
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
  pieceGrip: { width: 28, alignItems: "center", justifyContent: "center" },
  pieceGripDots: { color: "#6E6E6E", fontSize: 22, fontWeight: "900", letterSpacing: -1 },
  pieceLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 1, marginBottom: 6 },

  previewRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  previewPill: { width: 36, height: 14, borderRadius: 999, borderWidth: 1.5 },
  previewBpm: { fontSize: 16, fontWeight: "900" },
  previewDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5 },
  previewSquare: { width: 16, height: 16, borderRadius: 4 },
  previewLine: { height: 6, borderRadius: 3, marginBottom: 4 },
  previewBar: { height: 14, borderRadius: 999, borderWidth: 1.5, width: "70%" },

  nameInput: { backgroundColor: "#141414", borderRadius: 14, borderWidth: 1, color: "#EDEDED", fontSize: 14, padding: 14, marginBottom: 14 },
  saveBtn: { borderRadius: 999, paddingVertical: 13, alignItems: "center", marginBottom: 8 },
  saveBtnText: { color: "#000", fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },

  presetRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderColor: "#161616" },
  presetRowLabel: { color: "#EDEDED", fontSize: 14.5, fontWeight: "800" },
  presetCheck: { fontSize: 16, fontWeight: "900" },
});
