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
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error: insertError } = await supabase
      .from('orgs')
      .insert({ name: name.trim(), created_by: user.id })
    setSubmitting(false)
    if (insertError) {
      setError(insertError.message)
    }
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
          disabled={submitting}
        />
        <button type="submit" disabled={submitting || !name.trim()}>
          {submitting ? 'Creating…' : 'Create organization'}
        </button>
      </form>
      {error && <p className="err">{error}</p>}
    </div>
  )
}

function suggestedOrgName(user: User): string {
  const local = user.email?.split('@')[0] ?? 'My'
  return `${local}'s org`
}
