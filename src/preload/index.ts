import { contextBridge, ipcRenderer, webUtils } from 'electron'

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args)
const on = (ch: string, cb: (payload: any) => void) => {
  const listener = (_e: unknown, payload: any) => cb(payload)
  ipcRenderer.on(ch, listener)
  return () => {
    ipcRenderer.removeListener(ch, listener)
  }
}

const api = {
  appInfo: () => invoke('app:info'),
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  openMediaDialog: () => invoke('dialog:openMedia'),
  openFileDialog: (filters?: { name: string; extensions: string[] }[]) => invoke('dialog:openFile', filters),
  savePathDialog: (name: string, filters?: { name: string; extensions: string[] }[]) => invoke('dialog:savePath', name, filters),
  importMedia: (paths: string[]) => invoke('media:import', paths),
  waveform: (path: string) => invoke('media:waveform', path),
  saveProject: (project: unknown, path?: string) => invoke('project:save', project, path),
  openProject: () => invoke('project:open'),
  writeFile: (path: string, content: string) => invoke('file:write', path, content),
  showItem: (path: string) => invoke('shell:showItem', path),
  getSettings: () => invoke('settings:get'),
  setSettings: (patch: unknown) => invoke('settings:set', patch),
  setSecrets: (patch: unknown) => invoke('secrets:set', patch),
  startExport: (project: unknown, options: unknown) => invoke('export:start', project, options),
  cancelExport: () => invoke('export:cancel'),
  runTool: (name: string, args?: unknown) => invoke('tool:run', name, args ?? {}),
  agentCloud: (prompt: string) => invoke('agent:cloud', prompt),
  agentCli: (prompt: string) => invoke('agent:cli', prompt),
  agentCancel: () => invoke('agent:cancel'),
  agentReset: () => invoke('agent:reset'),
  mcpStatus: () => invoke('mcp:status'),
  mcpStart: () => invoke('mcp:start'),
  mcpStop: () => invoke('mcp:stop'),
  listTemplates: () => invoke('templates:list'),
  saveTemplate: (t: unknown) => invoke('templates:save', t),
  deleteTemplate: (id: string) => invoke('templates:delete', id),
  collabHost: (port?: number) => invoke('collab:host', port),
  collabStop: () => invoke('collab:stop'),
  onExportProgress: (cb: (p: any) => void) => on('export:progress', cb),
  onAgentEvent: (cb: (e: any) => void) => on('agent:event', cb),
  onRpc: (handler: (method: string, params: any) => Promise<unknown>) =>
    on('rpc:request', async ({ id, method, params }) => {
      try {
        const result = await handler(method, params)
        ipcRenderer.send('rpc:response', { id, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) })
      } catch (e) {
        console.error('[rpc] failed', method, e)
        ipcRenderer.send('rpc:response', { id, error: (e as Error).message })
      }
    })
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
