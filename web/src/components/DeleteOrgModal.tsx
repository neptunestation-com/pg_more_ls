import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Org } from '../hooks/useOrgs'
import type { Target } from '../hooks/useTargets'

interface Props {
  org: Org
  targets: Target[]
  onClose: () => void
  onDeleted: (orgId: string) => void
}

export function DeleteOrgModal({ org, targets, onClose, onDeleted }: Props) {
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetCount = targets.length
  const confirmMatches = confirmText.trim() === org.name

  async function onConfirm() {
    setSubmitting(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('delete_org', {
      p_org_id: org.id,
    })
    setSubmitting(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    onDeleted(org.id)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-org-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id="delete-org-title">Delete organization</h2>
          <button
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
            disabled={submitting}
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          <p>
            You're about to permanently delete{' '}
            <strong>{org.name}</strong>.
          </p>
          {targetCount > 0 ? (
            <p className="warn">
              This will also delete <strong>{targetCount}</strong>{' '}
              {targetCount === 1 ? 'target database' : 'target databases'} and
              all introspected schema data. Stored credentials in Vault will be
              removed.
            </p>
          ) : (
            <p className="hint">This organization has no target databases.</p>
          )}
          <div className="form-row">
            <label htmlFor="delete-org-confirm">
              Type <code>{org.name}</code> to confirm:
            </label>
            <input
              id="delete-org-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={submitting}
              placeholder={org.name}
              autoFocus
            />
          </div>
          {error && <p className="err">{error}</p>}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmMatches || submitting}
            className="danger"
          >
            {submitting ? 'Deleting…' : 'Delete organization'}
          </button>
        </div>
      </div>
    </div>
  )
}
