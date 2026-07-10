import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing, Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";

/**
 * Cadence — Onboarding personality assessment (React Native / Expo)
 * Instrument: Mini-IPIP (Donnellan et al., 2006). IPIP items are public domain.
 * Output: normalized OCEAN vector (0–1) that seeds the recommendation prior.
 */

const TRAITS = [
  { key: "O", name: "Openness", sub: "imagination · variety", color: "#F0714F" },
  { key: "C", name: "Conscientiousness", sub: "order · follow-through", color: "#F0A24F" },
  { key: "E", name: "Extraversion", sub: "energy · sociability", color: "#E8C84A" },
  { key: "A", name: "Agreeableness", sub: "warmth · cooperation", color: "#58C08C" },
  { key: "N", name: "Neuroticism", sub: "emotional sensitivity", color: "#5A93D4" },
];

const ITEMS = [
  { t: "I am the life of the party.", trait: "E", rev: false },
  { t: "I sympathize with others' feelings.", trait: "A", rev: false },
  { t: "I get chores done right away.", trait: "C", rev: false },
  { t: "I have frequent mood swings.", trait: "N", rev: false },
  { t: "I have a vivid imagination.", trait: "O", rev: false },
  { t: "I don't talk a lot.", trait: "E", rev: true },
  { t: "I am not interested in other people's problems.", trait: "A", rev: true },
  { t: "I often forget to put things back in their proper place.", trait: "C", rev: true },
  { t: "I am relaxed most of the time.", trait: "N", rev: true },
  { t: "I am not interested in abstract ideas.", trait: "O", rev: true },
  { t: "I talk to a lot of different people at parties.", trait: "E", rev: false },
  { t: "I feel others' emotions.", trait: "A", rev: false },
  { t: "I like order.", trait: "C", rev: false },
  { t: "I get upset easily.", trait: "N", rev: false },
  { t: "I have difficulty understanding abstract ideas.", trait: "O", rev: true },
  { t: "I keep in the background.", trait: "E", rev: true },
  { t: "I am not really interested in others.", trait: "A", rev: true },
  { t: "I make a mess of things.", trait: "C", rev: true },
  { t: "I seldom feel blue.", trait: "N", rev: true },
  { t: "I do not have a good imagination.", trait: "O", rev: true },
];

const LIKERT = [
  { v: 1, label: "Strongly disagree" },
  { v: 2, label: "Disagree" },
  { v: 3, label: "Neutral" },
  { v: 4, label: "Agree" },
  { v: 5, label: "Strongly agree" },
];

const DESC = {
  O: { hi: "Drawn to novelty, texture, the unfamiliar.", mid: "Open to new sounds, anchored by favorites.", lo: "Prefers the familiar and the proven." },
  C: { hi: "Structured; likes order and clean momentum.", mid: "Balances routine with room to drift.", lo: "Spontaneous; goes where the moment leads." },
  E: { hi: "Energized by people and forward motion.", mid: "Comfortable in company or solitude.", lo: "Recharges in quieter, low-key settings." },
  A: { hi: "Tuned into others; warm and cooperative.", mid: "Considerate, with a mind of your own.", lo: "Direct, skeptical, independent-minded." },
  N: { hi: "Feels things intensely; moods shift.", mid: "Steady, with the occasional swing.", lo: "Even-keeled and hard to rattle." },
};

const bucket = (p) => (p >= 60 ? "hi" : p <= 40 ? "lo" : "mid");

export default function OnboardingScreen() {
  const [screen, setScreen] = useState("intro");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState(Array(ITEMS.length).fill(null));

  const answer = (v) => {
    const next = [...answers];
    next[idx] = v;
    setAnswers(next);
    setTimeout(() => {
      if (idx < ITEMS.length - 1) setIdx(idx + 1);
      else setScreen("results");
    }, 160);
  };

  const scores = () => {
    const sums = { O: 0, C: 0, E: 0, A: 0, N: 0 };
    ITEMS.forEach((it, i) => {
      const r = answers[i] ?? 3;
      sums[it.trait] += it.rev ? 6 - r : r;
    });
    const out = {};
    Object.keys(sums).forEach((k) => (out[k] = Math.round(((sums[k] - 4) / 16) * 100)));
    return out;
  };

  const restart = () => { setAnswers(Array(ITEMS.length).fill(null)); setIdx(0); setScreen("intro"); };

  return (
    <View style={s.root}>
      <View style={s.top}>
        <Text style={s.wordmark}>CADENCE</Text>
        <Text style={s.tag}>ONBOARDING · CALIBRATION</Text>
      </View>
      {screen === "intro" && <Intro onStart={() => setScreen("quiz")} />}
      {screen === "quiz" && (
        <Quiz idx={idx} answers={answers} onAnswer={answer} onBack={() => idx > 0 && setIdx(idx - 1)} />
      )}
      {screen === "results" && <Results data={scores()} onRestart={restart} />}
    </View>
  );
}

function Intro({ onStart }) {
  return (
    <View style={s.panel}>
      <Text style={s.eyebrow}>STEP 1 OF ONBOARDING</Text>
      <Text style={s.h1}>Let's tune to your signal.</Text>
      <Text style={s.lede}>
        Twenty quick reactions — about two minutes. There are no right answers; the aim is a starting
        read on how you're wired, which seeds your first playlists before we've heard a single skip.
      </Text>
      <View style={s.metaRow}>
        <Meta n="20" l="PROMPTS" />
        <Meta n="~2" l="MINUTES" />
        <Meta n="5" l="CHANNELS" />
      </View>
      <Pressable style={s.btn} onPress={onStart}>
        <Text style={s.btnText}>Begin calibration</Text>
      </Pressable>
      <Text style={s.fineprint}>Based on the Mini-IPIP, a validated public-domain Big Five inventory.</Text>
    </View>
  );
}

const Meta = ({ n, l }) => (
  <View style={s.meta}>
    <Text style={s.metaN}>{n}</Text>
    <Text style={s.metaL}>{l}</Text>
  </View>
);

function Quiz({ idx, answers, onAnswer, onBack }) {
  const item = ITEMS[idx];
  const pct = (idx / ITEMS.length) * 100;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [idx]);

  return (
    <View style={s.panel}>
      <View style={s.progressWrap}>
        <View style={s.progressTrack}><View style={[s.progressFill, { width: `${pct}%` }]} /></View>
        <Text style={s.progressNum}>{idx + 1} / {ITEMS.length}</Text>
      </View>
      <Text style={s.eyebrow}>THIS STATEMENT DESCRIBES ME:</Text>
      <Animated.Text style={[s.prompt, { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
        {item.t}
      </Animated.Text>
      <View>
        {LIKERT.map((o) => {
          const active = answers[idx] === o.v;
          return (
            <Pressable key={o.v} style={[s.opt, active && s.optActive]} onPress={() => onAnswer(o.v)}>
              <View style={[s.optDot, active && s.optDotActive]} />
              <Text style={s.optLabel}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.nav}>
        <Pressable onPress={onBack} disabled={idx === 0}>
          <Text style={[s.ghost, idx === 0 && s.ghostDisabled]}>← Back</Text>
        </Pressable>
        <Text style={s.navHint}>Tap a response to continue</Text>
      </View>
    </View>
  );
}

function Results({ data, onRestart }) {
  const anims = useRef(TRAITS.map(() => new Animated.Value(0))).current;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    Animated.stagger(90, TRAITS.map((t, i) =>
      Animated.timing(anims[i], { toValue: data[t.key], duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false })
    )).start();
  }, []);

  const vector = TRAITS.reduce((a, t) => ({ ...a, [t.key]: +(data[t.key] / 100).toFixed(2) }), {});
  const copy = async () => { await Clipboard.setStringAsync(JSON.stringify(vector)); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  return (
    <ScrollView style={s.panelScroll} contentContainerStyle={s.panel} showsVerticalScrollIndicator={false}>
      <Text style={s.eyebrow}>YOUR CALIBRATION</Text>
      <Text style={s.h1}>Five channels, set.</Text>
      <Text style={[s.lede, { marginBottom: 20 }]}>This is the equalizer we'll start from. It shifts as you listen.</Text>

      <View style={s.eq}>
        {TRAITS.map((t, i) => (
          <View style={s.eqBand} key={t.key}>
            <Text style={[s.eqScore, { color: t.color }]}>{data[t.key]}</Text>
            <View style={s.eqTrack}>
              <Animated.View style={[s.eqFill, { backgroundColor: t.color, height: anims[i].interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }]} />
            </View>
            <Text style={[s.eqKey, { color: t.color }]}>{t.key}</Text>
          </View>
        ))}
      </View>

      <View style={{ marginTop: 8 }}>
        {TRAITS.map((t) => (
          <View style={s.readRow} key={t.key}>
            <View style={[s.readDot, { backgroundColor: t.color }]} />
            <View style={s.readText}>
              <Text style={s.readName}>{t.name} <Text style={s.readSub}>{t.sub.toUpperCase()}</Text></Text>
              <Text style={s.readDesc}>{DESC[t.key][bucket(data[t.key])]}</Text>
            </View>
            <Text style={s.readPct}>{data[t.key]}</Text>
          </View>
        ))}
      </View>

      <View style={s.vector}>
        <View style={s.vectorHead}>
          <Text style={s.eyebrow}>TRAIT VECTOR → SEED</Text>
          <Pressable style={s.copyBtn} onPress={copy}><Text style={s.copyText}>{copied ? "Copied" : "Copy JSON"}</Text></Pressable>
        </View>
        <Text style={s.vectorCode}>{JSON.stringify(vector)}</Text>
      </View>

      <Pressable onPress={onRestart} style={{ marginTop: 22, alignSelf: "center" }}>
        <Text style={s.ghost}>Retake calibration</Text>
      </Pressable>
    </ScrollView>
  );
}

const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d16", paddingHorizontal: 18, paddingTop: 12 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18, paddingHorizontal: 4 },
  wordmark: { color: "#ECECF2", fontWeight: "800", letterSpacing: 3, fontSize: 13 },
  tag: { color: "#8A8A9A", fontSize: 9, letterSpacing: 1.5 },
  panelScroll: { flex: 1 },
  panel: { backgroundColor: "#15151f", borderColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderRadius: 18, padding: 24 },
  eyebrow: { color: "#F0A24F", fontSize: 10, letterSpacing: 2, fontWeight: "700", marginBottom: 12 },
  h1: { color: "#ECECF2", fontSize: 27, fontWeight: "700", marginBottom: 12, letterSpacing: -0.3 },
  lede: { color: "#C4C4D0", fontSize: 15, lineHeight: 22, marginBottom: 22 },
  metaRow: { flexDirection: "row", gap: 26, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.08)", paddingVertical: 16, marginBottom: 22 },
  meta: { gap: 3 },
  metaN: { color: "#ECECF2", fontSize: 22, fontWeight: "700" },
  metaL: { color: "#8A8A9A", fontSize: 10, letterSpacing: 1.2 },
  btn: { backgroundColor: "#F0A24F", borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  btnText: { color: "#1a1200", fontSize: 15, fontWeight: "700" },
  fineprint: { color: "#8A8A9A", fontSize: 11.5, textAlign: "center", marginTop: 16 },

  progressWrap: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 },
  progressTrack: { flex: 1, height: 3, backgroundColor: "rgba(255,255,255,0.09)", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 3, backgroundColor: "#F0A24F", borderRadius: 3 },
  progressNum: { color: "#8A8A9A", fontSize: 11 },
  prompt: { color: "#ECECF2", fontSize: 23, fontWeight: "600", lineHeight: 29, marginBottom: 24, minHeight: 60 },
  opt: { flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderRadius: 11, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 9 },
  optActive: { borderColor: "#F0A24F", backgroundColor: "rgba(240,162,79,0.12)" },
  optDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: "#8A8A9A" },
  optDotActive: { borderColor: "#F0A24F", backgroundColor: "#F0A24F" },
  optLabel: { color: "#ECECF2", fontSize: 14.5 },
  nav: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 20 },
  ghost: { color: "#8A8A9A", fontSize: 13 },
  ghostDisabled: { opacity: 0.3 },
  navHint: { color: "#8A8A9A", fontSize: 11 },

  eq: { flexDirection: "row", justifyContent: "center", alignItems: "flex-end", height: 180, gap: 14, paddingTop: 16, marginBottom: 20, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  eqBand: { alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 8 },
  eqScore: { fontSize: 13, fontWeight: "700" },
  eqTrack: { width: 26, flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 6, justifyContent: "flex-end", overflow: "hidden" },
  eqFill: { width: "100%", borderRadius: 6, minHeight: 6 },
  eqKey: { fontSize: 14, fontWeight: "800" },

  readRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  readDot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  readText: { flex: 1, gap: 3 },
  readName: { color: "#ECECF2", fontSize: 14, fontWeight: "600" },
  readSub: { color: "#8A8A9A", fontSize: 10, letterSpacing: 1 },
  readDesc: { color: "#B4B4C2", fontSize: 13, lineHeight: 18 },
  readPct: { color: "#8A8A9A", fontSize: 15, fontWeight: "700" },

  vector: { marginTop: 20, backgroundColor: "rgba(0,0,0,0.25)", borderColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderRadius: 12, padding: 14 },
  vectorHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  copyBtn: { borderColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderRadius: 7, paddingVertical: 5, paddingHorizontal: 11 },
  copyText: { color: "#ECECF2", fontSize: 11 },
  vectorCode: { color: "#9FD9B4", fontFamily: mono, fontSize: 12.5, lineHeight: 19 },
});
