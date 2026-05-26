import { useState } from 'react'
import { SchemaGraph } from './SchemaGraph'
import { SCENARIOS } from '../lib/overlayFixtures'

/**
 * Fixtures-based visual harness for SchemaGraph.
 *
 * Mounted at /dev/overlay (see App.tsx). Lets us flip through schema
 * shapes that would otherwise require introspecting a real database —
 * empty, wide, parallel FKs, cycles, big-fan-out, etc. — to verify
 * visual changes without touching the backend.
 *
 * Add a new scenario in src/lib/overlayFixtures.ts and it appears here
 * automatically.
 */
export function OverlayDemo() {
  const [key, setKey] = useState(SCENARIOS[0].key)
  const scenario = SCENARIOS.find((s) => s.key === key) ?? SCENARIOS[0]

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>
          pg-policy-engine <span className="dev-pill">dev</span>
        </h1>
        <div className="user-bar">
          <span className="user-email">/dev/overlay</span>
          <a href="/" className="link-button">
            ← back to app
          </a>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <section className="sidebar-org">
            <header>
              <h3>Scenarios</h3>
            </header>
            <ul className="sidebar-targets">
              {SCENARIOS.map((s) => (
                <li key={s.key} className="sidebar-target-row">
                  <button
                    type="button"
                    className={
                      s.key === key
                        ? 'sidebar-target active'
                        : 'sidebar-target'
                    }
                    onClick={() => setKey(s.key)}
                    title={s.description}
                  >
                    <span className="target-name">{s.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main className="main-area">
          <section className="workspace-view">
            <header>
              <h2>{scenario.title}</h2>
              <span className="target-host">
                <code>{scenario.key}</code>
              </span>
            </header>
            <div className="schema-overlay">
              <div className="overlay-toolbar">
                <div className="overlay-status">{scenario.description}</div>
                <div className="overlay-actions">
                  <span className="overlay-pill ok">
                    {scenario.snapshot.tables.length} tables ·{' '}
                    {scenario.snapshot.relationships.length} fks
                  </span>
                </div>
              </div>
              <SchemaGraph
                tables={scenario.snapshot.tables}
                columns={scenario.snapshot.columns}
                relationships={scenario.snapshot.relationships}
              />
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
