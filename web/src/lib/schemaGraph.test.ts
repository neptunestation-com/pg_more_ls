import { describe, expect, it } from 'vitest'
import { buildGraph } from './schemaGraph'
import type {
  SchemaColumn,
  SchemaRelationship,
  SchemaTable,
} from '../hooks/useSchemaSnapshot'
import type { ParallelEdgeData } from '../components/ParallelEdge'

const TARGET = '00000000-0000-0000-0000-000000000fff'

function tbl(id: string, name = id): SchemaTable {
  return {
    id,
    target_id: TARGET,
    schema_name: 'public',
    table_name: name,
    has_rls: false,
    rls_forced: false,
    governance_status: 'red',
    last_seen_at: '2026-05-26T00:00:00Z',
  }
}

function col(table_id: string, name: string, ordinal: number): SchemaColumn {
  return {
    id: `${table_id}.${name}`,
    table_id,
    name,
    data_type: 'text',
    is_nullable: false,
    ordinal,
  }
}

function rel(
  id: string,
  src: string,
  srcCol: string,
  dst: string,
  dstCol: string,
): SchemaRelationship {
  return {
    id,
    target_id: TARGET,
    source_table_id: src,
    source_column: srcCol,
    target_table_id: dst,
    target_column: dstCol,
    constraint_name: id,
  }
}

function dataOf(edge: { data?: unknown }): ParallelEdgeData {
  return edge.data as ParallelEdgeData
}

describe('buildGraph', () => {
  it('emits one node per table with the correct type', () => {
    const { nodes } = buildGraph([tbl('a'), tbl('b')], [], [])
    expect(nodes).toHaveLength(2)
    expect(nodes.every((n) => n.type === 'table')).toBe(true)
    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('groups columns under their owning table', () => {
    const { nodes } = buildGraph(
      [tbl('a'), tbl('b')],
      [
        col('a', 'a1', 1),
        col('a', 'a2', 2),
        col('b', 'b1', 1),
      ],
      [],
    )
    const a = nodes.find((n) => n.id === 'a')!
    const b = nodes.find((n) => n.id === 'b')!
    expect((a.data as Record<string, unknown>).columnCount).toBe(2)
    expect((b.data as Record<string, unknown>).columnCount).toBe(1)
  })

  it('emits one edge per relationship with type "parallel"', () => {
    const { edges } = buildGraph(
      [tbl('a'), tbl('b')],
      [],
      [rel('r1', 'a', 'a1', 'b', 'b1')],
    )
    expect(edges).toHaveLength(1)
    expect(edges[0].type).toBe('parallel')
    expect(edges[0].source).toBe('a')
    expect(edges[0].target).toBe('b')
  })

  it('stamps index=0/total=1 for a singleton bundle', () => {
    const { edges } = buildGraph(
      [tbl('a'), tbl('b')],
      [],
      [rel('r1', 'a', 'a1', 'b', 'b1')],
    )
    expect(dataOf(edges[0])).toMatchObject({ index: 0, total: 1 })
  })

  it('assigns sequential index, shared total, for two parallel edges between the same node pair', () => {
    const { edges } = buildGraph(
      [tbl('a'), tbl('b')],
      [],
      [
        rel('r1', 'a', 'x1', 'b', 'y'),
        rel('r2', 'a', 'x2', 'b', 'y'),
      ],
    )
    expect(edges).toHaveLength(2)
    const d1 = dataOf(edges[0])
    const d2 = dataOf(edges[1])
    expect(d1).toMatchObject({ index: 0, total: 2 })
    expect(d2).toMatchObject({ index: 1, total: 2 })
  })

  it('handles a three-way bundle', () => {
    const { edges } = buildGraph(
      [tbl('m'), tbl('u')],
      [],
      [
        rel('r1', 'm', 'from_id', 'u', 'id'),
        rel('r2', 'm', 'to_id', 'u', 'id'),
        rel('r3', 'm', 'mentioned_id', 'u', 'id'),
      ],
    )
    const indices = edges.map((e) => dataOf(e).index).sort()
    const totals = edges.map((e) => dataOf(e).total)
    expect(indices).toEqual([0, 1, 2])
    expect(totals).toEqual([3, 3, 3])
  })

  it('treats A→B and B→A as separate bundles', () => {
    const { edges } = buildGraph(
      [tbl('a'), tbl('b')],
      [],
      [
        rel('r1', 'a', 'x', 'b', 'y'),
        rel('r2', 'b', 'y', 'a', 'x'),
      ],
    )
    const ab = edges.find((e) => e.source === 'a' && e.target === 'b')!
    const ba = edges.find((e) => e.source === 'b' && e.target === 'a')!
    expect(dataOf(ab).total).toBe(1)
    expect(dataOf(ba).total).toBe(1)
  })

  it('formats the edge label as "src_col → dst_col"', () => {
    const { edges } = buildGraph(
      [tbl('a'), tbl('b')],
      [],
      [rel('r1', 'a', 'parent_id', 'b', 'id')],
    )
    expect(dataOf(edges[0]).label).toBe('parent_id → id')
  })
})
