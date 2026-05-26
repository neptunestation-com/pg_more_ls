import { useEffect, useMemo } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { TableNode } from './TableNode'
import { ParallelEdge } from './ParallelEdge'
import { buildGraph } from '../lib/schemaGraph'
import type {
  SchemaColumn,
  SchemaRelationship,
  SchemaTable,
} from '../hooks/useSchemaSnapshot'

interface Props {
  tables: SchemaTable[]
  columns: SchemaColumn[]
  relationships: SchemaRelationship[]
}

const nodeTypes: NodeTypes = { table: TableNode }
const edgeTypes: EdgeTypes = { parallel: ParallelEdge }

const FIT_OPTIONS = { padding: 0.05, maxZoom: 1, minZoom: 0.2 }

/**
 * Re-fits the React Flow viewport whenever the schema data changes.
 * React Flow's `fitView` prop only runs on the very first mount, so
 * switching scenarios in the demo route (or switching targets in
 * production) would leave the viewport on the previous graph's zoom.
 *
 * Must be a child of <ReactFlow> so useReactFlow() finds the context.
 */
function AutoFit({ trigger }: { trigger: string }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    // Defer to the next animation frame so React Flow has reconciled
    // the new node positions before we measure to fit.
    const raf = requestAnimationFrame(() => {
      fitView({ ...FIT_OPTIONS, duration: 250 })
    })
    return () => cancelAnimationFrame(raf)
  }, [trigger, fitView])
  return null
}

/**
 * Presentational: takes a schema snapshot and renders the React Flow
 * canvas + legend + empty-state. No data fetching. Used by both the
 * production SchemaOverlay (which fetches via Realtime) and the demo
 * fixtures route at /dev/overlay.
 */
export function SchemaGraph({ tables, columns, relationships }: Props) {
  const { nodes, edges } = useMemo(
    () => buildGraph(tables, columns, relationships),
    [tables, columns, relationships],
  )

  // Stable trigger string for AutoFit — changes whenever the topology
  // does. Uses ids + counts so reordering inside the same set doesn't
  // trigger a re-fit (would be jarring).
  const fitTrigger = useMemo(
    () =>
      `${tables.length}|${relationships.length}|${tables
        .map((t) => t.id)
        .join(',')}`,
    [tables, relationships.length],
  )

  return (
    <>
      <div className="overlay-canvas">
        {tables.length === 0 ? (
          <div className="overlay-empty">
            <p>No tables in this snapshot.</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={FIT_OPTIONS}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            zoomOnDoubleClick={false}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
            <AutoFit trigger={fitTrigger} />
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
    </>
  )
}
