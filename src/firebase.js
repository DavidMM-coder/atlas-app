import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, OAuthProvider,
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPhoneNumber, RecaptchaVerifier, signOut, onAuthStateChanged,
  sendPasswordResetEmail, sendEmailVerification,
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, getDocFromServer, collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";

const configured = !!(
  import.meta.env.VITE_FIREBASE_API_KEY &&
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
  import.meta.env.VITE_FIREBASE_PROJECT_ID
);

let auth = null;
let db = null;

if (configured) {
  const app = initializeApp({
    apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  });
  auth = getAuth(app);
  db = getFirestore(app);
}

export { auth, db };

export async function saveUserToFirestore(user) {
  if (!user || !db) return;
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    photoURL: user.photoURL || null,
    phoneNumber: user.phoneNumber || null,
    lastSeen: serverTimestamp(),
  }, { merge: true });
}

// Cloud copy of what makes an account portable — profile, holdings, spare cash — stored on
// the same users/{uid} doc the auth flow already writes identity fields to (so the existing
// security rules that allow that write cover these fields too). This is what actually
// delivers the sign-in screen's "remember your profile and holdings across devices" promise;
// localStorage stays as the local cache / signed-out fallback.
// Three DISTINCT outcomes — the caller must be able to tell them apart:
//   { ok: true,  data }        the doc exists
//   { ok: true,  data: null }  the doc genuinely does not exist (a brand-new account)
//   { ok: false }              the read FAILED or timed out — the cloud state is UNKNOWN
// Conflating the last two (both used to return null) is what let a transient first-read
// failure on a fresh phone masquerade as "no profile exists" and railroad a real user into
// re-onboarding over their cloud profile. getDoc has no timeout of its own, so a hung
// connection is turned into an error rather than an indefinite wait.
// Per-tab flight recorder for cloud reads (sessionStorage, last 10 entries, booleans only).
// The profile-loss incident took three debugging rounds because the boot read's outcome was
// unobservable after the fact — this makes every loadUserData call auditable post-hoc:
// read sessionStorage.atlas_sync_trace (or run atlasDebugCloudDoc()).
function noteSyncTrace(entry) {
  try {
    const arr = JSON.parse(sessionStorage.getItem("atlas_sync_trace") || "[]");
    arr.push({ at: new Date().toISOString(), ...entry });
    sessionStorage.setItem("atlas_sync_trace", JSON.stringify(arr.slice(-10)));
  } catch {}
}

export async function loadUserData(uid) {
  if (!db || !uid) return { ok: false };
  // Test hook, dev-only (vite dead-code-eliminates this in prod builds): with
  // VITE_SIMULATE_CLOUD_FAIL=1 the read fails until `window.__allowCloud = true`, so the
  // sync-gate's error + Retry path can be exercised deterministically — a real transport
  // block is unreliable because the SDK binds its network primitives at module init.
  if (import.meta.env.VITE_SIMULATE_CLOUD_FAIL === "1" && typeof window !== "undefined" && !window.__allowCloud) {
    await new Promise((r) => setTimeout(r, 600));
    return { ok: false };
  }
  const raced = (p) => Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error("cloud read timed out")), 12000)),
  ]);
  try {
    const snap = await raced(getDoc(doc(db, "users", uid)));
    // Dev-only simulation of the incident below (dead-code-eliminated in prod): the FIRST
    // read per page pretends the SDK served a stale cached doc with no profile.
    const simulateStale = import.meta.env.VITE_SIMULATE_STALE_CACHE === "1" && typeof window !== "undefined" && !window.__staleCacheServed;
    if (simulateStale) window.__staleCacheServed = true;
    const fromCache = simulateStale ? true : snap.metadata.fromCache;
    const data = simulateStale ? null : (snap.exists() ? snap.data() : null);
    // A profile-less answer must NEVER be concluded without a server round-trip — that
    // conclusion routes users into onboarding (and finishOnboarding's guard into a silent
    // save), which is destructive-adjacent. Snapshot metadata is NOT a reliable guard here:
    // caught live 2026-07-14, the boot getDoc raced the concurrent saveUserToFirestore
    // identity merge-write and latency compensation served the local overlay — identity
    // fields only, NO profile — with fromCache:false and hasPendingWrites:true. So the
    // escalation is unconditional on !profile: getDocFromServer bypasses the local overlay
    // and returns server truth. Costs one extra round-trip ONLY for genuinely-new accounts.
    // A profile-bearing answer needs no escalation — stale-but-real is safe to hydrate.
    // If the server can't be reached, raced() throws into the catch → {ok:false} → the
    // caller's retry/error path, never a false "genuinely empty".
    if (!data?.profile?.name) {
      const server = await raced(getDocFromServer(doc(db, "users", uid)));
      noteSyncTrace({ exists: snap.exists(), fromCache: snap.metadata.fromCache, pendingWrites: snap.metadata.hasPendingWrites, hasProfile: !!data?.profile?.name, escalated: true, serverExists: server.exists(), serverHasProfile: !!server.data()?.profile?.name });
      return { ok: true, data: server.exists() ? server.data() : null, fromCache: false };
    }
    noteSyncTrace({ exists: snap.exists(), fromCache: snap.metadata.fromCache, pendingWrites: snap.metadata.hasPendingWrites, hasProfile: true, escalated: false });
    return { ok: true, data, fromCache };
  } catch (e) {
    console.error("Failed to load cloud data:", e);
    noteSyncTrace({ error: String(e).slice(0, 80) });
    return { ok: false };
  }
}

// Console diagnostic: exactly what the app's own read path (loadUserData → getDoc) returns
// for the signed-in user, plus the raw snapshot metadata. Run `atlasDebugCloudDoc()` in the
// browser console when cloud hydration misbehaves — it answers "what does THIS device's SDK
// see?" without needing REST calls or tokens.
if (typeof window !== "undefined") {
  window.atlasDebugCloudDoc = async () => {
    const u = auth?.currentUser;
    if (!u) return { error: "not signed in" };
    let raw = null;
    try {
      const snap = await getDoc(doc(db, "users", u.uid));
      raw = { exists: snap.exists(), fromCache: snap.metadata.fromCache, pendingWrites: snap.metadata.hasPendingWrites, fields: snap.exists() ? Object.keys(snap.data()) : null, profileName: snap.data()?.profile?.name ?? null };
    } catch (e) {
      raw = { getDocError: String(e) };
    }
    const viaLoad = await loadUserData(u.uid);
    const out = { uid: u.uid, raw, viaLoad: { ok: viaLoad.ok, hasData: !!viaLoad.data, profileName: viaLoad.data?.profile?.name ?? null, fromCache: viaLoad.fromCache ?? null } };
    console.log("atlasDebugCloudDoc:", out);
    return out;
  };
}

// Returns whether the write actually landed, so callers can surface a failure instead of
// letting cloud sync die silently (silent write failures hid the profile-overwrite bug).
export async function saveUserData(uid, partial) {
  if (!db || !uid || !partial) return false;
  try {
    await setDoc(doc(db, "users", uid), { ...partial, dataUpdatedAt: serverTimestamp() }, { merge: true });
    return true;
  } catch (e) {
    console.error("Failed to save cloud data:", e);
    return false;
  }
}

// Anonymous-teaser content: Atlas's house-view scan for a neutral balanced profile, published
// by the owner (atlasPublishHousePicks console action) and readable WITHOUT auth. Rules scope
// is exactly one path — public_content/house_picks: read public, write owner-only. Anonymous
// visitors only ever hit this one cached read: zero AI calls, zero authed-route calls.
export async function loadHousePicks() {
  // Dev-only fixture (dead-code-eliminated in prod): lets the teaser UI be exercised locally
  // before the public_content rules are deployed.
  if (import.meta.env.VITE_SIMULATE_HOUSE_PICKS === "1") {
    return {
      publishedAt: new Date(Date.now() - 2 * 86400e3).toISOString(),
      marketContext: "Markets are grinding higher on resilient earnings, with breadth improving beyond mega-cap tech.",
      picks: [
        { ticker: "MSFT", company: "Microsoft Corporation", sector: "Software", fitScore: 82, pillars: { fundamentals: 90, valuation: 58, technicals: 76, risk: 86 }, tags: ["Wide moat", "Cash-rich"], snapshot: [{ label: "Fwd P/E", value: "31x" }, { label: "Rev growth", value: "+15% YoY" }], reason: "Azure growth reaccelerated to 30%+ while margins expanded.", concern: "Valuation leaves little room for a capex-digestion pause." },
        { ticker: "JNJ", company: "Johnson & Johnson", sector: "Healthcare", fitScore: 74, pillars: { fundamentals: 82, valuation: 70, technicals: 58, risk: 90 }, tags: ["Dividend aristocrat", "Defensive"], snapshot: [{ label: "P/E", value: "15x" }, { label: "Yield", value: "3.1%" }], reason: "Trades below its 10-year average multiple with a fortress balance sheet.", concern: "Litigation overhang resurfaces periodically." },
        { ticker: "ASML", company: "ASML Holding N.V.", sector: "Semi Equipment", fitScore: 78, pillars: { fundamentals: 88, valuation: 55, technicals: 72, risk: 68 }, tags: ["Monopoly position", "Secular growth"], snapshot: [{ label: "Backlog", value: "€38B" }, { label: "Rev growth", value: "+22% YoY" }], reason: "EUV monopoly with a record backlog stretching into 2027.", concern: "Export-control headlines drive sharp drawdowns." },
        { ticker: "V", company: "Visa Inc.", sector: "Payments", fitScore: 76, pillars: { fundamentals: 89, valuation: 60, technicals: 66, risk: 87 }, tags: ["Network effects", "Capital-light"], snapshot: [{ label: "Op margin", value: "67%" }, { label: "Fwd P/E", value: "27x" }], reason: "Cross-border volumes still compounding double-digit with 60%+ margins.", concern: "Regulatory pressure on interchange fees." },
      ],
    };
  }
  if (!db) return null;
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "public_content", "house_picks")),
      new Promise((_, reject) => setTimeout(() => reject(new Error("house-picks read timed out")), 8000)),
    ]);
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error("Failed to load house picks:", e);
    return null;   // teaser degrades to feature blurbs, never an error
  }
}

export async function saveHousePicks(data) {
  if (!db || !data) return false;
  try {
    await setDoc(doc(db, "public_content", "house_picks"), data);
    return true;
  } catch (e) {
    console.error("Failed to publish house picks:", e);
    return false;
  }
}

// Cloud copy of the append-only Discover pick log — one document per pick under
// users/{uid}/pick_history, so the log survives cache clears and device switches. A
// subcollection rather than an array field on users/{uid}: the log grows forever, and a
// growing array would eventually hit Firestore's 1 MiB per-document cap. Requires its own
// owner-only security rule (see firestore.rules) — the parent doc's rule does not cascade.
export async function savePickHistory(uid, records) {
  if (!db || !uid || !Array.isArray(records) || !records.length) return;
  try {
    await Promise.all(records.map((r) => addDoc(collection(db, "users", uid, "pick_history"), r)));
  } catch (e) {
    console.error("Failed to save pick history to cloud:", e);
  }
}

export async function loadPickHistory(uid) {
  if (!db || !uid) return null;
  try {
    const snap = await getDocs(collection(db, "users", uid, "pick_history"));
    // Sort client-side on the ISO `at` field rather than orderBy(), so a doc missing `at`
    // (which orderBy silently drops) still comes back and is visible in the analysis.
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  } catch (e) {
    console.error("Failed to load pick history from cloud:", e);
    return null;
  }
}

export {
  GoogleAuthProvider, OAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPhoneNumber, RecaptchaVerifier, signOut, onAuthStateChanged,
  sendPasswordResetEmail, sendEmailVerification,
};
