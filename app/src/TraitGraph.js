import React, { useRef, useEffect } from "react";
import { View, Text, StyleSheet, Animated, Platform } from "react-native";
import { TRAITS, DESC, bucket } from "./traits";

/**
 * Cadence — OCEAN bar graph, reusable outside the onboarding quiz.
 * Same visual as OnboardingScreen's results screen (equalizer-style bars +
 * per-trait description rows), but standalone so Profile can show it again
 * any time without re-running the quiz — traits persist as a 0-1 vector
 * (see App.js's cadence:profile), converted back to the 0-100 scale the
 * bars/descriptions were designed around.
 */
const rounded = Platform.select({ ios: "System", android: "sans-serif-black", default: "System" });

export default function TraitGraph({ traits, accent, surface }) {
  const data = TRAITS.reduce((a, t) => ({ ...a, [t.key]: Math.round((traits?.[t.key] ?? 0.5) * 100) }), {});
  const anims = useRef(TRAITS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(80, TRAITS.map((t, i) =>
      Animated.spring(anims[i], { toValue: data[t.key], friction: 5, tension: 60, useNativeDriver: false })
    )).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traits]);

  return (
    <View>
      <View style={s.eq}>
        {TRAITS.map((t, i) => (
          <View style={s.eqBand} key={t.key}>
            <Text style={[s.eqScore, { color: accent }]}>{data[t.key]}</Text>
            <View style={[s.eqTrack, { backgroundColor: surface }]}>
              <Animated.View
                style={[
                  s.eqFill,
                  { backgroundColor: accent, height: anims[i].interpolate({ inputRange: [0, 100], outputRange: ["4%", "100%"] }) },
                ]}
              />
            </View>
            <Text style={s.eqKey}>{t.key}</Text>
          </View>
        ))}
      </View>

      <View style={{ marginTop: 24 }}>
        {TRAITS.map((t) => (
          <View style={s.readRow} key={t.key}>
            <Text style={[s.readKey, { color: accent }]}>{t.key}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.readName}>{t.name}</Text>
              <Text style={s.readDesc}>{DESC[t.key][bucket(data[t.key])]}</Text>
            </View>
            <Text style={s.readPct}>{data[t.key]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  eq: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", height: 200, paddingTop: 10 },
  eqBand: { alignItems: "center", justifyContent: "flex-end", height: "100%", flex: 1 },
  eqScore: { fontSize: 22, fontWeight: "900", fontFamily: rounded, marginBottom: 6 },
  eqTrack: { width: 30, flex: 1, borderRadius: 15, justifyContent: "flex-end", overflow: "hidden" },
  eqFill: { width: "100%", borderRadius: 15, minHeight: 8 },
  eqKey: { color: "#FFF", fontSize: 15, fontWeight: "900", marginTop: 8 },

  readRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: "#1C1C1C" },
  readKey: { fontSize: 19, fontWeight: "900", width: 24 },
  readName: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  readDesc: { color: "#8A8A8A", fontSize: 12, lineHeight: 16, marginTop: 2 },
  readPct: { color: "#FFF", fontSize: 17, fontWeight: "900" },
});
