import React, { useState, useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, View, Text, Pressable, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import OnboardingScreen from "./src/OnboardingScreen";
import PlaylistScreen from "./src/PlaylistScreen";

const PROFILE_KEY = "cadence:profile"; // saved OCEAN vector

export default function App() {
  const [traits, setTraits] = useState(null);
  const [loading, setLoading] = useState(true);

  // on launch, restore a saved personality profile if one exists
  useEffect(() => {
    AsyncStorage.getItem(PROFILE_KEY)
      .then((raw) => { if (raw) setTraits(JSON.parse(raw)); })
      .catch(() => {})
      .finally(() => setLoading(false));
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
    try { await AsyncStorage.removeItem(PROFILE_KEY); } catch {}
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { justifyContent: "center", alignItems: "center" }]}>
        <StatusBar style="light" />
        <ActivityIndicator color="#D6FF3D" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {traits ? (
        <View style={{ flex: 1 }}>
          <View style={styles.top}>
            <Text style={styles.wordmark}>CADENCE</Text>
            <Pressable onPress={recalibrate}>
              <Text style={styles.retake}>recalibrate</Text>
            </Pressable>
          </View>
          <PlaylistScreen traits={traits} />
        </View>
      ) : (
        <OnboardingScreen onComplete={saveProfile} onSkip={skipPersonality} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 24, paddingTop: 14, paddingBottom: 12 },
  wordmark: { color: "#FFF", fontWeight: "900", letterSpacing: 5, fontSize: 14 },
  retake: { color: "#6E6E6E", fontSize: 12.5, fontWeight: "700" },
});
