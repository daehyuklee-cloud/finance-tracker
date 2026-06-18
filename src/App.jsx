import { useState, useEffect } from 'react'
import { supabase } from './db'
import { signInWithGoogle, signOut } from './auth'
import FinanceTracker from './tracker/FinanceTracker'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div style={{minHeight:'100vh',background:'#0f1117',display:'flex',alignItems:'center',justifyContent:'center',color:'#f1f5f9',fontFamily:'system-ui'}}>
      Loading…
    </div>
  )

  if (!session) return (
    <div style={{minHeight:'100vh',background:'#0f1117',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:32,marginBottom:8}}>💰</div>
        <div style={{fontSize:24,fontWeight:700,color:'#f1f5f9',marginBottom:8}}>Finance Tracker</div>
        <div style={{fontSize:14,color:'#475569',marginBottom:32}}>Managing Your Finances in One Place</div>
        <button onClick={signInWithGoogle} style={{background:'#fff',color:'#1e2130',border:'none',borderRadius:10,padding:'12px 28px',fontSize:15,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:10,margin:'0 auto'}}>
          <img src="https://www.google.com/favicon.ico" width={18} height={18} alt="G"/>
          Sign in with Google
        </button>
      </div>
    </div>
  )

  return <FinanceTracker userId={session.user.id} userEmail={session.user.email} onSignOut={signOut}/>
}
