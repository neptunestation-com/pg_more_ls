import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Org } from '../hooks/useOrgs'
import type { Target } from '../hooks/useTargets'
import { AddOrgModal } from './AddOrgModal'
import { AddTargetModal } from './AddTargetModal'
import { DeleteOrgModal } from './DeleteOrgModal'
import { DeleteTargetModal } from './DeleteTargetModal'

interface Props {
  user: User
  orgs: Org[]
  targets: Target[]
  selectedTargetId: string | null
  onSelectTarget: (id: string) => void
}

export function Sidebar({
  user,
  orgs,
  targets,
  selectedTargetId,
  onSelectTarget,
}: Props) {
  const [addModalOrgId, setAddModalOrgId] = useState<string | null>(null)
  const [deleteOrgId, setDeleteOrgId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [addOrgOpen, setAddOrgOpen] = useState(false)

  const deleteOrg = orgs.find((o) => o.id === deleteOrgId) ?? null
  const deleteOrgTargets = deleteOrg
    ? targets.filter((t) => t.org_id === deleteOrg.id)
    : []
  const targetToDelete = targets.find((t) => t.id === deleteTargetId) ?? null

  return (
    <>
      <aside className="sidebar">
        {orgs.map((org) => {
          const orgTargets = targets.filter((t) => t.org_id === org.id)
          return (
            <section key={org.id} className="sidebar-org">
              <header>
                <h3>{org.name}</h3>
                <button
                  type="button"
                  className="sidebar-org-delete"
                  onClick={() => setDeleteOrgId(org.id)}
                  aria-label={`Delete organization ${org.name}`}
                  title="Delete organization"
                >
                  ×
                </button>
              </header>
              {orgTargets.length === 0 ? (
                <p className="sidebar-empty">No targets yet</p>
              ) : (
                <ul className="sidebar-targets">
                  {orgTargets.map((t) => (
                    <li key={t.id} className="sidebar-target-row">
                      <button
                        className={
                          t.id === selectedTargetId
                            ? 'sidebar-target active'
                            : 'sidebar-target'
                        }
                        onClick={() => onSelectTarget(t.id)}
                      >
                        <span className="target-name">{t.name}</span>
                        {t.is_production && (
                          <span className="prod-tag" aria-label="production">
                            prod
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="sidebar-target-delete"
                        onClick={() => setDeleteTargetId(t.id)}
                        aria-label={`Delete target ${t.name}`}
                        title="Delete target"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                className="sidebar-add"
                onClick={() => setAddModalOrgId(org.id)}
              >
                + Add target
              </button>
            </section>
          )
        })}
        <button
          className="sidebar-add-org"
          onClick={() => setAddOrgOpen(true)}
        >
          + Add organization
        </button>
      </aside>

      {addModalOrgId && (
        <AddTargetModal
          orgs={orgs}
          defaultOrgId={addModalOrgId}
          onClose={() => setAddModalOrgId(null)}
          onCreated={(id) => {
            setAddModalOrgId(null)
            onSelectTarget(id)
          }}
        />
      )}

      {deleteOrg && (
        <DeleteOrgModal
          org={deleteOrg}
          targets={deleteOrgTargets}
          onClose={() => setDeleteOrgId(null)}
          onDeleted={() => setDeleteOrgId(null)}
        />
      )}

      {targetToDelete && (
        <DeleteTargetModal
          target={targetToDelete}
          onClose={() => setDeleteTargetId(null)}
          onDeleted={() => setDeleteTargetId(null)}
        />
      )}

      {addOrgOpen && (
        <AddOrgModal
          user={user}
          onClose={() => setAddOrgOpen(false)}
          onCreated={() => setAddOrgOpen(false)}
        />
      )}
    </>
  )
}
