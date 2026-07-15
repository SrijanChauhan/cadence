/**
 * Cadence — GA4 Measurement Protocol relay.
 *
 * The client sends funnel events here; the server forwards them to GA4
 * with the Measurement Protocol API secret, which must never live in the
 * client bundle — same reasoning as GETSONGBPM_KEY/LASTFM_API_KEY being
 * server-env-var-only, not shipped on-device. Plain HTTPS, no SDK — this
 * works from Expo Go with zero native dependencies, unlike
 * @react-native-firebase/analytics, which needs a real dev build.
 *
 * Graceful degradation: with GA4_MEASUREMENT_ID/GA4_API_SECRET unset,
 * sendEvent silently no-ops instead of crashing, same pattern as every
 * other optional integration in this app.
 */
const MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || "";
const API_SECRET = process.env.GA4_API_SECRET || "";
const GA4_URL = "https://www.google-analytics.com/mp/collect";

/**
 * @param {{clientId: string, name: string, params?: object}} event
 * name/params follow GA4's Measurement Protocol event schema: name is
 * lowercase snake_case (<=40 chars), params is a flat object of
 * string/number/boolean values (<=25 params, param names <=40 chars) —
 * validation is the caller's job (see analytics.js on the client), this
 * just forwards whatever it's given.
 */
export async function sendEvent({ clientId, name, params = {} }) {
  if (!MEASUREMENT_ID || !API_SECRET || !clientId || !name) return { sent: false };
  const url = `${GA4_URL}?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ client_id: clientId, events: [{ name, params }] }),
    });
    // GA4's Measurement Protocol returns 204 with no body on success and
    // doesn't validate synchronously — a 2xx here means "accepted for
    // processing," not "definitely shows up in reports."
    return { sent: res.ok };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}
