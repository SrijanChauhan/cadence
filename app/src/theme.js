import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cadence — theme system.
 * "Bolt" is the original black/lime look, unchanged. The rest are hue +
 * true-complementary pairs (complementary = opposite point on the color
 * wheel). For those, the named hue IS the background (`bg`/`surface`, a
 * slightly lighter tone of the same hue for cards/tiles) and `accent2` is a
 * lighter tint of that same hue, used for the theme picker's second preview
 * dot — `accent` is the complementary color, used for text/highlights so it
 * reads against the background rather than competing with it.
 *
 * `bg`/`surface`/`border` are deliberately kept at the SAME hue and
 * saturation as `accent2` (just progressively darker), rather than an
 * independently muted pick — picking a separately "toned down" background
 * hue previously left it visibly duller/browner than the picker's preview
 * dots promised (e.g. Spider Man's red reading as maroon), which is a worse
 * trade than a slightly bolder background.
 *
 * `border` is a subtle outline tone tinted with the same hue as bg/surface —
 * chips, bubbles, and cards used a flat neutral grey border before, which on
 * Bolt's true black is unnoticeable but on a coloured background reads as a
 * mismatched leftover from a different theme. Bolt keeps its original
 * neutral grey since that's the one look that was already right.
 */
export const THEMES = {
  blackBolt: { id: "blackBolt", name: "Bolt", bg: "#000000", surface: "#0A0A0A", border: "#242424", accent: "#D6FF3D", accent2: "#D6FF3D" },
  pink:      { id: "pink",      name: "Pink",        bg: "#4F172A", surface: "#632137", border: "#7F3950", accent: "#8FBFA6", accent2: "#C98CA0" },
  cyan:      { id: "cyan",      name: "Cyan",         bg: "#174F49", surface: "#21635C", border: "#397F77", accent: "#E0966F", accent2: "#5FADA4" },
  purple:    { id: "purple",    name: "Purple",       bg: "#2C174F", surface: "#3A2163", border: "#53397F", accent: "#C7A855", accent2: "#9C87BF" },
  candy:     { id: "candy",     name: "Candy",         bg: "#4F1733", surface: "#632142", border: "#7F395C", accent: "#70C299", accent2: "#E689B8" },
  spiderMan: { id: "spiderMan", name: "Spider Man",    bg: "#4F1A17", surface: "#632421", border: "#7F3C39", accent: "#4C7FC4", accent2: "#C4453F" },
};

const THEME_KEY = "cadence:theme";
const CUSTOM_THEMES_KEY = "cadence:customThemes";
const DEFAULT_THEME_ID = "blackBolt";

// --- tiny hex/HSL helpers, only used to derive surface/border from a
// user-picked background so Canvas's theme creator only has to ask for two
// colours (background, text/accent) instead of five. ---
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Derives surface/border from a single background colour, same hue/
 * saturation family just progressively lighter — matching the built-in
 * themes' own "same hue, different lightness" convention above.
 */
export function deriveShades(bgHex) {
  const { r, g, b } = hexToRgb(bgHex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const surface = hslToHex(h, s, Math.min(90, l + 6));
  const border = hslToHex(h, Math.max(0, s - 8), Math.min(95, l + 16));
  return { surface, border };
}

/** A curated, muted-not-neon swatch set for Canvas's theme creator — every
 * built-in theme's bg/accent already lives in this same "usable as either
 * a background or an accent" register, so free-form picking from it can't
 * produce an illegible combination. */
export const THEME_PALETTE = [
  "#000000", "#0A0A0A", "#1A1A1A",
  "#4F172A", "#4F1A17", "#4F1733", "#2C174F", "#174F49", "#4F3417",
  "#D6FF3D", "#8FBFA6", "#C98CA0", "#E0966F", "#5FADA4", "#C7A855",
  "#9C87BF", "#70C299", "#E689B8", "#4C7FC4", "#C4453F", "#EDEDED",
];

const ThemeContext = createContext({
  theme: THEMES[DEFAULT_THEME_ID],
  themeId: DEFAULT_THEME_ID,
  allThemes: THEMES,
  setTheme: () => {},
  addCustomTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [customThemes, setCustomThemes] = useState({});

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((id) => { if (id) setThemeId(id); })
      .catch(() => {});
    AsyncStorage.getItem(CUSTOM_THEMES_KEY)
      .then((raw) => { if (raw) setCustomThemes(JSON.parse(raw)); })
      .catch(() => {});
  }, []);

  const allThemes = { ...THEMES, ...customThemes };

  const setTheme = (id) => {
    if (!allThemes[id]) return;
    setThemeId(id);
    AsyncStorage.setItem(THEME_KEY, id).catch(() => {});
  };

  // name defaults to "Theme #N" (N = existing custom theme count + 1) when
  // left blank — the natural "just tap Save" path after picking colours.
  const addCustomTheme = (bg, accent, name) => {
    const { surface, border } = deriveShades(bg);
    const id = `custom-${Date.now()}`;
    const finalName = (name || "").trim() || `Theme #${Object.keys(customThemes).length + 1}`;
    const next = { id, name: finalName, bg, surface, border, accent, accent2: accent };
    const updated = { ...customThemes, [id]: next };
    setCustomThemes(updated);
    AsyncStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(updated)).catch(() => {});
    setTheme(id);
    return next;
  };

  return (
    <ThemeContext.Provider value={{ theme: allThemes[themeId] || THEMES[DEFAULT_THEME_ID], themeId, allThemes, setTheme, addCustomTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
