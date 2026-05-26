import { useState } from 'react'
import { Modal } from './Modal'
import { createTarget } from '../lib/api'
import type { Org } from '../hooks/useOrgs'

interface Props {
  orgs: Org[]
  defaultOrgId?: string
  onClose: () => void
  onCreated: (id: string) => void
}

export function AddTargetModal({ orgs, defaultOrgId, onClose, onCreated }: Props) {
  const [orgId, setOrgId] = useState(defaultOrgId ?? orgs[0]?.id ?? '')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('5432')
  const [database, setDatabase] = useState('postgres')
  const [username, setUsername] = useState('postgres')
  const [password, setPassword] = useState('')
  const [isProduction, setIsProduction] = useState(false)
  const [sslMode, setSslMode] = useState('require')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) {
      setError('No organization selected')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { id } = await createTarget({
        orgId,
        name: name.trim(),
        host: host.trim(),
        port: parseInt(port, 10),
        database: database.trim(),
        username: username.trim(),
        password,
        isProduction,
        sslMode,
      })
      onCreated(id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="add-target-title">
      <header>
          <h2 id="add-target-title">Add target database</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label htmlFor="t-org">Organization</label>
            <select
              id="t-org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              disabled={submitting || orgs.length <= 1}
              required
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label htmlFor="t-name">Display name</label>
            <input
              id="t-name"
              type="text"
              required
              placeholder="prod-db"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="form-row two-col">
            <div>
              <label htmlFor="t-host">Host</label>
              <input
                id="t-host"
                type="text"
                required
                placeholder="db.example.com"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="t-port">Port</label>
              <input
                id="t-port"
                type="number"
                required
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="form-row two-col">
            <div>
              <label htmlFor="t-db">Database</label>
              <input
                id="t-db"
                type="text"
                required
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="t-user">Username</label>
              <input
                id="t-user"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="t-pass">Password</label>
            <input
              id="t-pass"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <p className="hint">
              Stored encrypted in Supabase Vault; the api decrypts it
              only at introspect time.
            </p>
          </div>

          <div className="form-row two-col">
            <div>
              <label htmlFor="t-ssl">SSL mode</label>
              <select
                id="t-ssl"
                value={sslMode}
                onChange={(e) => setSslMode(e.target.value)}
                disabled={submitting}
              >
                {['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].map(
                  (m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ),
                )}
              </select>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={isProduction}
                onChange={(e) => setIsProduction(e.target.checked)}
                disabled={submitting}
              />
              Production database
            </label>
          </div>

          {error && <p className="err">{error}</p>}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Add target'}
            </button>
          </div>
        </form>
    </Modal>
  )
}
