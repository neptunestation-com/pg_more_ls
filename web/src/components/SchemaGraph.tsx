import { useMemo } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
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
            fitViewOptions={{
              // Tighter than the React Flow default (0.1) — less empty
              // canvas around the graph, more readable detail.
              padding: 0.05,
              // Cap zoom-in so a small schema (e.g. 1-2 tables) doesn't
              // scale to absurd size; keep zoom-out generous so large
              // schemas can fit on screen.
              maxZoom: 1,
              minZoom: 0.2,
            }}
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
