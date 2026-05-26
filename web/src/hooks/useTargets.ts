import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface Target {
  id: string
  org_id: string
  name: string
  host: string
  port: number
  database: string
  username: string
  is_production: boolean
  ssl_mode: string
  created_at: string
  last_introspected_at: string | null
}

/**
 * Fetches target_databases visible to the current user (subject to RLS
 * — visible only for orgs they're a member of) and keeps them in sync
 * via Realtime.
 */
export function useTargets() {
  const [targets, setTargets] = useState<Target[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      const { data, error } = await supabase
        .from('target_databases')
        .select(
          'id, org_id, name, host, port, database, username, is_production, ssl_mode, created_at, last_introspected_at',
        )
        .order('created_at', { ascending: true })
      if (!mounted) return
      if (error) {
        setError(error.message)
      } else {
        setTargets((data ?? []) as Target[])
        setError(null)
      }
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('target-databases-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'target_databases' },
        () => {
          load()
        },
      )
      .subscribe()

    return () => {
      mounted = false
      supabase.removeChannel(channel)
    }
  }, [])

  return { targets, loading, error }
}
