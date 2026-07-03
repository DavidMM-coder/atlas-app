import React, { useState, useEffect, useRef } from "react";
import {
  auth, db, saveUserToFirestore,
  GoogleAuthProvider, OAuthProvider,
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPhoneNumber, RecaptchaVerifier, sendPasswordResetEmail,
} from "./firebase.js";
import { color as c, font, type, radius, shadow } from "./ui/tokens.js";
import { AtlasMark, Button, Input, Field, Overline, motion } from "./ui/primitives.jsx";

function SocialBtn({ icon, label, onClick, disabled }) {
  return (
    <Button variant="secondary" size="lg" full onClick={onClick} disabled={disabled} icon={icon}
      style={{ justifyContent: "flex-start", fontWeight: 500, color: c.text2 }}>
      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
    </Button>
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
      // Always tear down and rebuild the verifier against the CURRENT container div rather than
      // reusing one cached on window — navigating away from phone mode (e.g. "← Back") unmounts
      // that div, so a cached verifier from an earlier attempt in this session ends up pointing at
      // a detached node and Firebase throws "reCAPTCHA client element has been removed".
      if (window._recaptchaVerifier) {
        try { window._recaptchaVerifier.clear(); } catch {}
        window._recaptchaVerifier = null;
      }
      window._recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaRef.current, { size: "invisible" });
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
  const linkBtn = { fontFamily: font.sans, fontSize: 12.5, color: c.text3, background: "none", border: "none", cursor: "pointer", padding: 0 };

  return (
    <div style={{ minHeight: "100dvh", background: c.canvas, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", position: "relative", overflow: "hidden" }}>
      {/* ambient accent glow */}
      <div style={{ position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)", width: 720, height: 480, background: `radial-gradient(ellipse at center, ${c.accentSoft} 0%, transparent 65%)`, pointerEvents: "none" }} />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ position: "relative", width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 32 }}>
          <AtlasMark size={32} />
          <span style={{ ...type.title, color: c.text }}>Atlas</span>
        </div>

        <div style={{ width: "100%", background: c.surface1, border: `1px solid ${c.hairline}`, borderRadius: radius.lg, boxShadow: shadow.e2, padding: "28px 28px 24px" }}>

          {!configured && (
            <div style={{ marginBottom: 20, background: c.warningSoft, border: `1px solid rgba(251,184,69,0.32)`, borderRadius: radius.sm, padding: "10px 14px", ...type.caption, color: c.warning, lineHeight: 1.6 }}>
              FIREBASE NOT CONFIGURED<br/>
              <span style={{ color: c.text3 }}>Add VITE_FIREBASE_* keys to .env and restart the dev server.</span>
            </div>
          )}

          {mode === "home" && (
            <>
              <Overline color={c.accent} style={{ marginBottom: 6 }}>Sign in / Create account</Overline>
              <h2 style={{ ...type.title, fontSize: 22, color: c.text, margin: "0 0 22px" }}>Welcome to Atlas</h2>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <SocialBtn icon={<GoogleIcon />} label="Continue with Google" onClick={handleGoogle} disabled={loading || !configured} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
                  <div style={{ flex: 1, height: 1, background: c.hairline }} />
                  <span style={{ ...type.overline, color: c.text3 }}>or</span>
                  <div style={{ flex: 1, height: 1, background: c.hairline }} />
                </div>
                <SocialBtn icon={<MailIcon />} label="Continue with Email" onClick={() => setMode("email")} disabled={loading || !configured} />
                <SocialBtn icon={<PhoneIcon />} label="Continue with Phone" onClick={() => setMode("phone")} disabled={loading || !configured} />
              </div>

              {error && <div style={{ marginTop: 16, ...type.caption, color: c.negative }}>{error}</div>}
            </>
          )}

          {mode === "email" && (
            <>
              <button onClick={() => { setMode("home"); setError(""); setInfo(""); }} style={{ ...linkBtn, marginBottom: 18 }}>← Back</button>
              <Overline color={c.accent} style={{ marginBottom: 14 }}>
                {emailMode === "signin" ? "Sign in" : emailMode === "signup" ? "Create account" : "Reset password"}
              </Overline>
              <form onSubmit={handleEmail} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Input placeholder="Email address" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
                {emailMode !== "reset" && (
                  <Input placeholder="Password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
                )}
                <Button type="submit" size="lg" full loading={loading} disabled={!configured} glow>
                  {emailMode === "signin" ? "Sign in" : emailMode === "signup" ? "Create account" : "Send reset email"}
                </Button>
              </form>
              {info && <div style={{ marginTop: 12, ...type.caption, color: c.positive }}>{info}</div>}
              {error && <div style={{ marginTop: 12, ...type.caption, color: c.negative }}>{error}</div>}
              <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
                {emailMode !== "signup" && <button onClick={() => { setEmailMode("signup"); setError(""); setInfo(""); }} style={linkBtn}>Create account</button>}
                {emailMode !== "signin" && <button onClick={() => { setEmailMode("signin"); setError(""); setInfo(""); }} style={linkBtn}>Sign in</button>}
                {emailMode === "signin" && <button onClick={() => { setEmailMode("reset"); setError(""); setInfo(""); }} style={{ ...linkBtn, marginLeft: "auto" }}>Forgot password?</button>}
              </div>
            </>
          )}

          {mode === "phone" && (
            <>
              <button onClick={() => { setMode("home"); setError(""); setInfo(""); setConfirmResult(null); }} style={{ ...linkBtn, marginBottom: 18 }}>← Back</button>
              <Overline color={c.accent} style={{ marginBottom: 14 }}>Phone sign in</Overline>
              {!confirmResult ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <Input placeholder="+1 555 000 0000" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} autoFocus />
                  <div style={{ ...type.caption, color: c.text3 }}>Include country code (e.g. +1 for US)</div>
                  <Button size="lg" full loading={loading} disabled={!configured} onClick={handleSendOtp} glow>Send code</Button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ ...type.caption, color: c.positive, marginBottom: 2 }}>{info}</div>
                  <Input placeholder="6-digit code" type="tel" inputMode="numeric" value={otp} onChange={e => setOtp(e.target.value)} autoFocus />
                  <Button size="lg" full loading={loading} disabled={!configured} onClick={handleVerifyOtp} glow>Verify & sign in</Button>
                </div>
              )}
              {error && <div style={{ marginTop: 12, ...type.caption, color: c.negative }}>{error}</div>}
              <div ref={recaptchaRef} />
            </>
          )}
        </div>

        <p style={{ ...type.caption, color: c.text3, marginTop: 20, textAlign: "center", lineHeight: 1.7, maxWidth: 340 }}>
          Atlas is a research and education tool — not financial advice. Your account keeps your profile and holdings in sync across devices.
        </p>
      </motion.div>
    </div>
  );
}

// ── inline brand/util icons (stroke-consistent) ──
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#FFC107" d="M17.6 9.2c0-.6 0-1.1-.1-1.6H9v3.3h4.8a4 4 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6Z"/><path fill="#FF3D00" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.8v2.3A9 9 0 0 0 9 18Z" transform="translate(0)" opacity="0"/><path fill="#4CAF50" d="M3.9 10.7A5.4 5.4 0 0 1 3.6 9c0-.6.1-1.2.3-1.7V5H.8A9 9 0 0 0 0 9c0 1.5.3 2.8.8 4l3.1-2.3Z"/><path fill="#1976D2" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .8 5l3.1 2.3C4.6 5.2 6.6 3.6 9 3.6Z"/><path fill="#fff" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.8v2.3A9 9 0 0 0 9 18Z"/></svg>
);
const MailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
);
const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
);

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
