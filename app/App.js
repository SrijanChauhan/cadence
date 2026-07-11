import React, { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, View, Text, Pressable } from "react-native";
import OnboardingScreen from "./src/OnboardingScreen";
import PlaylistScreen from "./src/PlaylistScreen";

export default function App() {
  const [traits, setTraits] = useState(null);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {traits ? (
        <View style={{ flex: 1 }}>
          <View style={styles.top}>
            <Text style={styles.wordmark}>CADENCE</Text>
            <Pressable onPress={() => setTraits(null)}>
              <Text style={styles.retake}>recalibrate</Text>
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
  safe: { flex: 1, backgroundColor: "#000" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 24, paddingTop: 14, paddingBottom: 12 },
  wordmark: { color: "#FFF", fontWeight: "900", letterSpacing: 5, fontSize: 14 },
  retake: { color: "#6E6E6E", fontSize: 12.5, fontWeight: "700" },
});
