import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface Props {
  user: User
  onClose: () => void
  onCreated: () => void
}

export function AddOrgModal({ user, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    onCreated()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-org-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id="add-org-title">New organization</h2>
          <button
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
            disabled={submitting}
          >
            ×
          </button>
        </header>

        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label htmlFor="add-org-name">Organization name</label>
            <input
              id="add-org-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={locked}
              autoFocus
              placeholder="acme-corp"
            />
            <p className="hint">
              You'll be added as the org's owner. Targets and members
              are scoped to the org.
            </p>
          </div>

          {error && <p className="err">{error}</p>}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={locked || !name.trim()}
            >
              {succeeded
                ? 'Created'
                : submitting
                  ? 'Creating…'
                  : 'Create organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
