import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) {
    return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>)
  }
  const body = await res.json().catch(() => ({ error: res.statusText }))
  throw new Error(body.error ?? `HTTP ${res.status}`)
}

export interface CreateTargetRequest {
  orgId: string
  name: string
  host: string
  port: number
  database: string
  username: string
  password: string
  isProduction: boolean
  sslMode: string
}

export interface CreateTargetResponse {
  id: string
}

export interface EnqueueIntrospectResponse {
  msgId: number
}

export async function createTarget(req: CreateTargetRequest): Promise<CreateTargetResponse> {
  return unwrap(
    await authedFetch('/api/v1/targets', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  )
}

export async function enqueueIntrospect(targetId: string): Promise<EnqueueIntrospectResponse> {
  return unwrap(
    await authedFetch(`/api/v1/targets/${targetId}/introspect`, {
      method: 'POST',
    }),
  )
}

export async function deleteTarget(targetId: string): Promise<void> {
  return unwrap(
    await authedFetch(`/api/v1/targets/${targetId}`, {
      method: 'DELETE',
    }),
  )
}
