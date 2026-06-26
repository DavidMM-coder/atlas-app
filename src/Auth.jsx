import React, { useState, useEffect, useRef } from "react";
import {
  auth, db, saveUserToFirestore,
  GoogleAuthProvider, OAuthProvider,
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPhoneNumber, RecaptchaVerifier, sendPasswordResetEmail,
} from "./firebase.js";

const P = {
  paper: "#060a06", card: "#0b110b", ink: "#e8f5e9", slate: "#a5d6a7",
  faint: "#4a7a4a", line: "#163016", accent: "#00e676", red: "#ff5252",
  amber: "#ffab40", dim: "#1e3a1e", cardBorder: "#1a301a", wash: "#080d08",
};
const F = { mono: "'IBM Plex Mono', monospace", sans: "Inter, sans-serif" };

function Input({ placeholder, type = "text", value, onChange, autoFocus, style = {} }) {
  return (
    <input
      autoFocus={autoFocus}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{
        width: "100%", boxSizing: "border-box",
        fontFamily: F.sans, fontSize: 14, color: P.ink,
        background: P.wash, border: `1px solid ${P.dim}`, borderRadius: 6,
        padding: "11px 14px", outline: "none",
        transition: "border-color .15s", ...style,
      }}
      onFocus={e => e.target.style.borderColor = P.accent}
      onBlur={e => e.target.style.borderColor = P.dim}
    />
  );
}

function SocialBtn({ icon, label, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 12,
      background: "none", border: `1px solid ${P.dim}`, borderRadius: 6,
      padding: "11px 16px", cursor: disabled ? "default" : "pointer",
      fontFamily: F.sans, fontSize: 13, fontWeight: 500, color: P.slate,
      transition: "all .15s", opacity: disabled ? 0.5 : 1,
    }}
    onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = P.accent; e.currentTarget.style.color = P.ink; }}}
    onMouseLeave={e => { e.currentTarget.style.borderColor = P.dim; e.currentTarget.style.color = P.slate; }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("home"); // home | email | phone
  const [emailMode, setEmailMode] = useState("signin"); // signin | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmResult, setConfirmResult] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const recaptchaRef = useRef(null);

  useEffect(() => {
    return () => {
      if (window._recaptchaVerifier) {
        try { window._recaptchaVerifier.clear(); } catch {}
        window._recaptchaVerifier = null;
      }
    };
  }, []);

  async function handleGoogle() {
    setError(""); setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await saveUserToFirestore(result.user);
      onAuth(result.user);
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }

  async function handleApple() {
    setError(""); setLoading(true);
    try {
      const provider = new OAuthProvider("apple.com");
      provider.addScope("email"); provider.addScope("name");
      const result = await signInWithPopup(auth, provider);
      await saveUserToFirestore(result.user);
      onAuth(result.user);
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }

  async function handleEmail(e) {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      if (emailMode === "reset") {
        await sendPasswordResetEmail(auth, email);
        setInfo("Reset email sent — check your inbox."); setLoading(false); return;
      }
      const fn = emailMode === "signup" ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
      const result = await fn(auth, email, password);
      await saveUserToFirestore(result.user);
      onAuth(result.user);
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }

  async function handleSendOtp() {
    setError(""); setLoading(true);
    try {
      if (!window._recaptchaVerifier) {
        window._recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaRef.current, { size: "invisible" });
      }
      const result = await signInWithPhoneNumber(auth, phone, window._recaptchaVerifier);
      setConfirmResult(result);
      setInfo("Code sent — check your messages.");
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }

  async function handleVerifyOtp() {
    setError(""); setLoading(true);
    try {
      const result = await confirmResult.confirm(otp);
      await saveUserToFirestore(result.user);
      onAuth(result.user);
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }

  const configured = !!import.meta.env.VITE_FIREBASE_API_KEY;

  return (
    <div style={{ minHeight: "100vh", background: P.paper, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');`}</style>

      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 40 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: P.accent, display: "inline-block", boxShadow: `0 0 10px ${P.accent}` }} />
        <span style={{ fontFamily: F.mono, fontSize: 16, fontWeight: 600, letterSpacing: 5, color: P.ink }}>ATLAS</span>
      </div>

      <div style={{ width: "100%", maxWidth: 380, background: P.card, border: `1px solid ${P.cardBorder}`, borderRadius: 8, padding: "28px 28px 24px" }}>

        {!configured && (
          <div style={{ marginBottom: 20, background: `${P.amber}11`, border: `1px solid ${P.amber}44`, borderLeft: `3px solid ${P.amber}`, borderRadius: 4, padding: "10px 14px", fontFamily: F.mono, fontSize: 10, letterSpacing: 0.5, color: P.amber, lineHeight: 1.6 }}>
            ⚠ FIREBASE NOT CONFIGURED<br/>
            <span style={{ color: P.faint }}>Add VITE_FIREBASE_* keys to .env and restart the dev server.</span>
          </div>
        )}

        {mode === "home" && (
          <>
            <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.accent, opacity: 0.7, marginBottom: 6 }}>SIGN IN / CREATE ACCOUNT</div>
            <h2 style={{ fontFamily: F.mono, fontWeight: 600, fontSize: 17, color: P.ink, margin: "0 0 22px", letterSpacing: 0.3 }}>Welcome to Atlas</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <SocialBtn icon="G" label="Continue with Google" onClick={handleGoogle} disabled={loading || !configured} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
                <div style={{ flex: 1, height: 1, background: P.dim }} />
                <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5, color: P.faint }}>OR</span>
                <div style={{ flex: 1, height: 1, background: P.dim }} />
              </div>
              <SocialBtn icon="✉" label="Continue with Email" onClick={() => setMode("email")} disabled={loading || !configured} />
              <SocialBtn icon="📱" label="Continue with Phone" onClick={() => setMode("phone")} disabled={loading || !configured} />
            </div>

            {error && <div style={{ marginTop: 16, fontFamily: F.mono, fontSize: 10, color: P.red, letterSpacing: 0.3 }}>⚠ {error}</div>}
          </>
        )}

        {mode === "email" && (
          <>
            <button onClick={() => { setMode("home"); setError(""); setInfo(""); }} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1, color: P.faint, background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 18 }}>← BACK</button>
            <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.accent, opacity: 0.7, marginBottom: 6 }}>
              {emailMode === "signin" ? "SIGN IN" : emailMode === "signup" ? "CREATE ACCOUNT" : "RESET PASSWORD"}
            </div>
            <form onSubmit={handleEmail} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Input placeholder="Email address" type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
              {emailMode !== "reset" && (
                <Input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
              )}
              <button type="submit" disabled={loading || !configured} style={{
                fontFamily: F.sans, fontWeight: 600, fontSize: 14,
                color: "#000", background: P.accent, border: "none", borderRadius: 6,
                padding: "11px", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1, marginTop: 4,
              }}>
                {loading ? "Loading…" : emailMode === "signin" ? "Sign in" : emailMode === "signup" ? "Create account" : "Send reset email"}
              </button>
            </form>
            {info && <div style={{ marginTop: 12, fontFamily: F.mono, fontSize: 10, color: P.accent, letterSpacing: 0.3 }}>✓ {info}</div>}
            {error && <div style={{ marginTop: 12, fontFamily: F.mono, fontSize: 10, color: P.red, letterSpacing: 0.3 }}>⚠ {error}</div>}
            <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
              {emailMode !== "signup" && <button onClick={() => { setEmailMode("signup"); setError(""); setInfo(""); }} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 0.5, color: P.faint, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Create account</button>}
              {emailMode !== "signin" && <button onClick={() => { setEmailMode("signin"); setError(""); setInfo(""); }} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 0.5, color: P.faint, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Sign in</button>}
              {emailMode === "signin" && <button onClick={() => { setEmailMode("reset"); setError(""); setInfo(""); }} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 0.5, color: P.faint, background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: "auto" }}>Forgot password?</button>}
            </div>
          </>
        )}

        {mode === "phone" && (
          <>
            <button onClick={() => { setMode("home"); setError(""); setInfo(""); setConfirmResult(null); }} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1, color: P.faint, background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 18 }}>← BACK</button>
            <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: P.accent, opacity: 0.7, marginBottom: 6 }}>PHONE SIGN IN</div>
            {!confirmResult ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Input placeholder="+1 555 000 0000" type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoFocus />
                <div style={{ fontFamily: F.mono, fontSize: 9, color: P.faint, letterSpacing: 0.3 }}>Include country code (e.g. +1 for US)</div>
                <button onClick={handleSendOtp} disabled={loading || !configured} style={{
                  fontFamily: F.sans, fontWeight: 600, fontSize: 14,
                  color: "#000", background: P.accent, border: "none", borderRadius: 6,
                  padding: "11px", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
                }}>{loading ? "Sending…" : "Send code"}</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontFamily: F.mono, fontSize: 10, color: P.accent, letterSpacing: 0.3, marginBottom: 4 }}>✓ {info}</div>
                <Input placeholder="6-digit code" type="tel" value={otp} onChange={e => setOtp(e.target.value)} autoFocus />
                <button onClick={handleVerifyOtp} disabled={loading || !configured} style={{
                  fontFamily: F.sans, fontWeight: 600, fontSize: 14,
                  color: "#000", background: P.accent, border: "none", borderRadius: 6,
                  padding: "11px", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
                }}>{loading ? "Verifying…" : "Verify & sign in"}</button>
              </div>
            )}
            {error && <div style={{ marginTop: 12, fontFamily: F.mono, fontSize: 10, color: P.red, letterSpacing: 0.3 }}>⚠ {error}</div>}
            <div ref={recaptchaRef} />
          </>
        )}
      </div>

      <p style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 0.3, color: P.faint, marginTop: 20, textAlign: "center", lineHeight: 1.7, maxWidth: 340 }}>
        By signing in you agree to Atlas's terms. Your account lets us remember your profile and holdings across devices.
      </p>
    </div>
  );
}

function friendlyError(e) {
  const m = e?.code || e?.message || "";
  if (m.includes("user-not-found") || m.includes("wrong-password") || m.includes("invalid-credential")) return "Invalid email or password.";
  if (m.includes("email-already-in-use")) return "That email is already registered — try signing in.";
  if (m.includes("weak-password")) return "Password must be at least 6 characters.";
  if (m.includes("invalid-email")) return "Enter a valid email address.";
  if (m.includes("invalid-phone")) return "Enter a valid phone number with country code.";
  if (m.includes("too-many-requests")) return "Too many attempts — try again later.";
  if (m.includes("popup-closed")) return "Sign-in popup was closed. Try again.";
  if (m.includes("cancelled-popup")) return "";
  return e?.message || "Something went wrong. Try again.";
}
