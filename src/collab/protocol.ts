import type { Project } from '../shared/types'

export interface CollabUser {
  id: string
  name: string
  color: string
}

/** Cursor positions are area-relative so they map correctly across different window sizes/zoom levels. */
export type CursorPos =
  | { area: 'timeline'; time: number; trackId: string | null; ny: number }
  | { area: string; nx: number; ny: number }

export interface Presence {
  cursor?: CursorPos | null
  selection?: string[]
  playhead?: number
  page?: string
}

export type ClientMsg =
  | { type: 'hello'; room: string; token: string; user: CollabUser; createWith?: { project: Project; adminToken: string } }
  | { type: 'command'; reqId: string; name: string; args: unknown }
  | { type: 'set_project'; reqId: string; project: Project; label: string }
  | { type: 'undo' | 'redo'; reqId: string }
  | { type: 'presence'; presence: Presence }
  | { type: 'chat'; text: string }

export type ServerMsg =
  | { type: 'welcome'; you: CollabUser; peers: (CollabUser & { presence: Presence })[]; project: Project; version: number }
  | { type: 'state'; project: Project; version: number; by: string; label: string }
  | { type: 'ack'; reqId: string; result?: unknown; error?: string }
  | { type: 'presence'; userId: string; presence: Presence }
  | { type: 'peer_join'; user: CollabUser }
  | { type: 'peer_leave'; userId: string }
  | { type: 'chat'; userId: string; text: string; at: number }
  | { type: 'error'; error: string }
