import { useState } from 'react'
import { Modal } from './Modal'
import { deleteTarget } from '../lib/api'
import type { Target } from '../hooks/useTargets'

interface Props {
  target: Target
  onClose: () => void
  onDeleted: (targetId: string) => void
}

export function DeleteTargetModal({ target, onClose, onDeleted }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await deleteTarget(target.id)
      onDeleted(target.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="delete-target-title">
      <header>
        <h2 id="delete-target-title">Delete target database</h2>
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
          Permanently delete <strong>{target.name}</strong>{' '}
          (<code>{target.host}</code> · <code>{target.database}</code>)?
        </p>
        {target.is_production && (
          <p className="warn">
            <strong>This target is flagged as production.</strong> Deletion
            removes the stored Vault credential and the introspected schema
            snapshot. The target database itself is not modified.
          </p>
        )}
        <p className="hint">
          Re-registering the same database later requires entering the
          password again.
        </p>
        {error && <p className="err">{error}</p>}
      </div>

      <div className="modal-actions">
        <button type="button" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="danger"
        >
          {submitting ? 'Deleting…' : 'Delete target'}
        </button>
      </div>
    </Modal>
  )
}
