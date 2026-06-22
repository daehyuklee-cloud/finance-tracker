import { useState, useEffect } from "react";
import { supabase } from "./db";
import { signInWithGoogle, signOut } from "./auth";
import FinanceTracker from "./tracker/FinanceTracker";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", color: "#0f172a", fontFamily: "system-ui" }}>
      Loading…
    </div>
  );

  if (!session) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: 16 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>💰</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>acountee</div>
        <div style={{ fontSize: 14, color: "#64748b", marginBottom: 32 }}>Managing Your Finances in One Place</div>
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

  return (
    <FinanceTracker
      userId={session.user.id}
      userEmail={session.user.email}
      userName={session.user.user_metadata?.full_name || session.user.user_metadata?.name || ""}
      userPhoto={session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || ""}
      onSignOut={signOut}
    />
  );
}
