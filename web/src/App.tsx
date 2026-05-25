import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import './App.css'

type ApiCheck =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; body: string }
  | { state: 'error'; message: string }

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [magicLinkStatus, setMagicLinkStatus] = useState<
    'idle' | 'sending' | 'sent' | { error: string }
  >('idle')
  const [apiCheck, setApiCheck] = useState<ApiCheck>({ state: 'idle' })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s),
    )
    return () => sub.subscription.unsubscribe()
  }, [])

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setMagicLinkStatus('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) {
      setMagicLinkStatus({ error: error.message })
    } else {
      setMagicLinkStatus('sent')
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setMagicLinkStatus('idle')
    setApiCheck({ state: 'idle' })
  }

  async function callHealthz() {
    setApiCheck({ state: 'loading' })
    const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'
    try {
      const res = await fetch(`${baseUrl}/healthz`, {
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      const body = await res.text()
      setApiCheck(
        res.ok
          ? { state: 'ok', body }
          : { state: 'error', message: `HTTP ${res.status}: ${body}` },
      )
    } catch (err) {
      setApiCheck({ state: 'error', message: (err as Error).message })
    }
  }

  return (
    <main className="container">
      <header>
        <h1>pg-policy-engine</h1>
        <p className="tagline">Web app POC — Phase 0.4 scaffold</p>
      </header>

      {session ? (
        <section className="card">
          <h2>Signed in</h2>
          <p>
            as <strong>{session.user.email}</strong>
          </p>
          <button onClick={signOut}>Sign out</button>
        </section>
      ) : (
        <section className="card">
          <h2>Sign in</h2>
          <p>Enter your email — we'll send a magic link.</p>
          <form onSubmit={sendMagicLink}>
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={magicLinkStatus === 'sending' || magicLinkStatus === 'sent'}
            />
            <button
              type="submit"
              disabled={magicLinkStatus === 'sending' || magicLinkStatus === 'sent'}
            >
              {magicLinkStatus === 'sending' ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
          {magicLinkStatus === 'sent' && (
            <p className="ok">Check your inbox for a sign-in link.</p>
          )}
          {typeof magicLinkStatus === 'object' && 'error' in magicLinkStatus && (
            <p className="err">Error: {magicLinkStatus.error}</p>
          )}
        </section>
      )}

      <section className="card">
        <h2>Engine api</h2>
        <p>
          GETs <code>/healthz</code> on the Ktor service ({' '}
          <code>{import.meta.env.VITE_API_URL ?? 'http://localhost:8080'}</code>
          ).
        </p>
        <button onClick={callHealthz} disabled={apiCheck.state === 'loading'}>
          {apiCheck.state === 'loading' ? 'Calling…' : 'Call /healthz'}
        </button>
        {apiCheck.state === 'ok' && (
          <pre className="ok">{apiCheck.body}</pre>
        )}
        {apiCheck.state === 'error' && (
          <pre className="err">{apiCheck.message}</pre>
        )}
      </section>
    </main>
  )
}

export default App
