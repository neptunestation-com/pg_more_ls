import { useMemo, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { TableNode, type TableNodeData } from './TableNode'
import { ParallelEdge, type ParallelEdgeData } from './ParallelEdge'
import { enqueueIntrospect } from '../lib/api'
import {
  useSchemaSnapshot,
  type SchemaColumn,
  type SchemaRelationship,
  type SchemaTable,
} from '../hooks/useSchemaSnapshot'

interface Props {
  targetId: string
  lastIntrospectedAt: string | null
}

const NODE_WIDTH = 240
const NODE_HEIGHT = 140

const nodeTypes: NodeTypes = { table: TableNode }
const edgeTypes: EdgeTypes = { parallel: ParallelEdge }

export function SchemaOverlay({ targetId, lastIntrospectedAt }: Props) {
  const { snapshot, error } = useSchemaSnapshot(targetId)
  const [refreshState, setRefreshState] = useState<
    'idle' | 'refreshing' | 'queued' | { error: string }
  >('idle')

  const { nodes, edges } = useMemo(() => {
    if (!snapshot) return { nodes: [], edges: [] }
    return buildGraph(snapshot.tables, snapshot.columns, snapshot.relationships)
  }, [snapshot])

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

      <div className="overlay-canvas">
        {snapshot && snapshot.tables.length === 0 ? (
          <div className="overlay-empty">
            <p>No tables yet for this target.</p>
            <p>
              Click <strong>Refresh schema</strong> — the worker will
              introspect the target's <code>public</code> schema and the graph
              will appear here.
            </p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            zoomOnDoubleClick={false}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>

      <div className="legend">
        <span className="legend-item">
          <span className="legend-swatch status-red" aria-hidden="true" />
          <span className="legend-glyph" aria-hidden="true">⚠</span>
          no RLS (dashed)
        </span>
        <span className="legend-item">
          <span className="legend-swatch status-yellow" aria-hidden="true" />
          RLS on, no proofs yet (solid)
        </span>
        <span className="legend-item dimmed">
          <span className="legend-swatch status-green" aria-hidden="true" />
          <span className="legend-glyph" aria-hidden="true">✓</span>
          proven safe (double) — Phase 4
        </span>
      </div>
    </div>
  )
}

function buildGraph(
  tables: SchemaTable[],
  columns: SchemaColumn[],
  relationships: SchemaRelationship[],
): { nodes: Node[]; edges: Edge[] } {
  // Group columns by table for the node data payload.
  const colsByTable = new Map<string, SchemaColumn[]>()
  for (const c of columns) {
    const list = colsByTable.get(c.table_id) ?? []
    list.push(c)
    colsByTable.set(c.table_id, list)
  }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 90, marginx: 24, marginy: 24 })

  for (const t of tables) {
    g.setNode(t.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const r of relationships) {
    g.setEdge(r.source_table_id, r.target_table_id)
  }
  dagre.layout(g)

  const nodes: Node[] = tables.map((t) => {
    const pos = g.node(t.id)
    const cols = colsByTable.get(t.id) ?? []
    const data: TableNodeData = {
      tableName: t.table_name,
      schemaName: t.schema_name,
      hasRls: t.has_rls,
      rlsForced: t.rls_forced,
      governanceStatus: t.governance_status,
      columnCount: cols.length,
      columns: cols.map((c) => ({ name: c.name, dataType: c.data_type })),
    }
    return {
      id: t.id,
      type: 'table',
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      data: data as unknown as Record<string, unknown>,
    }
  })

  // Group relationships by their (source, target) node pair so the
  // custom edge type can fan parallel edges apart. With React Flow's
  // default bezier, two edges with the same endpoints render on top
  // of each other and one FK becomes invisible.
  const bundleKeys = relationships.map(
    (r) => `${r.source_table_id}\x00${r.target_table_id}`,
  )
  const bundleSize = new Map<string, number>()
  for (const k of bundleKeys) bundleSize.set(k, (bundleSize.get(k) ?? 0) + 1)
  const bundleIndex = new Map<string, number>()

  const edges: Edge[] = relationships.map((r, i) => {
    const key = bundleKeys[i]
    const total = bundleSize.get(key)!
    const idx = bundleIndex.get(key) ?? 0
    bundleIndex.set(key, idx + 1)
    const data: ParallelEdgeData = {
      index: idx,
      total,
      label: `${r.source_column} → ${r.target_column}`,
    }
    return {
      id: r.id,
      source: r.source_table_id,
      target: r.target_table_id,
      type: 'parallel',
      data: data as unknown as Record<string, unknown>,
      style: { stroke: 'var(--text-muted)', strokeWidth: 1.5 },
    }
  })

  return { nodes, edges }
}
