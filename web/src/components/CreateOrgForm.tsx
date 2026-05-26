import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface Props {
  user: User
}

/**
 * Shown when the signed-in user is a member of no orgs. Creates one
 * with the trigger auto-adding the creator as `owner`.
 */
export function CreateOrgForm({ user }: Props) {
  const [name, setName] = useState(suggestedOrgName(user))
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Once an insert succeeds, this form should unmount when Realtime
  // delivers the new orgs row and the parent flips to <Workspaces />.
  // If Realtime stalls, we still stay locked so a frustrated user can't
  // rapid-click their way to seven duplicate orgs (the original bug).
  const locked = submitting || succeeded

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (locked) return
    setSubmitting(true)
    setError(null)
    const { error: insertError } = await supabase
      .from('orgs')
      .insert({ name: name.trim(), created_by: user.id })
    if (insertError) {
      setSubmitting(false)
      setError(insertError.message)
      return
    }
    setSucceeded(true)
    // Intentionally leave `submitting` true so the form stays locked
    // until the parent unmounts us.
  }

  return (
    <div className="card create-org-card">
      <h2>Welcome</h2>
      <p>
        You're signed in but not yet in any organization. Create one to
        start adding target databases.
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="org-name">Organization name</label>
        <input
          id="org-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={locked}
        />
        <button type="submit" disabled={locked || !name.trim()}>
          {succeeded
            ? 'Created'
            : submitting
              ? 'Creating…'
              : 'Create organization'}
        </button>
      </form>
      {succeeded && (
        <p className="ok">Created — loading your workspace…</p>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  )
}

function suggestedOrgName(user: User): string {
  const local = user.email?.split('@')[0] ?? 'My'
  return `${local}'s org`
}
