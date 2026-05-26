import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { useOrgs } from './hooks/useOrgs'
import { useTargets } from './hooks/useTargets'
import { CreateOrgForm } from './components/CreateOrgForm'
import { SchemaOverlay } from './components/SchemaOverlay'
import { Sidebar } from './components/Sidebar'
import './App.css'

function App() {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s),
    )
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!session) {
    return <SignIn />
  }
  return <Workspaces session={session} />
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'sending' | 'sent' | { error: string }
  >('idle')

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) setStatus({ error: error.message })
    else setStatus('sent')
  }

  return (
    <main className="container">
      <header className="page-header">
        <h1>pg-policy-engine</h1>
        <p className="tagline">Web app POC</p>
      </header>

      <section className="card">
        <h2>Sign in</h2>
        <p>Enter your email — we'll send a magic link.</p>
        <form onSubmit={send}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === 'sending' || status === 'sent'}
          />
          <button
            type="submit"
            disabled={status === 'sending' || status === 'sent'}
          >
            {status === 'sending' ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
        {status === 'sent' && <p className="ok">Check your inbox for a sign-in link.</p>}
        {typeof status === 'object' && 'error' in status && (
          <p className="err">Error: {status.error}</p>
        )}
      </section>
    </main>
  )
}

function Workspaces({ session }: { session: Session }) {
  const { orgs, loading: orgsLoading } = useOrgs()
  const { targets, loading: targetsLoading } = useTargets()
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)

  const selectedTarget = targets.find((t) => t.id === selectedTargetId) ?? null

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>pg-policy-engine</h1>
        <div className="user-bar">
          <span className="user-email">{session.user.email}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="app-body">
        {orgsLoading || targetsLoading ? (
          <main className="main-area">
            <p className="placeholder">Loading…</p>
          </main>
        ) : orgs.length === 0 ? (
          <main className="main-area">
            <CreateOrgForm user={session.user} />
          </main>
        ) : (
          <>
            <Sidebar
              orgs={orgs}
              targets={targets}
              selectedTargetId={selectedTargetId}
              onSelectTarget={setSelectedTargetId}
            />
            <main className="main-area">
              {selectedTarget ? (
                <WorkspaceView target={selectedTarget} />
              ) : (
                <div className="placeholder">
                  <h2>Select a target from the sidebar</h2>
                  <p>
                    Or click "+ Add target" to register a new PostgreSQL
                    database. The schema overlay (Phase 1.7) renders here
                    once a target is selected.
                  </p>
                </div>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  )
}

function WorkspaceView({
  target,
}: {
  target: {
    id: string
    name: string
    host: string
    database: string
    is_production: boolean
    last_introspected_at: string | null
  }
}) {
  return (
    <section className="workspace-view">
      <header>
        <h2>{target.name}</h2>
        {target.is_production && <span className="prod-tag">prod</span>}
        <span className="target-host">
          <code>{target.host}</code> · <code>{target.database}</code>
        </span>
      </header>
      <SchemaOverlay
        targetId={target.id}
        lastIntrospectedAt={target.last_introspected_at}
      />
    </section>
  )
}

export default App
