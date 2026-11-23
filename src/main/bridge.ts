import { BrowserWindow, ipcMain } from 'electron'
import { uid } from '@shared/id'

/** Request/response RPC from main to the renderer, which owns the live project + undo history. */
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()

ipcMain.on('rpc:response', (_e, msg: { id: string; result?: unknown; error?: string }) => {
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  if (msg.error) p.reject(new Error(msg.error))
  else p.resolve(msg.result)
})

export function mainWindow(): BrowserWindow {
  const w = BrowserWindow.getAllWindows()[0]
  if (!w) throw new Error('Editor window is not open')
  return w
}

export function callRenderer<T = any>(method: string, params: unknown = {}, timeoutMs = 120_000): Promise<T> {
  const id = uid('rpc_')
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Renderer did not answer ${method}`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      }
    })
    mainWindow().webContents.send('rpc:request', { id, method, params })
  })
}

export function emit(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}
