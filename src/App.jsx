import { useState, useEffect, useRef } from "react";
import { supabase } from "./db";
import { signInWithGoogle, signOut } from "./auth";
import FinanceTracker from "./tracker/FinanceTracker";
import { isLockEnabled, isWebAuthnSupported, hasWebAuthnCredential, hasPin, verifyWebAuthn, verifyPin, cacheUser, getCachedUser, clearCachedUser } from "./lock";

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function LockScreen({ onUnlocked, onGiveUp }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [tryingBiometric, setTryingBiometric] = useState(isWebAuthnSupported() && hasWebAuthnCredential());
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (isWebAuthnSupported() && hasWebAuthnCredential()) {
      verifyWebAuthn().then(onUnlocked).catch(() => { setTryingBiometric(false); setErr("Couldn't verify — try again or use your PIN."); });
    } else {
      setTryingBiometric(false);
    }
  // eslint-disable-next-line
  }, []);

  const retryBiometric = () => {
    setErr(""); setTryingBiometric(true);
    verifyWebAuthn().then(onUnlocked).catch(() => { setTryingBiometric(false); setErr("Couldn't verify — try again or use your PIN."); });
  };
  const submitPin = async e => {
    e.preventDefault();
    if (await verifyPin(pin)) onUnlocked();
    else setErr("Wrong PIN.");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: 16 }}>
      <div style={{ textAlign: "center", maxWidth: 320, width: "100%" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>acountee is locked</div>
        {tryingBiometric && <div style={{ fontSize: 14, color: "#64748b", marginBottom: 20 }}>Waiting for Face ID / Touch ID…</div>}
        {!tryingBiometric && isWebAuthnSupported() && hasWebAuthnCredential() && (
          <button onClick={retryBiometric} style={{ width: "100%", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 600, cursor: "pointer", marginBottom: 12 }}>
            Unlock with Face ID / Touch ID
          </button>
        )}
        {hasPin() && (
          <form onSubmit={submitPin} style={{ marginTop: 8 }}>
            <input
              type="password" inputMode="numeric" autoFocus={!hasWebAuthnCredential()} value={pin}
              onChange={e => { setPin(e.target.value); setErr(""); }} placeholder="Enter PIN"
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 15, textAlign: "center", letterSpacing: 4, boxSizing: "border-box", marginBottom: 10 }}
            />
            <button type="submit" style={{ width: "100%", background: "#0f172a", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Unlock with PIN</button>
          </form>
        )}
        {err && <div style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>{err}</div>}
        <button onClick={onGiveUp} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 12, marginTop: 24, cursor: "pointer", textDecoration: "underline" }}>Sign out instead</button>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [offlineUser, setOfflineUser] = useState(null); // cached identity used when Supabase can't be reached
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(!isLockEnabled());

  useEffect(() => {
    withTimeout(supabase.auth.getSession(), 6000)
      .then(({ data }) => {
        setSession(data.session);
        if (data.session?.user) cacheUser(data.session.user);
        setLoading(false);
      })
      .catch(() => {
        // Offline, or the token needed a refresh we couldn't make — fall
        // back to the last known signed-in user so the app stays usable
        // against locally cached data instead of stranding you on a
        // sign-in screen that needs network to complete.
        const cached = getCachedUser();
        if (cached) setOfflineUser(cached);
        setLoading(false);
      });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) cacheUser(s.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  const activeUser = session?.user || offlineUser;

  const handleSignOut = () => {
    clearCachedUser();
    setOfflineUser(null);
    signOut();
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", color: "#0f172a", fontFamily: "system-ui" }}>
      Loading…
    </div>
  );

  if (!activeUser) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: 16 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>💰</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>acountee</div>
        <div style={{ fontSize: 14, color: "#64748b", marginBottom: 8 }}>Managing Your Finances in One Place</div>
        {!navigator.onLine && <div style={{ fontSize: 13, color: "#F97316", marginBottom: 24 }}>You're offline, and there's no previous sign-in cached on this device.</div>}
        <button
          onClick={signInWithGoogle}
          style={{ background: "#fff", color: "#0f172a", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 28px", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, margin: "0 auto", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
        >
          <img src="https://www.google.com/favicon.ico" width={18} height={18} alt="G" />
          Sign in with Google
        </button>
      </div>
    </div>
  );

  if (!unlocked) return <LockScreen onUnlocked={() => setUnlocked(true)} onGiveUp={handleSignOut} />;

  return (
    <FinanceTracker
      userId={activeUser.id}
      userEmail={activeUser.email}
      userName={activeUser.user_metadata?.full_name || activeUser.user_metadata?.name || ""}
      userPhoto={activeUser.user_metadata?.avatar_url || activeUser.user_metadata?.picture || ""}
      isOffline={!session && !!offlineUser}
      onSignOut={handleSignOut}
    />
  );
}
