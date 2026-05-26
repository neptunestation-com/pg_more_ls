import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface Org {
  id: string
  name: string
  created_at: string
  created_by: string
}

/**
 * Fetches the current user's orgs (subject to RLS — visible only if
 * they're a member) and keeps the list in sync via Realtime.
 */
export function useOrgs() {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      const { data, error } = await supabase
        .from('orgs')
        .select('id, name, created_at, created_by')
        .order('created_at', { ascending: true })
      if (!mounted) return
      if (error) {
        setError(error.message)
      } else {
        setOrgs(data ?? [])
        setError(null)
      }
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('orgs-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orgs' },
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

  return { orgs, loading, error }
}
