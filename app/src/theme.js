import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cadence — theme system.
 * Four presets: the current black/lime look ("Black Bolt") plus three
 * hue + true-complementary pairs (complementary = opposite point on the
 * color wheel, picked for contrast against the accent, not just "a nice
 * second color"). `bg`/`surface` are the two background tones actually used
 * across screens (root background, card/tile background); `accent` replaces
 * the old hardcoded VOLT constant everywhere; `accent2` is the complementary
 * color, used sparingly for secondary highlights (e.g. the personality
 * placard, mood accents) so it reads as a pair, not competing primaries.
 */
export const THEMES = {
  blackBolt: { id: "blackBolt", name: "Black Bolt", bg: "#000000", surface: "#0A0A0A", accent: "#D6FF3D", accent2: "#D6FF3D" },
  pink:      { id: "pink",      name: "Pink",        bg: "#12060D", surface: "#1D0A16", accent: "#FF3DA6", accent2: "#3DFFB0" },
  cyan:      { id: "cyan",      name: "Cyan",         bg: "#03100F", surface: "#0A1B19", accent: "#3DE7FF", accent2: "#FF6A3D" },
  purple:    { id: "purple",    name: "Purple",       bg: "#0B0614", surface: "#160B23", accent: "#A63DFF", accent2: "#E8FF3D" },
};

const THEME_KEY = "cadence:theme";
const DEFAULT_THEME_ID = "blackBolt";

const ThemeContext = createContext({
  theme: THEMES[DEFAULT_THEME_ID],
  themeId: DEFAULT_THEME_ID,
  setTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((id) => { if (id && THEMES[id]) setThemeId(id); })
      .catch(() => {});
  }, []);

  const setTheme = (id) => {
    if (!THEMES[id]) return;
    setThemeId(id);
    AsyncStorage.setItem(THEME_KEY, id).catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ theme: THEMES[themeId], themeId, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
