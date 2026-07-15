import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { BACKEND_URL } from "./config";

/**
 * Cadence — funnel tracking (GA4 Measurement Protocol, relayed through the
 * backend — see server/engine/analytics.js for why the API secret can't
 * live here). A stable per-device client_id (a UUID, generated once and
 * persisted) is GA4's unit of identity in the absence of user accounts —
 * this app doesn't have logins, so there's no better identifier to use.
 *
 * Fire-and-forget by design: track() is never awaited by callers and never
 * throws into the UI. A dropped analytics event should be invisible to the
 * user, the same "best-effort, never block the real feature" spirit as
 * cover-art capture or place-name lookup elsewhere in this app.
 */
const CLIENT_ID_KEY = "cadence:analyticsClientId";
let clientIdPromise = null;

function getClientId() {
  if (!clientIdPromise) {
    clientIdPromise = (async () => {
      try {
        const existing = await AsyncStorage.getItem(CLIENT_ID_KEY);
        if (existing) return existing;
        const fresh = Crypto.randomUUID();
        await AsyncStorage.setItem(CLIENT_ID_KEY, fresh);
        return fresh;
      } catch {
        return "unknown";
      }
    })();
  }
  return clientIdPromise;
}

export function track(name, params = {}) {
  (async () => {
    try {
      const clientId = await getClientId();
      await fetch(`${BACKEND_URL}/analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, name, params }),
      });
    } catch {
      // best-effort — see file header
    }
  })();
}
