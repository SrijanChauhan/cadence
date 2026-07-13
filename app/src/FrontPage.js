import React, { useRef, useEffect } from "react";
import { View, Text, StyleSheet, Animated, Platform } from "react-native";
import { useTheme } from "./theme";

/**
 * Cadence — front page / title card.
 * Shown briefly on every launch (see App.js's minDisplayTime logic) —
 * a branded moment before onboarding/playlist, not a one-time-only splash.
 * Helvetica is a true system font on iOS; Android has no Helvetica at all,
 * so this falls back to its closest neutral system grotesque (sans-serif =
 * Roboto). Same Platform.select pattern OnboardingScreen.js already uses
 * for its own font choice.
 */
const HELVETICA = Platform.select({ ios: "Helvetica", android: "sans-serif", default: "Helvetica" });
const HELVETICA_BOLD = Platform.select({ ios: "Helvetica-Bold", android: "sans-serif", default: "Helvetica-Bold" });

export default function FrontPage() {
  const { theme } = useTheme();
  const wordmarkScale = useRef(new Animated.Value(0.6)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.spring(wordmarkScale, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }).start();
    Animated.timing(taglineOpacity, { toValue: 1, duration: 500, delay: 250, useNativeDriver: true }).start();
    Animated.spring(taglineY, { toValue: 0, friction: 5, tension: 80, delay: 250, useNativeDriver: true }).start();
  }, []);

  return (
    <View style={[s.root, { backgroundColor: theme.bg }]}>
      <Animated.Text style={[s.wordmark, { color: theme.accent, transform: [{ scale: wordmarkScale }] }]}>
        CADENCE
      </Animated.Text>
      <Animated.Text style={[s.tagline, { opacity: taglineOpacity, transform: [{ translateY: taglineY }] }]}>
        Less Music, More You
      </Animated.Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center", paddingHorizontal: 30 },
  wordmark: { fontSize: 46, fontWeight: "900", fontFamily: HELVETICA_BOLD, letterSpacing: 6 },
  tagline: { color: "#EDEDED", fontSize: 16, fontFamily: HELVETICA, fontWeight: "600", marginTop: 12, letterSpacing: 0.5 },
});
