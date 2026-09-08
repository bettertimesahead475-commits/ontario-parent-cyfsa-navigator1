import { auth } from "./firebase";
import { getUserKey } from "./storage";

/**
 * Robust API helper that routes relative routes correctly, and attaches
 * identity headers every request needs for the paywall:
 *  - Authorization: Bearer <Firebase ID token>, if a parent is signed in
 *    (this is how the server knows *who* is asking, for the free-tier count)
 *  - X-PS-Session: <paid session token>, if one is stored locally (Pro/Premium
 *    unlock — takes priority over the free-tier check server-side)
 * Both are safe to send on every request; routes that don't care simply
 * ignore them.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);

  try {
    const user = auth.currentUser;
    if (user) {
      const idToken = await user.getIdToken();
      headers.set("Authorization", `Bearer ${idToken}`);
    }
  } catch (e) {
    console.warn("Failed to attach Firebase ID token to request:", e);
  }

  try {
    const sessionToken = localStorage.getItem(getUserKey("ps_session_token") || "ps_session_token");
    if (sessionToken) headers.set("X-PS-Session", sessionToken);
  } catch (e) {
    console.warn("Failed to attach session token to request:", e);
  }

  return fetch(input, { ...init, headers });
}

/**
 * Safely parses the JSON response. If the response content-type is not JSON,
 * it returns a helpful error with a snippet of the response text (e.g. from a server 502/503 HTML error page).
 */
export async function safeReadJson(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`Server returned non-JSON response (${response.status}): ${text.substring(0, 150) || "No content"}`);
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Server error (${response.status})`);
  }
  return data;
}
