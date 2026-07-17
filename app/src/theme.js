import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cadence — theme system.
 * Four presets: the original black/lime look ("Black Bolt", unchanged — kept
 * exactly as it always was) plus three hue + true-complementary pairs
 * (complementary = opposite point on the color wheel). For those three, the
 * named hue IS the background (`bg`/`surface`, a slightly lighter tone of
 * the same hue for cards/tiles) — `accent` is the complementary color, used
 * for text/highlights so it reads against that background rather than
 * competing with it. Both background and accent are deliberately desaturated
 * and dark rather than a neon/saturated pick straight off the color wheel —
 * closer to Claude's own muted clay-orange mark than to a glowing app-icon
 * gradient — since a fully saturated hue is comfortable as a small accent
 * but fatiguing as a full-screen background.
 *
 * `border` is a subtle outline tone tinted with the same hue as bg/surface —
 * chips, bubbles, and cards used a flat neutral grey border before, which on
 * Black Bolt's true black is unnoticeable but on a coloured background reads
 * as a mismatched leftover from a different theme. Black Bolt keeps its
 * original neutral grey since that's the one look that was already right.
 */
export const THEMES = {
  blackBolt: { id: "blackBolt", name: "Black Bolt", bg: "#000000", surface: "#0A0A0A", border: "#242424", accent: "#D6FF3D", accent2: "#D6FF3D" },
  pink:      { id: "pink",      name: "Pink",        bg: "#241017", surface: "#331B24", border: "#4A2A38", accent: "#8FBFA6", accent2: "#C98CA0" },
  cyan:      { id: "cyan",      name: "Cyan",         bg: "#0E2422", surface: "#1B3330", border: "#2A4A46", accent: "#E0966F", accent2: "#5FADA4" },
  purple:    { id: "purple",    name: "Purple",       bg: "#1E1729", surface: "#2C2238", border: "#3D3050", accent: "#C7A855", accent2: "#9C87BF" },
  candy:     { id: "candy",     name: "Candy",         bg: "#2A1330", surface: "#3A1B42", border: "#4F2A58", accent: "#7FD8C4", accent2: "#E8829E" },
  spiderMan: { id: "spiderMan", name: "Spider Man",    bg: "#2B0F12", surface: "#3D1418", border: "#552024", accent: "#4C7FC4", accent2: "#C4453F" },
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
