import React, { forwardRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { BlobLayer, moodColor, HELVETICA, HELVETICA_BOLD } from "./SessionBanner";

/**
 * Cadence — square cover-art composition, dedicated to the Spotify upload.
 *
 * SessionBanner (the on-screen element) is a wide rectangle sized for the
 * track list, not a square — uploading a screenshot of it as-is would get
 * cropped/letterboxed by Spotify, which expects a square cover. This is a
 * SEPARATE square (1:1) layout reusing the same art generation (BlobLayer,
 * moodColor) so the cover visually matches the in-app banner, but with its
 * own composition: art fills the whole square, a bottom scrim holds the
 * mood label + full date/time/weather/place readout, all in one frame.
 *
 * Rendered off-screen (see PlaylistScreen.js) purely for react-native-view-
 * shot to capture — never shown in the visible UI. SIZE is fixed at 480x480
 * points rather than flex-sized: captureRef's output resolution comes from
 * the view's actual laid-out size x device pixel ratio, so a small/flexible
 * container would capture small and look pixelated once Spotify displays it
 * at typical playlist-cover sizes. 480pt at a common 3x pixel ratio captures
 * at 1440x1440px, sharp at any size Spotify renders it, while still
 * comfortably compressing under the 256KB upload limit since the content
 * is mostly flat color fields, not photographic detail.
 */
const CoverArt = forwardRef(function CoverArt({ mood, weather, activityLabel, place }, ref) {
  const seedKey = `${mood?.label || "Neutral"}|${weather?.condition || ""}|${activityLabel || ""}`;
  const baseColor = moodColor(mood?.valence ?? 0, mood?.arousal ?? 0);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const weatherStr = weather?.tempC != null ? `${Math.round(weather.tempC)}°C, ${weather.condition}` : null;

  return (
    <View ref={ref} style={[s.square, { backgroundColor: baseColor }]}>
      <BlobLayer
        valence={mood?.valence ?? 0}
        arousal={mood?.arousal ?? 0}
        condition={weather?.condition}
        localHour={weather?.localHour}
        seedKey={seedKey}
      />
      <View style={s.scrim}>
        <Text style={s.moodLabel}>{(mood?.label || "Neutral").toUpperCase()}</Text>
        {activityLabel && <Text style={s.activityLabel}>{activityLabel}</Text>}
        <View style={s.detailBlock}>
          <Text style={s.detailLine}>{dateStr} · {timeStr}</Text>
          <Text style={s.detailLine} numberOfLines={1}>
            {weatherStr || "Weather unavailable"}{place ? ` · ${place}` : ""}
          </Text>
        </View>
      </View>
    </View>
  );
});

export default CoverArt;

const SIZE = 480;

const s = StyleSheet.create({
  square: { width: SIZE, height: SIZE, position: "relative", overflow: "hidden" },
  // bottom scrim: solid translucent black band so text stays legible over
  // any mood color/blob combination, full-width for consistent alignment
  scrim: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24,
  },
  moodLabel: { color: "#FFFFFF", fontSize: 26, fontFamily: HELVETICA_BOLD, fontWeight: "900", letterSpacing: 3 },
  activityLabel: { color: "#D6FF3D", fontSize: 14, fontFamily: HELVETICA_BOLD, fontWeight: "700", letterSpacing: 2, marginTop: 4, textTransform: "uppercase" },
  detailBlock: { marginTop: 12, gap: 4 },
  detailLine: { color: "#E8E8E8", fontSize: 14, fontFamily: HELVETICA, fontWeight: "500" },
});
