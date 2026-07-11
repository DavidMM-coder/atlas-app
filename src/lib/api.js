// Single source of truth for where the backend lives. On the web build the app is served
// from the same origin as the /api functions, so this is "". In the Capacitor/Tauri shells
// the page is served from the app bundle (capacitor://localhost etc.), so VITE_API_URL must
// point at the deployed Vercel host — every fetch has to go through this helper or native
// builds silently 404 on relative /api paths.
import { auth } from "../firebase.js";

export const API_BASE = import.meta.env.VITE_API_URL || "";
export const apiUrl = (path) => `${API_BASE}${path}`;

// Authenticated fetch for the /api market-data routes (history/fundamentals/news/fx), which
// require a signed-in user server-side. Waits for Firebase to finish restoring the persisted
// session before reading currentUser (a call fired right after load must not go out
// tokenless), and self-heals a stale cached ID token by force-refreshing once on a 401 —
// the same pattern the AI calls use. When Firebase isn't configured (local dev against the
// vite middleware routes, which don't enforce auth) it degrades to a plain fetch.
export async function apiFetch(path, init = {}) {
  const doFetch = async (forceRefresh) => {
    const headers = { ...(init.headers || {}) };
    try {
      if (auth?.authStateReady) await auth.authStateReady();
      const u = auth?.currentUser;
      if (u) headers.Authorization = `Bearer ${await u.getIdToken(forceRefresh)}`;
    } catch {}
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };
  let resp = await doFetch(false);
  if (resp.status === 401 && auth?.currentUser) resp = await doFetch(true);
  return resp;
}
