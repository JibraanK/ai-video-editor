/**
 * Multiplayer room server. Host-authoritative: clients send editor commands, the server applies them with the
 * shared command API and broadcasts the new project state; presence (cursors, selections, playheads) is relayed.
 * Embedded in the desktop app ("Host session") or run standalone with `npm run collab-server`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import { extname } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { applyCommand } from '../shared/commands'
import type { Project } from '../shared/types'
import type { ClientMsg, CollabUser, Presence, ServerMsg } from './protocol'

interface Room {
  id: string
  token: string
  project: Project
  version: number
  past: Project[]
  future: Project[]
  clients: Map<WebSocket, CollabUser>
  presence: Map<string, Presence>
}

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
const HISTORY_LIMIT = 100

export interface CollabServer {
  port: number
  adminToken: string
  close: () => Promise<void>
  rooms: Map<string, Room>
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, path: string): void {
  if (!existsSync(path)) {
    res.writeHead(404).end()
    return
  }
  const size = statSync(path).size
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  const cors = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-type': type }
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2])
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    res.writeHead(206, { ...cors, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
    createReadStream(path, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { ...cors, 'content-length': size })
    createReadStream(path).pipe(res)
  }
}

export function startCollabServer(port: number, adminToken: string, host = '0.0.0.0'): Promise<CollabServer> {
  const rooms = new Map<string, Room>()

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const m = url.pathname.match(/^\/(media|thumb)\/([^/]+)\/([^/]+)$/)
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size }))
      return
    }
    if (!m) {
      res.writeHead(404).end()
      return
    }
    const room = rooms.get(m[2])
    if (!room || url.searchParams.get('token') !== room.token) {
      res.writeHead(403).end()
      return
    }
    const media = room.project.media.find((x) => x.id === decodeURIComponent(m[3]))
    const path = m[1] === 'thumb' ? media?.thumbnail : media?.path
    if (!path) {
      res.writeHead(404).end()
      return
    }
    serveFile(req, res, path)
  })

  const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 * 1024 })

  const send = (ws: WebSocket, msg: ServerMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg))
  const broadcast = (room: Room, msg: ServerMsg, except?: WebSocket) => {
    for (const ws of room.clients.keys()) if (ws !== except) send(ws, msg)
  }
  const commit = (room: Room, next: Project, by: string, label: string) => {
    room.past.push(room.project)
    if (room.past.length > HISTORY_LIMIT) room.past.shift()
    room.future = []
    room.project = next
    room.version++
    broadcast(room, { type: 'state', project: next, version: room.version, by, label })
  }

  wss.on('connection', (ws) => {
    let room: Room | null = null
    let user: CollabUser | null = null

    ws.on('message', (raw) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'hello') {
        let r = rooms.get(msg.room)
        if (!r && msg.createWith) {
          if (msg.createWith.adminToken !== adminToken) return send(ws, { type: 'error', error: 'Not allowed to create rooms on this server' })
          r = { id: msg.room, token: msg.token, project: msg.createWith.project, version: 1, past: [], future: [], clients: new Map(), presence: new Map() }
          rooms.set(r.id, r)
        }
        if (!r) return send(ws, { type: 'error', error: 'Room not found' })
        if (r.token !== msg.token) return send(ws, { type: 'error', error: 'Invalid invite token' })
        room = r
        user = msg.user
        const peers = [...r.clients.values()].map((u) => ({ ...u, presence: r!.presence.get(u.id) ?? {} }))
        r.clients.set(ws, user)
        send(ws, { type: 'welcome', you: user, peers, project: r.project, version: r.version })
        broadcast(r, { type: 'peer_join', user }, ws)
        return
      }
      if (!room || !user) return send(ws, { type: 'error', error: 'Say hello first' })
      switch (msg.type) {
        case 'command': {
          try {
            const { project, result } = applyCommand(room.project, msg.name, msg.args)
            if (project !== room.project) commit(room, project, user.id, msg.name)
            send(ws, { type: 'ack', reqId: msg.reqId, result })
          } catch (e) {
            send(ws, { type: 'ack', reqId: msg.reqId, error: (e as Error).message })
          }
          break
        }
        case 'set_project':
          commit(room, msg.project, user.id, msg.label)
          send(ws, { type: 'ack', reqId: msg.reqId })
          break
        case 'undo':
        case 'redo': {
          const from = msg.type === 'undo' ? room.past : room.future
          const to = msg.type === 'undo' ? room.future : room.past
          const prev = from.pop()
          if (prev) {
            to.push(room.project)
            room.project = prev
            room.version++
            broadcast(room, { type: 'state', project: prev, version: room.version, by: user.id, label: msg.type })
          }
          send(ws, { type: 'ack', reqId: msg.reqId })
          break
        }
        case 'presence':
          room.presence.set(user.id, { ...(room.presence.get(user.id) ?? {}), ...msg.presence })
          broadcast(room, { type: 'presence', userId: user.id, presence: msg.presence }, ws)
          break
        case 'chat':
          broadcast(room, { type: 'chat', userId: user.id, text: String(msg.text).slice(0, 2000), at: Date.now() })
          break
      }
    })

    ws.on('close', () => {
      if (!room || !user) return
      room.clients.delete(ws)
      room.presence.delete(user.id)
      broadcast(room, { type: 'peer_leave', userId: user.id })
    })
  })

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => {
      resolve({
        port,
        adminToken,
        rooms,
        close: () =>
          new Promise<void>((r) => {
            for (const c of wss.clients) c.terminate()
            wss.close()
            httpServer.close(() => r())
          })
      })
    })
  })
}
