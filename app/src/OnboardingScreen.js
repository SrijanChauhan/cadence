import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing, Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "./theme";

/**
 * Cadence — Onboarding (Bounce edition)
 * Visual language: black / volt / huge rounded 900-weight numerals /
 * spring-bounce on the numbers. Scoring logic is Mini-IPIP's, but each test
 * taker only sees 10 of its 20 items (see pickQuizItems) — one regular and
 * one reverse-scored item per trait, randomly chosen and randomly ordered.
 */

const TRAITS = [
  { key: "O", name: "Openness", sub: "imagination · variety" },
  { key: "C", name: "Conscientiousness", sub: "order · follow-through" },
  { key: "E", name: "Extraversion", sub: "energy · sociability" },
  { key: "A", name: "Agreeableness", sub: "warmth · cooperation" },
  { key: "N", name: "Neuroticism", sub: "emotional sensitivity" },
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

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Randomized per test-taker: for each trait, pick one random regular item and
// one random reverse-scored item (there are 2 of each per trait in ITEMS, so
// which pair gets used varies test to test, not just their order), then
// shuffle the resulting 10 across traits so the trait order isn't fixed either.
function pickQuizItems() {
  const traits = ["O", "C", "E", "A", "N"];
  const picked = traits.flatMap((trait) => {
    const forTrait = ITEMS.filter((it) => it.trait === trait);
    const regular = shuffle(forTrait.filter((it) => !it.rev))[0];
    const reverse = shuffle(forTrait.filter((it) => it.rev))[0];
    return [regular, reverse];
  });
  return shuffle(picked);
}

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

/** A number that bounces in with spring physics whenever its value changes. */
function BounceNumber({ value, style }) {
  const scale = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    scale.setValue(0.3);
    Animated.spring(scale, { toValue: 1, friction: 3.2, tension: 140, useNativeDriver: true }).start();
  }, [value]);
  return (
    <Animated.Text style={[style, { transform: [{ scale }] }]}>{value}</Animated.Text>
  );
}

export default function OnboardingScreen({ onComplete, onSkip }) {
  const { theme } = useTheme();
  const s = useMemo(() => buildStyles(theme.accent, theme.bg, theme.surface, theme.border), [theme]);
  const [screen, setScreen] = useState("intro");
  const [idx, setIdx] = useState(0);
  const [quizItems, setQuizItems] = useState(pickQuizItems);
  const [answers, setAnswers] = useState(Array(quizItems.length).fill(null));
  // tracks the pending auto-advance timeout so Back can cancel it — without
  // this, tapping Back right after answering got silently overridden a
  // moment later when the stale timeout fired and forced idx forward again
  const advanceTimeout = useRef(null);

  useEffect(() => () => clearTimeout(advanceTimeout.current), []);

  const answer = (v) => {
    const next = [...answers];
    next[idx] = v;
    setAnswers(next);
    clearTimeout(advanceTimeout.current);
    const atIdx = idx;
    advanceTimeout.current = setTimeout(() => {
      if (atIdx < quizItems.length - 1) setIdx(atIdx + 1);
      else setScreen("results");
    }, 150);
  };

  const back = () => {
    clearTimeout(advanceTimeout.current);
    setIdx((i) => Math.max(0, i - 1));
  };

  const scores = () => {
    const sums = { O: 0, C: 0, E: 0, A: 0, N: 0 };
    quizItems.forEach((it, i) => {
      const r = answers[i] ?? 3;
      sums[it.trait] += it.rev ? 6 - r : r;
    });
    const out = {};
    Object.keys(sums).forEach((k) => (out[k] = Math.round(((sums[k] - 4) / 16) * 100)));
    return out;
  };

  const restart = () => {
    clearTimeout(advanceTimeout.current);
    const fresh = pickQuizItems();
    setQuizItems(fresh);
    setAnswers(Array(fresh.length).fill(null));
    setIdx(0);
    setScreen("intro");
  };

  return (
    <View style={s.root}>
      {screen === "intro" && <Intro s={s} onStart={() => setScreen("quiz")} onSkip={onSkip} />}
      {screen === "quiz" && (
        <Quiz s={s} idx={idx} items={quizItems} answers={answers} onAnswer={answer} onBack={back} />
      )}
      {screen === "results" && <Results s={s} data={scores()} onRestart={restart} onComplete={onComplete} />}
    </View>
  );
}

function Intro({ s, onStart, onSkip }) {
  return (
    <View style={s.introRoot}>
      <View style={s.center}>
        <Text style={s.kicker}>CADENCE</Text>
        <BounceNumber value="1:00" style={s.mega} />
        <Text style={s.megaLabel}>ten prompts. one minute.{"\n"}zero right answers.</Text>
        <Text style={s.introBody}>
          A quick read on how you're wired — it seeds your first playlists before we've heard a single skip.
        </Text>
        <Pressable style={s.voltBtn} onPress={onStart}>
          <Text style={s.voltBtnText}>START</Text>
        </Pressable>
        <Text style={s.fineprint}>Big Five short form · randomized each time</Text>
      </View>
      {onSkip && (
        <Pressable style={s.skipBtn} onPress={onSkip} hitSlop={12}>
          <Text style={s.skipBtnText}>Skip</Text>
        </Pressable>
      )}
    </View>
  );
}

function Quiz({ s, idx, items, answers, onAnswer, onBack }) {
  const item = items[idx];
  return (
    <View style={s.quizWrap}>
      <View style={s.counterRow}>
        <BounceNumber value={String(idx + 1).padStart(2, "0")} style={s.counter} />
        <Text style={s.counterTotal}>/ {items.length}</Text>
      </View>

      <Text style={s.prompt}>{item.t}</Text>

      <View style={s.likertWrap}>
        {LIKERT.map((o) => {
          const active = answers[idx] === o.v;
          return (
            <Pressable key={o.v} style={[s.opt, active && s.optActive]} onPress={() => onAnswer(o.v)}>
              <Text style={[s.optLabel, active && s.optLabelActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={onBack} disabled={idx === 0} style={s.backBtn} hitSlop={12}>
        <Text style={[s.back, idx === 0 && s.backDisabled]}>← Back</Text>
      </Pressable>
    </View>
  );
}

function Results({ s, data, onRestart, onComplete }) {
  const anims = useRef(TRAITS.map(() => new Animated.Value(0))).current;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    Animated.stagger(80, TRAITS.map((t, i) =>
      Animated.spring(anims[i], { toValue: data[t.key], friction: 5, tension: 60, useNativeDriver: false })
    )).start();
  }, []);

  const vector = TRAITS.reduce((a, t) => ({ ...a, [t.key]: +(data[t.key] / 100).toFixed(2) }), {});
  const copy = async () => { await Clipboard.setStringAsync(JSON.stringify(vector)); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.resultsWrap} showsVerticalScrollIndicator={false}>
      <Text style={s.kicker}>YOUR FIVE</Text>

      <View style={s.eq}>
        {TRAITS.map((t, i) => (
          <View style={s.eqBand} key={t.key}>
            <BounceNumber value={data[t.key]} style={s.eqScore} />
            <View style={s.eqTrack}>
              <Animated.View style={[s.eqFill, { height: anims[i].interpolate({ inputRange: [0, 100], outputRange: ["4%", "100%"] }) }]} />
            </View>
            <Text style={s.eqKey}>{t.key}</Text>
          </View>
        ))}
      </View>

      <View style={{ marginTop: 26 }}>
        {TRAITS.map((t) => (
          <View style={s.readRow} key={t.key}>
            <Text style={s.readKey}>{t.key}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.readName}>{t.name}</Text>
              <Text style={s.readDesc}>{DESC[t.key][bucket(data[t.key])]}</Text>
            </View>
            <Text style={s.readPct}>{data[t.key]}</Text>
          </View>
        ))}
      </View>

      {onComplete && (
        <Pressable style={s.voltBtn} onPress={() => onComplete(vector)}>
          <Text style={s.voltBtnText}>BUILD MY PLAYLISTS</Text>
        </Pressable>
      )}

      <View style={s.rowSplit}>
        <Pressable onPress={copy}><Text style={s.back}>{copied ? "Copied" : "Copy Vector JSON"}</Text></Pressable>
        <Pressable onPress={onRestart}><Text style={s.back}>Retake</Text></Pressable>
      </View>
    </ScrollView>
  );
}

const rounded = Platform.select({ ios: "System", android: "sans-serif-black", default: "System" });

const buildStyles = (VOLT, BG, SURFACE, BORDER) => StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  // Intro's own column: the centered content block takes all remaining
  // space (flex:1), which naturally pushes skipBtn as its sibling down to
  // the true bottom of the page, rather than skip just trailing the content.
  introRoot: { flex: 1, paddingHorizontal: 26, paddingBottom: 20 },
  center: { flex: 1, justifyContent: "center" },
  kicker: { color: "#6E6E6E", fontSize: 12, letterSpacing: 4, fontWeight: "800", marginBottom: 10 },

  mega: { color: VOLT, fontSize: 108, fontWeight: "900", fontFamily: rounded, letterSpacing: -4, lineHeight: 112 },
  megaLabel: { color: "#FFF", fontSize: 22, fontWeight: "800", lineHeight: 28, marginTop: 6, marginBottom: 14 },
  introBody: { color: "#9A9A9A", fontSize: 15, lineHeight: 22, marginBottom: 30 },

  voltBtn: { backgroundColor: VOLT, borderRadius: 999, paddingVertical: 18, alignItems: "center", marginTop: 10 },
  voltBtnText: { color: "#000", fontSize: 16, fontWeight: "900", letterSpacing: 2 },
  fineprint: { color: "#5A5A5A", fontSize: 11.5, textAlign: "center", marginTop: 16 },
  skipBtn: { alignItems: "center", paddingVertical: 10 },
  skipBtnText: { color: "#6E6E6E", fontSize: 13, fontWeight: "700" },

  quizWrap: { flex: 1, paddingHorizontal: 26, paddingTop: 18 },
  counterRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 8 },
  counter: { color: VOLT, fontSize: 84, fontWeight: "900", fontFamily: rounded, letterSpacing: -3 },
  counterTotal: { color: "#4A4A4A", fontSize: 22, fontWeight: "900" },
  prompt: { color: "#FFF", fontSize: 26, fontWeight: "800", lineHeight: 33, marginBottom: 28, minHeight: 66 },

  likertWrap: { gap: 10 },
  opt: { borderRadius: 999, borderWidth: 2, borderColor: BORDER, paddingVertical: 15, paddingHorizontal: 22, backgroundColor: SURFACE },
  optActive: { backgroundColor: VOLT, borderColor: VOLT },
  optLabel: { color: "#DADADA", fontSize: 15, fontWeight: "700" },
  optLabelActive: { color: "#000" },
  backBtn: { marginTop: 22, alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 4 },
  back: { color: "#6E6E6E", fontSize: 13, fontWeight: "700" },
  backDisabled: { opacity: 0.3 },

  resultsWrap: { paddingHorizontal: 26, paddingTop: 16, paddingBottom: 46 },
  eq: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", height: 220, paddingTop: 12 },
  eqBand: { alignItems: "center", justifyContent: "flex-end", height: "100%", flex: 1 },
  eqScore: { color: VOLT, fontSize: 24, fontWeight: "900", fontFamily: rounded, marginBottom: 6 },
  eqTrack: { width: 34, flex: 1, backgroundColor: SURFACE, borderRadius: 17, justifyContent: "flex-end", overflow: "hidden" },
  eqFill: { width: "100%", borderRadius: 17, backgroundColor: VOLT, minHeight: 8 },
  eqKey: { color: "#FFF", fontSize: 16, fontWeight: "900", marginTop: 8 },

  readRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, borderBottomWidth: 1, borderColor: "#161616" },
  readKey: { color: VOLT, fontSize: 20, fontWeight: "900", width: 26 },
  readName: { color: "#FFF", fontSize: 14.5, fontWeight: "800" },
  readDesc: { color: "#8A8A8A", fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  readPct: { color: "#FFF", fontSize: 18, fontWeight: "900" },

  rowSplit: { flexDirection: "row", justifyContent: "space-between", marginTop: 22 },
});
