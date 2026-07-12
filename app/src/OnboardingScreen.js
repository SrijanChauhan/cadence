import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View, Text, Pressable, StyleSheet, Animated, Easing, Dimensions,
} from "react-native";

/**
 * Cadence — Onboarding (Ball-surface edition)
 * The BACKGROUND is the translucent orange bouncy ball — gradient-ish
 * light falloff, sheen, freckled texture, and it visibly "gives" (squash)
 * wherever you touch, with a rubbery ripple. No separate ball props.
 * Text color is warm dark-on-orange for contrast, everything still bounces.
 * Questions flow async (shuffled, no hard page breaks). Ends in a
 * concoction swirl, no results shown, then silently hands off the vector.
 */

const { width: W, height: H } = Dimensions.get("window");

const BALL = "#FF8A2A";     // base ball color
const INK = "#2B1400";      // primary text — deep espresso, reads on orange
const INK_SOFT = "#6A3612"; // secondary text

const ESSENCE_COLORS = ["#FFF3E2", "#2B1400", "#FFFFFF", "#5C3013", "#FFD9A8"];

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

// ---------- the ball-surface background ----------

function makeBus() {
  const subs = new Map(); let n = 0;
  return {
    subscribe(fn) { subs.set(++n, fn); return n; },
    unsubscribe(id) { subs.delete(id); },
    emit(v) { subs.forEach((fn) => fn(v)); },
  };
}

/** freckle texture grid — computed once */
function useFreckles(count = 46) {
  return useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: (i * 137.5) % 100,               // golden-angle scatter, deterministic
    y: ((i * 71) % 100),
    r: 1.5 + ((i * 13) % 5),
    o: 0.05 + ((i * 7) % 10) / 100,
  })), [count]);
}

/** Whole-screen ball surface: sheen + texture + gives on touch (squash + ripple). */
function BallSurface({ bus, children }) {
  const squash = useRef(new Animated.Value(1)).current;
  const stretch = useRef(new Animated.Value(1)).current;
  const [ripples, setRipples] = useState([]);
  const freckles = useFreckles();

  useEffect(() => {
    const id = bus.subscribe(({ x, y }) => {
      // whole surface gives slightly — rubbery squash/stretch
      Animated.sequence([
        Animated.parallel([
          Animated.spring(squash, { toValue: 0.985, friction: 3.5, tension: 140, useNativeDriver: true }),
          Animated.spring(stretch, { toValue: 1.012, friction: 3.5, tension: 140, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.spring(squash, { toValue: 1, friction: 3, tension: 90, useNativeDriver: true }),
          Animated.spring(stretch, { toValue: 1, friction: 3, tension: 90, useNativeDriver: true }),
        ]),
      ]).start();

      // rubbery ripple ring from the touch point
      const rid = Date.now() + Math.random();
      const scale = new Animated.Value(0);
      const opacity = new Animated.Value(0.45);
      setRipples((rs) => [...rs, { id: rid, x, y, scale, opacity }]);
      Animated.parallel([
        Animated.timing(scale, { toValue: 1, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 650, useNativeDriver: true }),
      ]).start(() => setRipples((rs) => rs.filter((r) => r.id !== rid)));
    });
    return () => bus.unsubscribe(id);
  }, []);

  return (
    <Animated.View style={[s.surface, { transform: [{ scaleX: stretch }, { scaleY: squash }] }]}>
      {/* base ball tint */}
      <View style={s.baseTint} />
      {/* light falloff — brighter upper-left, darker lower-right, like a lit sphere */}
      <View style={s.lightTL} />
      <View style={s.shadeBR} />
      {/* big soft specular sheen */}
      <View style={s.sheen} />
      {/* freckle texture across the whole surface */}
      {freckles.map((f, i) => (
        <View key={i} style={{
          position: "absolute",
          left: `${f.x}%`, top: `${f.y}%`,
          width: f.r, height: f.r, borderRadius: f.r,
          backgroundColor: `rgba(43,20,0,${f.o})`,
        }} />
      ))}
      {/* touch ripples */}
      {ripples.map((r) => (
        <Animated.View key={r.id} pointerEvents="none" style={{
          position: "absolute", left: r.x - 90, top: r.y - 90, width: 180, height: 180, borderRadius: 90,
          borderWidth: 2, borderColor: "#FFF6EA",
          opacity: r.opacity,
          transform: [{ scale: r.scale.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.6] }) }],
        }} />
      ))}
      {children}
    </Animated.View>
  );
}

// ---------- bouncy text ----------

function BounceText({ children, style, delay = 0 }) {
  const scale = useRef(new Animated.Value(0.2)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 3.4, tension: 130, delay, useNativeDriver: true }).start();
  }, []);
  const poke = () => {
    scale.setValue(0.78);
    Animated.spring(scale, { toValue: 1, friction: 2.8, tension: 160, useNativeDriver: true }).start();
  };
  return (
    <Pressable onPress={poke}>
      <Animated.Text style={[style, { transform: [{ scale }] }]}>{children}</Animated.Text>
    </Pressable>
  );
}

// ---------- main flow ----------

export default function OnboardingScreen({ onComplete }) {
  const [phase, setPhase] = useState("intro");
  const [idx, setIdx] = useState(0);
  const answers = useRef({});
  const bus = useMemo(makeBus, []);
  const order = useMemo(() => [...ITEMS].sort(() => Math.random() - 0.5), []);

  const vector = () => {
    const sums = { O: 0, C: 0, E: 0, A: 0, N: 0 };
    order.forEach((it, i) => {
      const r = answers.current[i] ?? 3;
      sums[it.trait] += it.rev ? 6 - r : r;
    });
    const out = {};
    Object.keys(sums).forEach((k) => (out[k] = +(((sums[k] - 4) / 16)).toFixed(2)));
    return out;
  };

  const answer = (v) => {
    answers.current[idx] = v;
    if (idx < order.length - 1) setIdx(idx + 1);
    else setPhase("concoction");
  };

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => bus.emit({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
    >
      <BallSurface bus={bus}>
        {phase === "intro" && <Intro onStart={() => setPhase("quiz")} />}
        {phase === "quiz" && <Quiz item={order[idx]} idx={idx} total={order.length} onAnswer={answer} />}
        {phase === "concoction" && <Concoction onDone={() => onComplete(vector())} />}
      </BallSurface>
    </View>
  );
}

function Intro({ onStart }) {
  const btnScale = useRef(new Animated.Value(1)).current;
  const press = () => {
    Animated.sequence([
      Animated.spring(btnScale, { toValue: 0.85, friction: 3, tension: 200, useNativeDriver: true }),
      Animated.spring(btnScale, { toValue: 1, friction: 2.6, tension: 160, useNativeDriver: true }),
    ]).start(() => onStart());
  };
  return (
    <View style={s.centerFill}>
      <BounceText style={s.kicker} delay={100}>CADENCE</BounceText>
      <BounceText style={s.title} delay={220}>let's bounce{"\n"}to your beat.</BounceText>
      <BounceText style={s.sub} delay={380}>twenty tiny questions. touch the screen — it gives.</BounceText>
      <Animated.View style={{ transform: [{ scale: btnScale }], marginTop: 26 }}>
        <Pressable style={s.btn} onPress={press}>
          <Text style={s.btnText}>START</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function Quiz({ item, idx, total, onAnswer }) {
  const pressScales = useRef(LIKERT.map(() => new Animated.Value(1))).current;
  const pick = (i, v) => {
    Animated.sequence([
      Animated.spring(pressScales[i], { toValue: 0.85, friction: 3, tension: 220, useNativeDriver: true }),
      Animated.spring(pressScales[i], { toValue: 1, friction: 2.4, tension: 150, useNativeDriver: true }),
    ]).start();
    setTimeout(() => onAnswer(v), 140);
  };
  return (
    <View style={s.quizFill}>
      <BounceText style={s.counter} delay={0}>{`${idx + 1} · ${total}`}</BounceText>
      <BounceText key={idx} style={s.prompt} delay={60}>{item.t}</BounceText>
      <View style={{ marginTop: 20 }}>
        {LIKERT.map((o, i) => (
          <Animated.View key={o.v} style={{ transform: [{ scale: pressScales[i] }] }}>
            <Pressable style={s.opt} onPress={() => pick(i, o.v)}>
              <Text style={s.optLabel}>{o.label}</Text>
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

/** Five essence droplets swirl into one, then fade — no numbers shown. */
function Concoction({ onDone }) {
  const anims = useRef(ESSENCE_COLORS.map(() => new Animated.ValueXY({
    x: Math.random() * W * 0.6 + W * 0.1,
    y: Math.random() * H * 0.35 + H * 0.18,
  }))).current;
  const scales = useRef(ESSENCE_COLORS.map(() => new Animated.Value(1))).current;
  const bigScale = useRef(new Animated.Value(0)).current;
  const cx = W / 2 - 36, cy = H * 0.4;

  useEffect(() => {
    const orbit = (a, r, phase) =>
      Animated.timing(a, {
        toValue: { x: cx + Math.cos(phase) * r, y: cy + Math.sin(phase) * r },
        duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      });
    Animated.stagger(90, anims.map((a, i) => Animated.sequence([
      orbit(a, 110, i * 1.3),
      orbit(a, 60, i * 1.3 + 2),
      Animated.parallel([
        Animated.spring(a, { toValue: { x: cx, y: cy }, friction: 4, tension: 70, useNativeDriver: true }),
        Animated.timing(scales[i], { toValue: 0.2, duration: 500, delay: 250, useNativeDriver: true }),
      ]),
    ]))).start(() => {
      Animated.spring(bigScale, { toValue: 1, friction: 3, tension: 90, useNativeDriver: true }).start();
      setTimeout(onDone, 1200);
    });
  }, []);

  return (
    <View style={s.centerFill} pointerEvents="none">
      <BounceText style={s.mixLabel} delay={80}>mixing your blend…</BounceText>
      {ESSENCE_COLORS.map((c, i) => (
        <Animated.View key={i} style={{
          position: "absolute", width: 72, height: 72, borderRadius: 36,
          backgroundColor: c, opacity: 0.88,
          transform: [...anims[i].getTranslateTransform(), { scale: scales[i] }],
        }} />
      ))}
      <Animated.View style={{
        position: "absolute", left: cx - 34, top: cy - 34,
        width: 140, height: 140, borderRadius: 70,
        backgroundColor: "#FFF6EA", opacity: 0.92,
        transform: [{ scale: bigScale }],
      }} />
    </View>
  );
}

const s = StyleSheet.create({
  surface: { flex: 1, overflow: "hidden", backgroundColor: BALL },
  baseTint: { ...StyleSheet.absoluteFillObject, backgroundColor: BALL },
  lightTL: {
    position: "absolute", top: -W * 0.4, left: -W * 0.4,
    width: W * 1.3, height: W * 1.3, borderRadius: W * 0.65,
    backgroundColor: "#FFFFFF", opacity: 0.14,
  },
  shadeBR: {
    position: "absolute", bottom: -W * 0.5, right: -W * 0.5,
    width: W * 1.2, height: W * 1.2, borderRadius: W * 0.6,
    backgroundColor: "#3A1400", opacity: 0.16,
  },
  sheen: {
    position: "absolute", top: H * 0.04, left: -W * 0.15,
    width: W * 0.9, height: W * 0.5, borderRadius: W * 0.45,
    backgroundColor: "#FFFFFF", opacity: 0.08,
    transform: [{ rotate: "-18deg" }],
  },
  centerFill: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 28 },
  quizFill: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 26 },
  kicker: { color: INK, fontSize: 13, letterSpacing: 5, fontWeight: "900", marginBottom: 10, textAlign: "center" },
  title: { color: INK, fontSize: 40, fontWeight: "900", lineHeight: 46, letterSpacing: -1, textAlign: "center" },
  sub: { color: INK_SOFT, fontSize: 15, lineHeight: 21, marginTop: 14, fontWeight: "700", textAlign: "center" },
  btn: { backgroundColor: INK, borderRadius: 999, paddingVertical: 17, alignItems: "center", width: W * 0.7 },
  btnText: { color: "#FFE9D2", fontSize: 16, fontWeight: "900", letterSpacing: 2 },
  counter: { color: INK, fontSize: 15, fontWeight: "900", letterSpacing: 2, marginBottom: 10, textAlign: "center" },
  prompt: { color: INK, fontSize: 27, fontWeight: "800", lineHeight: 34, minHeight: 70, textAlign: "center" },
  opt: { borderRadius: 999, borderWidth: 1.5, borderColor: "#2B140033", backgroundColor: "#FFF6EA55", paddingVertical: 14, paddingHorizontal: 22, marginBottom: 9, alignItems: "center", width: W * 0.78 },
  optLabel: { color: INK, fontSize: 15, fontWeight: "700", textAlign: "center" },
  mixLabel: { color: INK, fontSize: 16, fontWeight: "800", textAlign: "center", position: "absolute", top: H * 0.16, alignSelf: "center" },
});
