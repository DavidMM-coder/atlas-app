import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, OAuthProvider,
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPhoneNumber, RecaptchaVerifier, signOut, onAuthStateChanged,
  sendPasswordResetEmail, sendEmailVerification,
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";

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
export async function loadUserData(uid) {
  if (!db || !uid) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error("Failed to load cloud data:", e);
    return null;
  }
}

export async function saveUserData(uid, partial) {
  if (!db || !uid || !partial) return;
  try {
    await setDoc(doc(db, "users", uid), { ...partial, dataUpdatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error("Failed to save cloud data:", e);
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
