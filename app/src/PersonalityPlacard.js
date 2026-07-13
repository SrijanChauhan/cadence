import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { BlobLayer, moodColor, HELVETICA, HELVETICA_BOLD } from "./SessionBanner";
import { personalityType } from "./personalityType";

/**
 * Cadence — personality placard for the Profile screen.
 *
 * Deliberately reuses the exact same art engine as the session/mood banner
 * (BlobLayer + moodColor, imported from SessionBanner.js) rather than a new
 * visual system, so "a placard similar to my mood" is literally true — same
 * rendering, different inputs.
 *
 * There's no canonical trait->color mapping (unlike mood's circumplex model,
 * which at least has research behind the axes), so this is a deliberately
 * simple, explainable heuristic, not a scientific claim:
 *   warm/cool axis  <- Extraversion + Agreeableness (social, warm traits)
 *   vivid/muted axis <- Openness + Conscientiousness, damped by Neuroticism
 *                       (driven + open + emotionally steady reads as more
 *                       vivid/energetic on the card; the inverse reads muted)
 */
function traitsToPoint(traits) {
  if (!traits) return { valence: 0, arousal: 0 };
  const clamp = (x) => Math.max(-1, Math.min(1, x));
  const valence = clamp((traits.E - 0.5) + (traits.A - 0.5));
  const arousal = clamp(((traits.O - 0.5) + (traits.C - 0.5) + (0.5 - traits.N)) / 1.5);
  return { valence, arousal };
}

export default function PersonalityPlacard({ traits }) {
  const { valence, arousal } = traitsToPoint(traits);
  const baseColor = moodColor(valence, arousal);
  const seedKey = `personality|${traits ? [traits.O, traits.C, traits.E, traits.A, traits.N].join(",") : "none"}`;

  return (
    <View style={[s.card, { backgroundColor: baseColor }]}>
      <BlobLayer valence={valence} arousal={arousal} condition={null} localHour={null} seedKey={seedKey} />
      <View style={s.scrim}>
        <Text style={s.kicker}>YOUR TYPE</Text>
        <Text style={s.typeText}>{personalityType(traits)}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { height: 160, borderRadius: 20, overflow: "hidden", position: "relative", marginBottom: 18 },
  scrim: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16,
  },
  kicker: { color: "#E8E8E8", fontSize: 11, letterSpacing: 3, fontWeight: "800", fontFamily: HELVETICA, marginBottom: 4 },
  typeText: { color: "#FFFFFF", fontSize: 26, fontWeight: "900", fontFamily: HELVETICA_BOLD, letterSpacing: -0.5 },
});
