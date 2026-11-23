import { create } from 'zustand'
import { uid } from '@shared/id'
import { projectSummary } from '@shared/commands'
import { getState } from '../store'

export interface Plugin {
  id: string
  name: string
  description: string
  code: string
  createdAt: number
}

const KEY = 'cutline.plugins'
const load = (): Plugin[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

interface PluginState {
  plugins: Plugin[]
  save: (p: Omit<Plugin, 'id' | 'createdAt'> & { id?: string }) => Plugin
  remove: (id: string) => void
}

export const usePlugins = create<PluginState>((set, get) => ({
  plugins: load(),
  save(p) {
    const existing = get().plugins.find((x) => x.id === p.id || x.name.toLowerCase() === p.name.toLowerCase())
    const plugin: Plugin = { id: existing?.id ?? uid('plg_'), createdAt: existing?.createdAt ?? Date.now(), name: p.name, description: p.description, code: p.code }
    const plugins = [...get().plugins.filter((x) => x.id !== plugin.id), plugin]
    localStorage.setItem(KEY, JSON.stringify(plugins))
    set({ plugins })
    return plugin
  },
  remove(id) {
    const plugins = get().plugins.filter((x) => x.id !== id)
    localStorage.setItem(KEY, JSON.stringify(plugins))
    set({ plugins })
  }
}))

// The worker has no access to window.api/DOM; it can only talk back through these message types.
const WORKER_SRC = `
let seq = 0; const pending = new Map();
const call = (op, args) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); postMessage({ type: 'call', id, op, args }) });
const api = {
  run: (name, args) => call('run', { name, args: args || {} }),
  project: () => call('project'),
  playhead: () => call('playhead'),
  selection: () => call('selection'),
  toast: (text) => call('toast', { text: String(text) }),
};
onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'result') { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.result); return }
  if (m.type === 'start') {
    try { const fn = new (Object.getPrototypeOf(async function(){}).constructor)('api', m.code); const r = await fn(api); postMessage({ type: 'done', result: r === undefined ? null : r }) }
    catch (err) { postMessage({ type: 'done', error: String(err && err.message || err) }) }
  }
};`

/** Run plugin code in a sandboxed worker; it can only call editor commands. */
export function runPluginCode(code: string, timeoutMs = 60_000): Promise<unknown> {
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
  const worker = new Worker(url)
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => {
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('Plugin timed out'))), timeoutMs)
    worker.onerror = (e) => finish(() => reject(new Error(e.message)))
    worker.onmessage = async (e) => {
      const m = e.data
      if (m.type === 'done') return finish(() => (m.error ? reject(new Error(m.error)) : resolve(m.result)))
      if (m.type !== 'call') return
      try {
        const s = getState()
        let result: unknown
        if (m.op === 'run') result = await s.dispatch(m.args.name, m.args.args)
        else if (m.op === 'project') result = projectSummary(s.project)
        else if (m.op === 'playhead') result = s.playhead
        else if (m.op === 'selection') result = s.selection
        else if (m.op === 'toast') s.toast(m.args.text)
        worker.postMessage({ type: 'result', id: m.id, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) })
      } catch (err) {
        worker.postMessage({ type: 'result', id: m.id, error: (err as Error).message })
      }
    }
    worker.postMessage({ type: 'start', code })
  })
}

export async function runPlugin(idOrName: string): Promise<unknown> {
  const p = usePlugins.getState().plugins.find((x) => x.id === idOrName || x.name.toLowerCase() === idOrName.toLowerCase())
  if (!p) throw new Error(`No plugin "${idOrName}"`)
  return runPluginCode(p.code)
}
