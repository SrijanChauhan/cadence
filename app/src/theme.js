import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cadence — theme system.
 * Four presets: the original black/lime look ("Black Bolt") plus three hue +
 * true-complementary pairs (complementary = opposite point on the color
 * wheel). The named hue IS the background (`bg`/`surface`, a slightly
 * lighter tone of the same hue for cards/tiles) — `accent` is the
 * complementary color, used for text/highlights so it reads against that
 * background rather than competing with it. Every color here is deliberately
 * desaturated and dark rather than a neon/saturated pick straight off the
 * color wheel — closer to Claude's own muted clay-orange mark than to a
 * glowing app-icon gradient — since a fully saturated hue is comfortable as
 * a small accent but fatiguing as a full-screen background.
 */
export const THEMES = {
  blackBolt: { id: "blackBolt", name: "Black Bolt", bg: "#000000", surface: "#0A0A0A", accent: "#C7E86E", accent2: "#C7E86E" },
  pink:      { id: "pink",      name: "Pink",        bg: "#241017", surface: "#331B24", accent: "#8FBFA6", accent2: "#C98CA0" },
  cyan:      { id: "cyan",      name: "Cyan",         bg: "#0E2422", surface: "#1B3330", accent: "#E0966F", accent2: "#5FADA4" },
  purple:    { id: "purple",    name: "Purple",       bg: "#1E1729", surface: "#2C2238", accent: "#C7A855", accent2: "#9C87BF" },
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
