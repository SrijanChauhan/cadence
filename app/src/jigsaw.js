import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cadence — Jigsaw: lets you reorder the main playlist screen's five
 * sections (Mode & Feel, BPM & Personality, My Picks & Save, Song List,
 * Refresh Playlist) into whatever order you want, and save that as a named
 * preset. Same persistence pattern as theme.js — one active id, a set of
 * saved presets, both in AsyncStorage.
 */
export const JIGSAW_BLOCKS = [
  { key: "modeFeel", label: "Mode & Feel" },
  { key: "bpm", label: "BPM & Personality" },
  { key: "myPicks", label: "My Picks & Save" },
  { key: "songs", label: "Song List" },
  { key: "refresh", label: "Refresh Playlist" },
];

const DEFAULT_ORDER = JIGSAW_BLOCKS.map((b) => b.key);
const DEFAULT_PRESET = { id: "default", name: "Jigsaw #1", order: DEFAULT_ORDER };

const PRESETS_KEY = "cadence:jigsawPresets";
const ACTIVE_KEY = "cadence:jigsawActivePreset";

const JigsawContext = createContext({
  order: DEFAULT_ORDER,
  presets: [DEFAULT_PRESET],
  activeId: "default",
  selectPreset: () => {},
  savePreset: () => {},
});

export function JigsawProvider({ children }) {
  const [customPresets, setCustomPresets] = useState([]);
  const [activeId, setActiveId] = useState("default");

  useEffect(() => {
    AsyncStorage.getItem(PRESETS_KEY)
      .then((raw) => { if (raw) setCustomPresets(JSON.parse(raw)); })
      .catch(() => {});
    AsyncStorage.getItem(ACTIVE_KEY)
      .then((id) => { if (id) setActiveId(id); })
      .catch(() => {});
  }, []);

  const presets = [DEFAULT_PRESET, ...customPresets];

  const selectPreset = (id) => {
    setActiveId(id);
    AsyncStorage.setItem(ACTIVE_KEY, id).catch(() => {});
  };

  // name defaults to "Jigsaw #N" (N = existing custom preset count + 2,
  // since #1 is the built-in default) when left blank.
  const savePreset = (order, name) => {
    const id = `custom-${Date.now()}`;
    const finalName = (name || "").trim() || `Jigsaw #${customPresets.length + 2}`;
    const next = { id, name: finalName, order };
    const updated = [...customPresets, next];
    setCustomPresets(updated);
    AsyncStorage.setItem(PRESETS_KEY, JSON.stringify(updated)).catch(() => {});
    selectPreset(id);
    return next;
  };

  const active = presets.find((p) => p.id === activeId) || DEFAULT_PRESET;

  return (
    <JigsawContext.Provider value={{ order: active.order, presets, activeId, selectPreset, savePreset }}>
      {children}
    </JigsawContext.Provider>
  );
}

export function useJigsaw() {
  return useContext(JigsawContext);
}
