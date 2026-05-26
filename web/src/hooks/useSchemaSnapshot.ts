import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface SchemaTable {
  id: string
  target_id: string
  schema_name: string
  table_name: string
  has_rls: boolean
  rls_forced: boolean
  governance_status: 'red' | 'yellow' | 'green' | 'gray'
  last_seen_at: string
}

export interface SchemaColumn {
  id: string
  table_id: string
  name: string
  data_type: string
  is_nullable: boolean
  ordinal: number
}

export interface SchemaRelationship {
  id: string
  target_id: string
  source_table_id: string
  source_column: string
  target_table_id: string
  target_column: string
  constraint_name: string
}

export interface SchemaSnapshot {
  tables: SchemaTable[]
  columns: SchemaColumn[]
  relationships: SchemaRelationship[]
}

/**
 * Fetches the schema_* rows for a given target and keeps them live
 * via Realtime subscriptions. Returns null until the first load
 * completes; thereafter always a snapshot (possibly empty if the
 * target has never been introspected).
 */
export function useSchemaSnapshot(targetId: string | null) {
  const [snapshot, setSnapshot] = useState<SchemaSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!targetId) {
      setSnapshot(null)
      return
    }
    let mounted = true

    async function load() {
      const [tablesRes, colsRes, relsRes] = await Promise.all([
        supabase
          .from('schema_tables')
          .select(
            'id, target_id, schema_name, table_name, has_rls, rls_forced, governance_status, last_seen_at',
          )
          .eq('target_id', targetId),
        supabase
          .from('schema_columns')
          .select('id, table_id, name, data_type, is_nullable, ordinal')
          .order('ordinal', { ascending: true }),
        supabase
          .from('schema_relationships')
          .select(
            'id, target_id, source_table_id, source_column, target_table_id, target_column, constraint_name',
          )
          .eq('target_id', targetId),
      ])

      if (!mounted) return
      const firstErr =
        tablesRes.error ?? colsRes.error ?? relsRes.error ?? null
      if (firstErr) {
        setError(firstErr.message)
        return
      }
      // schema_columns has no target_id column to filter on directly;
      // RLS already restricts to tables we can see. The query above
      // pulls everything visible, which for this target is the right set
      // *unless* the user has multiple targets — then we need to filter
      // client-side. Cheap to do here.
      const tableIds = new Set((tablesRes.data ?? []).map((t) => t.id))
      const cols = (colsRes.data ?? []).filter((c) => tableIds.has(c.table_id))
      setSnapshot({
        tables: (tablesRes.data ?? []) as SchemaTable[],
        columns: cols as SchemaColumn[],
        relationships: (relsRes.data ?? []) as SchemaRelationship[],
      })
      setError(null)
    }

    load()

    const channel = supabase
      .channel(`schema-snapshot-${targetId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schema_tables' },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schema_columns' },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schema_relationships' },
        () => load(),
      )
      .subscribe()

    return () => {
      mounted = false
      supabase.removeChannel(channel)
    }
  }, [targetId])

  return { snapshot, error }
}
