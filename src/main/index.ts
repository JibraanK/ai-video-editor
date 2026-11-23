import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { startCollabServer, type CollabServer } from '../collab/server'
import type { ExportOptions, Project, Template } from '@shared/types'
import { cancelAgent, mcpConfigSnippets, resetAgent, runCliAgent, runCloudAgent } from './agents'
import { importMedia, PEAKS_PER_SECOND, waveform } from './ffmpeg'
import { mcpStatus, startMcpServer, stopMcpServer } from './mcpServer'
import { cancelExport, renderProject } from './render'
import { getSettings, saveSecrets, saveSettings, secretStatus, type Secrets, type Settings } from './settings'
import { deleteTemplate, listTemplates, saveTemplate } from './templatesStore'
import { executeTool } from './tools'
import { transcriptionBackends } from './transcribe'

protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } }])

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

/** media://file/<encoded absolute path> with HTTP range support so <video> can seek. */
function registerMediaProtocol(): void {
  protocol.handle('media', async (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname.slice(1))
    if (!existsSync(path)) return new Response('Not found', { status: 404 })
    const size = statSync(path).size
    const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const m = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/)
    const cors = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-type': type }
    if (!m) return new Response(Readable.toWeb(createReadStream(path)) as unknown as ReadableStream, { status: 200, headers: { ...cors, 'content-length': String(size) } })
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
    return new Response(body, { status: 206, headers: { ...cors, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` } })
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1013',
    title: 'Cutline',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

let collab: CollabServer | null = null

function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return i.address
  return '127.0.0.1'
}

function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain)
  h('app:info', () => ({ isPackaged: app.isPackaged, sourceRoot: app.getAppPath(), platform: process.platform, version: app.getVersion() }))
  h('dialog:openMedia', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
    return r.canceled ? [] : r.filePaths
  })
  h('dialog:openFile', async (_e, filters?: Electron.FileFilter[]) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters })
    return r.canceled ? null : r.filePaths[0]
  })
  h('dialog:savePath', async (_e, defaultPath: string, filters?: Electron.FileFilter[]) => {
    const r = await dialog.showSaveDialog({ defaultPath: join(app.getPath('videos'), defaultPath), filters })
    return r.canceled ? null : r.filePath
  })
  h('media:import', async (_e, paths: string[]) => {
    const out = []
    for (const p of paths) {
      try {
        out.push(await importMedia(p))
      } catch (e) {
        out.push({ error: (e as Error).message, path: p })
      }
    }
    return out
  })
  h('media:waveform', async (_e, path: string) => ({ peaks: await waveform(path), peaksPerSecond: PEAKS_PER_SECOND }))
  h('project:save', async (_e, project: Project, path?: string) => {
    let target = path
    if (!target) {
      const r = await dialog.showSaveDialog({ defaultPath: `${project.name}.cutline.json`, filters: [{ name: 'Cutline project', extensions: ['json'] }] })
      if (r.canceled || !r.filePath) return null
      target = r.filePath
    }
    writeFileSync(target, JSON.stringify(project, null, 2))
    return target
  })
  h('project:open', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Cutline project', extensions: ['json'] }] })
    if (r.canceled) return null
    return { path: r.filePaths[0], project: JSON.parse(readFileSync(r.filePaths[0], 'utf8')) }
  })
  h('file:write', (_e, path: string, content: string) => writeFileSync(path, content))
  h('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))
  h('settings:get', () => ({ settings: getSettings(), secrets: secretStatus(), transcription: transcriptionBackends() }))
  h('settings:set', (_e, patch: Partial<Settings>) => saveSettings(patch))
  h('secrets:set', (_e, patch: Secrets) => {
    saveSecrets(patch)
    return secretStatus()
  })
  h('export:start', (_e, project: Project, options: ExportOptions) => renderProject(project, options))
  h('export:cancel', () => cancelExport())
  h('tool:run', (_e, name: string, args: unknown) => executeTool(name, args))
  h('agent:cloud', (_e, prompt: string) => runCloudAgent(prompt))
  h('agent:cli', (_e, prompt: string) => runCliAgent(prompt))
  h('agent:cancel', () => cancelAgent())
  h('agent:reset', () => resetAgent())
  h('mcp:status', () => ({ ...mcpStatus(), snippets: mcpConfigSnippets() }))
  h('mcp:start', async () => {
    await startMcpServer(getSettings().mcpPort)
    saveSettings({ mcpEnabled: true })
    return { ...mcpStatus(), snippets: mcpConfigSnippets() }
  })
  h('mcp:stop', async () => {
    await stopMcpServer()
    saveSettings({ mcpEnabled: false })
    return { ...mcpStatus(), snippets: mcpConfigSnippets() }
  })
  h('templates:list', () => listTemplates())
  h('templates:save', (_e, t: Template) => saveTemplate(t))
  h('templates:delete', (_e, id: string) => deleteTemplate(id))
  h('collab:host', async (_e, port = 47822) => {
    if (!collab) collab = await startCollabServer(port, randomBytes(16).toString('hex'))
    const ip = lanAddress()
    return { wsUrl: `ws://${ip}:${collab.port}`, localWsUrl: `ws://127.0.0.1:${collab.port}`, adminToken: collab.adminToken }
  })
  h('collab:stop', async () => {
    await collab?.close()
    collab = null
  })
}

app.whenReady().then(async () => {
  registerMediaProtocol()
  registerIpc()
  createWindow()
  if (getSettings().mcpEnabled) startMcpServer(getSettings().mcpPort).catch((e) => console.error('MCP server failed to start:', e.message))
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
