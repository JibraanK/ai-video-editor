import { create } from 'zustand'
import { applyCommand } from '@shared/commands'
import { createProject, normalizeProject } from '@shared/project'
import type { MediaItem, Project, Word } from '@shared/types'
import type { CollabUser, Presence } from '../../collab/protocol'

export type Page = 'edit' | 'export'
export type Tool = 'select' | 'razor'
export type Side = 'inspector' | 'mixer' | 'ask' | null

export interface Toast {
  id: number
  text: string
  kind?: 'info' | 'error'
}

export interface CollabState {
  status: 'off' | 'connecting' | 'connected' | 'error'
  me: CollabUser | null
  room: string | null
  invite: string | null
  isHost: boolean
  mediaBase: string | null
  token: string | null
  peers: Record<string, { user: CollabUser; presence: Presence }>
  error?: string
}

const HISTORY = 100

interface State {
  project: Project
  projectPath: string | null
  past: Project[]
  future: Project[]
  dirty: boolean
  playhead: number
  playing: boolean
  selection: string[]
  tool: Tool
  zoom: number
  page: Page
  /** Left media drawer and right side drawer visibility. */
  pool: boolean
  side: Side
  waveforms: Record<string, { peaks: number[]; peaksPerSecond: number }>
  toasts: Toast[]
  busy: string | null
  collab: CollabState
  /** Remote edit sink; set while connected to a collab room. */
  remote: null | {
    command: (name: string, args: unknown) => Promise<unknown>
    setProject: (p: Project, label: string) => void
    undo: () => void
    redo: () => void
  }

  dispatch: (name: string, args?: unknown) => Promise<unknown>
  setProject: (p: Project, label?: string, opts?: { resetHistory?: boolean }) => void
  replaceFromRemote: (p: Project) => void
  undo: () => void
  redo: () => void
  addMedia: (items: MediaItem[]) => void
  setTranscript: (words: Word[]) => void
  setPlayhead: (t: number) => void
  setPlaying: (p: boolean) => void
  select: (ids: string[]) => void
  set: (patch: Partial<State>) => void
  toast: (text: string, kind?: Toast['kind']) => void
  setCollab: (patch: Partial<CollabState>) => void
}

let toastId = 0

type CommandListener = (name: string, args: unknown) => void
const commandListeners = new Set<CommandListener>()
/** Observe successful edits (dispatched commands plus 'undo' / 'redo'). */
export function onCommand(cb: CommandListener): () => void {
  commandListeners.add(cb)
  return () => {
    commandListeners.delete(cb)
  }
}
const emitCommand = (name: string, args: unknown = {}) => commandListeners.forEach((cb) => cb(name, args))

export const useStore = create<State>((set, get) => ({
  project: createProject(),
  projectPath: null,
  past: [],
  future: [],
  dirty: false,
  playhead: 0,
  playing: false,
  selection: [],
  tool: 'select',
  zoom: 60,
  page: 'edit',
  pool: false,
  side: null,
  waveforms: {},
  toasts: [],
  busy: null,
  collab: { status: 'off', me: null, room: null, invite: null, isHost: false, mediaBase: null, token: null, peers: {} },
  remote: null,

  async dispatch(name, args = {}) {
    const { remote } = get()
    if (remote) {
      const r = await remote.command(name, args)
      emitCommand(name, args)
      return r
    }
    const before = get().project
    const { project, result } = applyCommand(before, name, args)
    if (project !== before) {
      set((s) => ({ project, past: [...s.past, before].slice(-HISTORY), future: [], dirty: true }))
      const ids = new Set(project.clips.map((c) => c.id))
      if (get().selection.some((id) => !ids.has(id))) set({ selection: get().selection.filter((id) => ids.has(id)) })
    }
    emitCommand(name, args)
    return result
  },
  setProject(p, label = 'Edit', opts) {
    const project = normalizeProject(p)
    const { remote } = get()
    if (remote && !opts?.resetHistory) return remote.setProject(project, label)
    set((s) => ({ project, past: opts?.resetHistory ? [] : [...s.past, s.project].slice(-HISTORY), future: [], dirty: !opts?.resetHistory, selection: [] }))
  },
  replaceFromRemote(p) {
    const ids = new Set(p.clips.map((c) => c.id))
    set((s) => ({ project: p, selection: s.selection.filter((id) => ids.has(id)) }))
  },
  undo() {
    const { remote, past, project } = get()
    if (remote) return remote.undo(), emitCommand('undo')
    if (!past.length) return
    set((s) => ({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...s.future], dirty: true }))
    emitCommand('undo')
  },
  redo() {
    const { remote, future, project } = get()
    if (remote) return remote.redo(), emitCommand('redo')
    if (!future.length) return
    set((s) => ({ project: future[0], future: future.slice(1), past: [...s.past, project], dirty: true }))
    emitCommand('redo')
  },
  addMedia(items) {
    const p = structuredClone(get().project)
    for (const m of items) if (!p.media.some((x) => x.path === m.path)) p.media.push(m)
    get().setProject(p, 'Import media')
  },
  setTranscript(words) {
    const p = structuredClone(get().project)
    p.transcript = { words, createdAt: Date.now() }
    get().setProject(p, 'Transcript')
  },
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  select: (selection) => set({ selection }),
  set: (patch) => set(patch),
  toast(text, kind = 'info') {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500)
  },
  setCollab: (patch) => set((s) => ({ collab: { ...s.collab, ...patch } }))
}))

export const getState = useStore.getState
