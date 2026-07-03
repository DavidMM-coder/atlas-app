// Single source of truth for where the backend lives. On the web build the app is served
// from the same origin as the /api functions, so this is "". In the Capacitor/Tauri shells
// the page is served from the app bundle (capacitor://localhost etc.), so VITE_API_URL must
// point at the deployed Vercel host — every fetch has to go through this helper or native
// builds silently 404 on relative /api paths.
export const API_BASE = import.meta.env.VITE_API_URL || "";
export const apiUrl = (path) => `${API_BASE}${path}`;
