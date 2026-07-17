import React, { useState, useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, View, Text, Pressable, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import FrontPage from "./src/FrontPage";
import OnboardingScreen from "./src/OnboardingScreen";
import PlaylistScreen from "./src/PlaylistScreen";
import ProfileScreen from "./src/ProfileScreen";
import { ThemeProvider, useTheme } from "./src/theme";
import { MyPicksProvider } from "./src/MyPicksContext";
import { JigsawProvider } from "./src/jigsaw";
import { track } from "./src/analytics";

const PROFILE_KEY = "cadence:profile"; // saved OCEAN vector
const FRONT_PAGE_MIN_MS = 1800; // brand moment on every launch, not just first run

export default function App() {
  // ThemeProvider has to be above the component that calls useTheme() —
  // AppInner is that component, App itself stays theme-agnostic. MyPicks
  // needs to sit above both PlaylistScreen and ProfileScreen so hearting a
  // track in either one updates the exact same shared state. Jigsaw sits
  // alongside it for the same reason — PlaylistScreen reads the block
  // order, Profile's Canvas screen edits it.
  return (
    <ThemeProvider>
      <MyPicksProvider>
        <JigsawProvider>
          <AppInner />
        </JigsawProvider>
      </MyPicksProvider>
    </ThemeProvider>
  );
}

function AppInner() {
  const { theme } = useTheme();
  const [traits, setTraits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  // top of the funnel — fires once per app launch, not per screen
  useEffect(() => { track("app_open"); }, []);

  // on launch, restore a saved personality profile if one exists
  useEffect(() => {
    AsyncStorage.getItem(PROFILE_KEY)
      .then((raw) => { if (raw) setTraits(JSON.parse(raw)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // keep the front page up for a minimum stretch even if the profile
  // restore resolves instantly, so it reads as a title card, not a flicker
  useEffect(() => {
    const t = setTimeout(() => setMinTimeElapsed(true), FRONT_PAGE_MIN_MS);
    return () => clearTimeout(t);
  }, []);

  const saveProfile = async (vector) => {
    setTraits(vector);
    try { await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(vector)); } catch {}
  };

  // Neutral (0.5) traits produce zero personality-driven shift in seedTarget's
  // formulas (e.g. (E-0.5)*20 == 0) — so skipping onboarding reuses the same
  // pipeline, just with mood/weather/time as the only signals that move it.
  const skipPersonality = () => saveProfile({ O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 });

  const recalibrate = async () => {
    setTraits(null);
    setProfileOpen(false);
    try { await AsyncStorage.removeItem(PROFILE_KEY); } catch {}
  };

  if (loading || !minTimeElapsed) {
    return (
      // GestureHandlerRootView must wrap the whole app (not just the screen
      // that uses gestures) - it's required infrastructure for gesture-handler
      // to work at all, per its own setup docs, not something scoped per-screen
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
          <StatusBar style="light" />
          <FrontPage />
        </SafeAreaView>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
        <StatusBar style="light" />
        {traits ? (
          <View style={{ flex: 1 }}>
            <View style={styles.top}>
              <Text style={[styles.wordmark, { color: theme.accent }]}>CADENCE</Text>
              <Pressable onPress={() => setProfileOpen(true)}>
                <Text style={styles.profileLink}>Profile</Text>
              </Pressable>
            </View>
            <PlaylistScreen traits={traits} />
            <ProfileScreen
              visible={profileOpen}
              traits={traits}
              onClose={() => setProfileOpen(false)}
              onRecalibrate={recalibrate}
            />
          </View>
        ) : (
          <OnboardingScreen onComplete={saveProfile} onSkip={skipPersonality} />
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  // paddingHorizontal must match PlaylistScreen's root (22) so CADENCE lines
  // up with "PICK A MODE" and the activity chips directly below it
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 22, paddingTop: 14, paddingBottom: 12 },
  wordmark: { color: "#FFF", fontWeight: "900", letterSpacing: 5, fontSize: 14 },
  profileLink: { color: "#6E6E6E", fontSize: 12.5, fontWeight: "700" },
});
