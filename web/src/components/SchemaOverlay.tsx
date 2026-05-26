import { useState } from 'react'
import { SchemaGraph } from './SchemaGraph'
import { enqueueIntrospect } from '../lib/api'
import { useSchemaSnapshot } from '../hooks/useSchemaSnapshot'

interface Props {
  targetId: string
  lastIntrospectedAt: string | null
}

export function SchemaOverlay({ targetId, lastIntrospectedAt }: Props) {
  const { snapshot, error } = useSchemaSnapshot(targetId)
  const [refreshState, setRefreshState] = useState<
    'idle' | 'refreshing' | 'queued' | { error: string }
  >('idle')

  async function refresh() {
    setRefreshState('refreshing')
    try {
      await enqueueIntrospect(targetId)
      setRefreshState('queued')
      // Realtime will repopulate the graph when the worker finishes;
      // clear the "queued" pill after a few seconds.
      setTimeout(() => setRefreshState('idle'), 4000)
    } catch (e) {
      setRefreshState({ error: (e as Error).message })
    }
  }

  return (
    <div className="schema-overlay">
      <div className="overlay-toolbar">
        <div className="overlay-status">
          {lastIntrospectedAt ? (
            <>
              Last introspected:{' '}
              <strong>{new Date(lastIntrospectedAt).toLocaleString()}</strong>
            </>
          ) : (
            <em>Never introspected — click Refresh to populate the graph.</em>
          )}
        </div>
        <div className="overlay-actions">
          {refreshState === 'queued' && (
            <span className="overlay-pill ok">
              queued — graph updates when the worker finishes
            </span>
          )}
          {typeof refreshState === 'object' && 'error' in refreshState && (
            <span className="overlay-pill err">{refreshState.error}</span>
          )}
          <button
            onClick={refresh}
            disabled={refreshState === 'refreshing'}
            className="refresh-btn"
          >
            {refreshState === 'refreshing' ? 'Requesting…' : 'Refresh schema'}
          </button>
        </div>
      </div>

      {error && <p className="err">{error}</p>}

      <SchemaGraph
        tables={snapshot?.tables ?? []}
        columns={snapshot?.columns ?? []}
        relationships={snapshot?.relationships ?? []}
      />
    </div>
  )
}
