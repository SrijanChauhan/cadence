import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cadence — My Picks, lifted to app-level shared state.
 *
 * Previously lived as local state inside PlaylistScreen, persisted to
 * AsyncStorage but only ever loaded/saved by that one component — hearting
 * a track from anywhere else (e.g. Profile's Recommendations section)
 * couldn't make it show up on the main screen without a reload, since each
 * mount would load its own separate copy. A single provider at the App.js
 * level means every screen reads/writes the exact same live state.
 */
const MY_PICKS_KEY = "cadence:myPicks";

const MyPicksContext = createContext(null);

export function MyPicksProvider({ children }) {
  const [myPicks, setMyPicks] = useState([]);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(MY_PICKS_KEY)
      .then((raw) => { if (raw) setMyPicks(JSON.parse(raw)); })
      .catch(() => {})
      .finally(() => { loaded.current = true; });
  }, []);

  // persist on every change, but not before the initial load above has run —
  // otherwise the empty initial state would overwrite a previously saved list
  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(MY_PICKS_KEY, JSON.stringify(myPicks)).catch(() => {});
  }, [myPicks]);

  const addToMyPicks = (track) => {
    setMyPicks((ps) => (ps.some((p) => p.id === track.id) ? ps : [...ps, track]));
  };
  const removeFromMyPicks = (id) => setMyPicks((ps) => ps.filter((p) => p.id !== id));
  const isMyPick = (id) => myPicks.some((p) => p.id === id);
  const toggleLike = (track) => {
    if (isMyPick(track.id)) removeFromMyPicks(track.id);
    else addToMyPicks(track);
  };
  const reorderMyPicks = (fromIndex, toIndex) => {
    setMyPicks((ps) => {
      const next = [...ps];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  return (
    <MyPicksContext.Provider value={{ myPicks, addToMyPicks, removeFromMyPicks, isMyPick, toggleLike, reorderMyPicks }}>
      {children}
    </MyPicksContext.Provider>
  );
}

export function useMyPicks() {
  return useContext(MyPicksContext);
}
