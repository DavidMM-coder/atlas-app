// Shared auth + rate limiting for every /api route. Lives under _lib/ so Vercel never
// exposes it as an endpoint (underscore-prefixed paths are not built as functions).
//
// Fail CLOSED when Firebase isn't configured: returning ok would silently turn every
// consumer into an unauthenticated endpoint the moment the env var goes missing.
export async function verifyFirebaseToken(idToken) {
  const key = process.env.VITE_FIREBASE_API_KEY;
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
    const u = data?.users?.[0];
    const uid = u?.localId;
    if (!uid) return { ok: false };
    // "verified" = a human-confirmed identity: an email confirmed via its link, OR a phone
    // number confirmed via OTP (phone-only accounts may have no email at all, and the OTP
    // already proved possession). Google/Apple sign-ins arrive with emailVerified true from
    // the provider. NOTE: accounts:lookup reads the LIVE account record, not the token's
    // cached claims — a user who just clicked the verification link passes on their very
    // next request without needing a token refresh.
    return { ok: true, uid, verified: u.emailVerified === true || !!u.phoneNumber };
  } catch {
    return { ok: false };
  }
}

// Best-effort per-user limiter (in-memory per warm instance — not a hard guarantee on
// serverless, but it blunts tight abuse loops at zero infra cost). Same shape messages.js
// has always used.
const buckets = new Map(); // key -> [timestamps]
export function rateLimited(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) { buckets.set(key, recent); return true; }
  recent.push(now);
  buckets.set(key, recent);
  return false;
}

// Prefer Vercel's x-real-ip (the last hop we control) over raw x-forwarded-for, whose
// first element is attacker-supplied and rotatable per request to defeat the limiter.
export function clientIp(req) {
  return String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",").pop() || "").trim() || "unknown";
}

// One-call gate for the public-market-data routes: valid Firebase token + per-user rate
// limit. Writes the error response itself and returns null when the request must not
// proceed; returns the uid otherwise. Email verification is deliberately NOT required
// here — that gate exists only on the AI relay (api/messages.js), where the spend is; a
// signed-in-but-unverified user browsing the app shouldn't see every price lookup fail.
// Routes must answer OPTIONS preflights BEFORE calling this (preflights carry no token).
export async function requireUser(req, res, { limit, windowMs = 60_000 } = {}) {
  const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || null;
  const auth = await verifyFirebaseToken(idToken);
  if (!auth.ok) {
    res.status(auth.unconfigured ? 503 : 401).json({
      error: auth.unconfigured ? "Server is not configured for authentication." : "Sign in to use Atlas.",
    });
    return null;
  }
  if (limit && rateLimited(auth.uid || clientIp(req), limit, windowMs)) {
    res.status(429).json({ error: "Too many requests — wait a minute and try again." });
    return null;
  }
  return auth.uid;
}
