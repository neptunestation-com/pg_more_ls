import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'
import type {
  SchemaColumn,
  SchemaRelationship,
  SchemaTable,
} from '../hooks/useSchemaSnapshot'
import type { TableNodeData } from '../components/TableNode'
import type { ParallelEdgeData } from '../components/ParallelEdge'

export const NODE_WIDTH = 240
export const NODE_HEIGHT = 140

/**
 * Lay out the introspected schema as React Flow nodes + edges.
 *
 * Pure function: no React, no IO, no DOM. Exported so it can be
 * exercised from Vitest without mounting the canvas.
 */
export function buildGraph(
  tables: SchemaTable[],
  columns: SchemaColumn[],
  relationships: SchemaRelationship[],
): { nodes: Node[]; edges: Edge[] } {
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
  // custom edge type can fan parallel edges apart.
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
