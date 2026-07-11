import React, { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, View, Text, Pressable } from "react-native";
import OnboardingScreen from "./src/OnboardingScreen";
import PlaylistScreen from "./src/PlaylistScreen";

export default function App() {
  const [traits, setTraits] = useState(null); // OCEAN vector from onboarding

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {traits ? (
        <View style={{ flex: 1 }}>
          <View style={styles.top}>
            <Text style={styles.wordmark}>CADENCE</Text>
            <Pressable onPress={() => setTraits(null)}>
              <Text style={styles.retake}>Recalibrate</Text>
            </Pressable>
          </View>
          <PlaylistScreen traits={traits} />
        </View>
      ) : (
        <OnboardingScreen onComplete={setTraits} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d16" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 22, paddingTop: 12, paddingBottom: 10 },
  wordmark: { color: "#ECECF2", fontWeight: "800", letterSpacing: 3, fontSize: 13 },
  retake: { color: "#8A8A9A", fontSize: 12 },
});
