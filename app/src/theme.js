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
