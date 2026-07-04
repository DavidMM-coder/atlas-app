// Locked-down proxy for the Anthropic Messages API.
//
// Without these checks this endpoint is an open relay: anyone who discovers the URL can
// POST arbitrary bodies and spend the ANTHROPIC_API_KEY (any model, any max_tokens, any
// volume). Three layers close that:
//   1. Auth — when Firebase is configured (VITE_FIREBASE_API_KEY present), the caller must
//      send a valid Firebase ID token. Verified server-side via Google's identitytoolkit
//      lookup, so only signed-in Atlas users can reach Anthropic.
//   2. Request validation — model allowlist, max_tokens cap, message/tool shape checks, and
//      a total payload budget, so even authenticated callers can't run arbitrary workloads.
//   3. Best-effort rate limiting per user/IP (in-memory per warm instance — not a hard
//      guarantee on serverless, but it blunts tight abuse loops at zero infra cost).

const ALLOWED_MODELS = new Set(["claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"]);
const ALLOWED_TOOL_TYPES = new Set(["web_search_20260209", "web_search_20250305"]);
const MAX_TOKENS_CAP = 32000; // dossier retry path goes to ~25k; nothing legitimate needs more
const MAX_MESSAGES = 40;
const MAX_BODY_CHARS = 400_000;
const MAX_TOOL_USES = 40;

// Browser cross-origin callers are only the native shells (Capacitor/Tauri) — the web app is
// same-origin. Everything else gets no CORS header (curl still reaches us, which is why the
// auth + validation layers above are the real gate).
const ORIGIN_RE = /^(capacitor|tauri):\/\/localhost$|^https?:\/\/localhost(:\d+)?$|^https?:\/\/tauri\.localhost$/;
function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGIN_RE.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const buckets = new Map(); // key -> [timestamps]
function rateLimited(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) { buckets.set(key, recent); return true; }
  recent.push(now);
  buckets.set(key, recent);
  return false;
}

async function verifyFirebaseToken(idToken) {
  const key = process.env.VITE_FIREBASE_API_KEY;
  // Fail CLOSED when Firebase isn't configured. Returning { ok: true } here used to turn the
  // endpoint into a fully unauthenticated Anthropic relay the moment this env var was missing or
  // misnamed (e.g. a preview deploy, or a prod typo) — a missing gate silently removed the gate.
  // If auth can't be enforced, no one gets in. AI features are unavailable rather than wide open.
  if (!key) return { ok: false, unconfigured: true };
  if (!idToken) return { ok: false };
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!r.ok) return { ok: false };
    const data = await r.json();
    const uid = data?.users?.[0]?.localId;
    return uid ? { ok: true, uid } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Invalid request body.";
  if (!ALLOWED_MODELS.has(body.model)) return "Model not allowed.";
  if (!Number.isFinite(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > MAX_TOKENS_CAP) return "max_tokens out of range.";
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) return "Invalid messages.";
  if (body.stream) return "Streaming is not supported by this endpoint.";
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools) || body.tools.length > 2) return "Invalid tools.";
    for (const t of body.tools) {
      if (!t || typeof t !== "object" || !ALLOWED_TOOL_TYPES.has(t.type)) return "Tool not allowed.";
      if (t.max_uses != null && (!Number.isFinite(t.max_uses) || t.max_uses < 1 || t.max_uses > MAX_TOOL_USES)) return "Tool max_uses out of range.";
    }
  }
  if (JSON.stringify(body).length > MAX_BODY_CHARS) return "Request too large.";
  return null;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY is not set on the server." } });

  const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || null;
  const auth = await verifyFirebaseToken(idToken);
  if (!auth.ok) {
    if (auth.unconfigured) return res.status(503).json({ error: { message: "AI features are unavailable: the server is not configured for authentication." } });
    return res.status(401).json({ error: { message: "Sign in to use Atlas AI features." } });
  }

  // For the rate-limit key prefer the authenticated uid; fall back to the platform-trusted client
  // IP (Vercel's x-real-ip, the last hop we control) rather than raw x-forwarded-for, whose first
  // element is fully attacker-supplied and rotatable per request to defeat the limiter.
  const ip = String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",").pop() || "").trim() || "unknown";
  if (rateLimited(auth.uid || ip)) {
    return res.status(429).json({ error: { message: "Too many requests — wait a minute and try again." } });
  }

  const invalid = validateBody(req.body);
  if (invalid) return res.status(400).json({ error: { message: invalid } });

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: { message: "Proxy error: " + String(e) } });
  }
}
