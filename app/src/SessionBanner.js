import React, { forwardRef, useMemo, useRef, useEffect } from "react";
import { View, Text, StyleSheet, Animated, Platform } from "react-native";

/**
 * Cadence — session banner: a generated "mixture" of this playlist's inputs
 * (mood valence/arousal, weather, time of day) as an abstract art composition,
 * with a date/time/weather readout beneath it. Deliberately built from plain
 * Views/Animated only — no react-native-svg or expo-linear-gradient — this
 * project has already been burned twice by native-dependency/SDK mismatches
 * blocking Expo Go, and this needs zero new dependencies to render.
 *
 * Color mapping: hue from valence (cool/blue = low, warm/orange = high),
 * saturation+size from arousal (muted/small = calm, vivid/big = energized).
 * Blob layout is memoized per mood+weather+activity so it doesn't jitter on
 * re-render, but does vary session to session.
 */
const HELVETICA = Platform.select({ ios: "Helvetica", android: "sans-serif", default: "Helvetica" });
const HELVETICA_BOLD = Platform.select({ ios: "Helvetica-Bold", android: "sans-serif", default: "Helvetica-Bold" });

function moodColor(valence = 0, arousal = 0, jitter = 0) {
  const hue = 205 - ((valence + 1) / 2) * 165 + jitter; // -1 -> ~205 (blue), 1 -> ~40 (warm orange)
  const sat = 35 + ((arousal + 1) / 2) * 50; // calm = muted, energized = vivid
  const light = 42 + ((1 - (arousal + 1) / 2)) * 14; // slightly brighter when calmer
  return `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(light)}%)`;
}

// simple deterministic PRNG so the same session inputs always render the same
// composition (Math.random() inside a memo would still be fine across
// re-renders, but a seeded generator keeps it reproducible/debuggable)
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

function BlobLayer({ valence, arousal, condition, localHour, seedKey }) {
  const composition = useMemo(() => {
    const rand = seededRandom(hashString(seedKey) || 1);
    const blobCount = 3 + Math.round(((arousal + 1) / 2) * 3); // 3..6 blobs
    const blobs = Array.from({ length: blobCount }, (_, i) => ({
      id: i,
      left: `${Math.round(rand() * 80)}%`,
      top: `${Math.round(rand() * 70)}%`,
      size: 60 + Math.round(rand() * 70 * ((arousal + 1) / 2 + 0.4)),
      color: moodColor(valence, arousal, (rand() - 0.5) * 40),
      opacity: 0.35 + rand() * 0.35,
    }));

    // weather motif: small particle field for rain/snow, soft cloud ovals,
    // or a bright accent circle for clear skies
    const weatherBits = [];
    if (condition === "rain" || condition === "snow") {
      const n = 14;
      for (let i = 0; i < n; i++) {
        weatherBits.push({
          id: `w${i}`,
          left: `${Math.round(rand() * 96)}%`,
          top: `${Math.round(rand() * 90)}%`,
          size: condition === "snow" ? 4 : 2,
          height: condition === "snow" ? 4 : 14,
          color: condition === "snow" ? "#FFFFFF" : "#BFE4FF",
          opacity: 0.5 + rand() * 0.3,
        });
      }
    } else if (condition === "cloudy") {
      for (let i = 0; i < 2; i++) {
        weatherBits.push({
          id: `c${i}`,
          left: `${Math.round(rand() * 60)}%`,
          top: `${Math.round(rand() * 40)}%`,
          size: 90 + Math.round(rand() * 60),
          color: "#FFFFFF",
          opacity: 0.12,
        });
      }
    } else if (condition === "clear") {
      weatherBits.push({ id: "sun", left: "72%", top: "8%", size: 46, color: "#FFF4CC", opacity: 0.8 });
    }

    // time-of-day tint: darker late night/early morning, warm at golden hour
    let tint = null;
    if (localHour != null) {
      if (localHour >= 22 || localHour < 6) tint = { color: "#000018", opacity: 0.4 };
      else if ((localHour >= 6 && localHour < 8) || (localHour >= 17 && localHour < 19)) tint = { color: "#FF9A3D", opacity: 0.12 };
    }

    return { blobs, weatherBits, tint };
  }, [seedKey]);

  return (
    <>
      {composition.blobs.map((b) => (
        <View
          key={b.id}
          pointerEvents="none"
          style={{
            position: "absolute", left: b.left, top: b.top,
            width: b.size, height: b.size, borderRadius: b.size / 2,
            backgroundColor: b.color, opacity: b.opacity,
          }}
        />
      ))}
      {composition.weatherBits.map((w) => (
        <View
          key={w.id}
          pointerEvents="none"
          style={{
            position: "absolute", left: w.left, top: w.top,
            width: w.size, height: w.height ?? w.size, borderRadius: w.size / 2,
            backgroundColor: w.color, opacity: w.opacity,
          }}
        />
      ))}
      {composition.tint && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: composition.tint.color, opacity: composition.tint.opacity }]} />
      )}
    </>
  );
}

/**
 * Forwards a ref to the outer container so PlaylistScreen can capture it
 * with react-native-view-shot's captureRef and upload it as the Spotify
 * playlist's cover image — the cover then visually matches this banner.
 */
const SessionBanner = forwardRef(function SessionBanner({ mood, weather, activityLabel, place }, ref) {
  const fade = useRef(new Animated.Value(0)).current;
  const seedKey = `${mood?.label || "Neutral"}|${weather?.condition || ""}|${activityLabel || ""}`;

  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [seedKey]);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const weatherStr = weather?.tempC != null ? `${Math.round(weather.tempC)}°C, ${weather.condition}` : null;

  const baseColor = moodColor(mood?.valence ?? 0, mood?.arousal ?? 0);

  return (
    <Animated.View ref={ref} style={[s.root, { opacity: fade }]}>
      <View style={[s.art, { backgroundColor: baseColor }]}>
        <BlobLayer
          valence={mood?.valence ?? 0}
          arousal={mood?.arousal ?? 0}
          condition={weather?.condition}
          localHour={weather?.localHour}
          seedKey={seedKey}
        />
        <Text style={s.moodLabel}>{(mood?.label || "Neutral").toUpperCase()}</Text>
      </View>
      <View style={s.details}>
        <Text style={s.detailLine}>{dateStr} · {timeStr}</Text>
        <Text style={s.detailLine}>
          {weatherStr || "Weather unavailable"}{place ? ` · ${place}` : ""}
        </Text>
      </View>
    </Animated.View>
  );
});

export default SessionBanner;

const s = StyleSheet.create({
  root: { height: 210, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: "#242424", marginBottom: 18 },
  art: { flex: 2, position: "relative", justifyContent: "flex-end", padding: 14 },
  moodLabel: { color: "#FFFFFF", fontSize: 13, fontFamily: HELVETICA_BOLD, fontWeight: "900", letterSpacing: 3, textShadowColor: "rgba(0,0,0,0.4)", textShadowRadius: 6 },
  details: { flex: 1, backgroundColor: "#0A0A0A", justifyContent: "center", paddingHorizontal: 16, gap: 4 },
  detailLine: { color: "#B5B5B5", fontSize: 12.5, fontFamily: HELVETICA, fontWeight: "500" },
});
