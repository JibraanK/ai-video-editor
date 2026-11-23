import { uid } from '@shared/id'
import type { Project } from '@shared/types'
import type { ClientMsg, CollabUser, Presence, ServerMsg } from '../../../collab/protocol'
import { getState, useStore } from '../store'

export const COLORS = ['#ff5f6d', '#ffb340', '#4cd964', '#3ec7ff', '#a07cff', '#ff6fd8', '#2ee6c5', '#ffd43b']

let ws: WebSocket | null = null
let pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let lastPresence = 0
let queued: Presence | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

export interface Identity {
  name: string
  color: string
}

export function loadIdentity(): Identity {
  try {
    const saved = JSON.parse(localStorage.getItem('cutline.identity') ?? 'null')
    if (saved?.name) return saved
  } catch {
    /* fall through to default */
  }
  return { name: 'Editor', color: COLORS[Math.floor(Math.random() * COLORS.length)] }
}

export const saveIdentity = (id: Identity) => localStorage.setItem('cutline.identity', JSON.stringify(id))

const send = (msg: ClientMsg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg))

type ReqMsg<T = Extract<ClientMsg, { reqId: string }>> = T extends unknown ? Omit<T, 'reqId'> : never

function request(msg: ReqMsg): Promise<unknown> {
  const reqId = uid('r')
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject })
    send({ ...msg, reqId } as ClientMsg)
  })
}

function connect(url: string, hello: Extract<ClientMsg, { type: 'hello' }>, info: { invite: string; isHost: boolean; mediaBase: string }): Promise<void> {
  const s = getState()
  s.setCollab({ status: 'connecting', error: undefined })
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url)
    ws = sock
    sock.onopen = () => send(hello)
    sock.onerror = () => {
      s.setCollab({ status: 'error', error: `Could not connect to ${url}` })
      reject(new Error(`Could not connect to ${url}`))
    }
    sock.onclose = () => {
      if (ws !== sock) return
      ws = null
      useStore.setState({ remote: null })
      s.setCollab({ status: 'off', peers: {} })
      for (const p of pending.values()) p.reject(new Error('Disconnected'))
      pending = new Map()
    }
    sock.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMsg
      const st = getState()
      switch (msg.type) {
        case 'welcome':
          st.replaceFromRemote(msg.project)
          st.setCollab({
            status: 'connected',
            me: msg.you,
            room: hello.room,
            token: hello.token,
            invite: info.invite,
            isHost: info.isHost,
            mediaBase: info.mediaBase,
            peers: Object.fromEntries(msg.peers.map(({ presence, ...user }) => [user.id, { user, presence }]))
          })
          useStore.setState({
            remote: {
              command: (name, args) => request({ type: 'command', name, args }),
              setProject: (project: Project, label: string) => void request({ type: 'set_project', project, label }),
              undo: () => void request({ type: 'undo' }),
              redo: () => void request({ type: 'redo' })
            }
          })
          publishPresence({ page: st.page, playhead: st.playhead, selection: st.selection })
          resolve()
          break
        case 'state':
          st.replaceFromRemote(msg.project)
          useStore.setState({ dirty: true })
          break
        case 'ack': {
          const p = pending.get(msg.reqId)
          pending.delete(msg.reqId)
          if (msg.error) p?.reject(new Error(msg.error))
          else p?.resolve(msg.result)
          break
        }
        case 'presence': {
          const peer = st.collab.peers[msg.userId]
          if (peer) st.setCollab({ peers: { ...st.collab.peers, [msg.userId]: { ...peer, presence: { ...peer.presence, ...msg.presence } } } })
          break
        }
        case 'peer_join':
          st.setCollab({ peers: { ...st.collab.peers, [msg.user.id]: { user: msg.user, presence: {} } } })
          st.toast(`${msg.user.name} joined`)
          break
        case 'peer_leave': {
          const { [msg.userId]: gone, ...rest } = st.collab.peers
          st.setCollab({ peers: rest })
          if (gone) st.toast(`${gone.user.name} left`)
          break
        }
        case 'chat': {
          const who = st.collab.peers[msg.userId]?.user.name ?? 'You'
          st.toast(`${who}: ${msg.text}`)
          break
        }
        case 'error':
          st.setCollab({ status: 'error', error: msg.error })
          st.toast(msg.error, 'error')
          reject(new Error(msg.error))
          sock.close()
      }
    }
  })
}

function makeUser(id: Identity): CollabUser {
  return { id: uid('u_'), name: id.name.trim() || 'Editor', color: id.color }
}

/** Host a room on this machine; collaborators join with the invite link. */
export async function hostRoom(identity: Identity): Promise<string> {
  const { wsUrl, localWsUrl, adminToken } = await window.api.collabHost()
  const room = uid('room_')
  const token = uid('t_') + uid()
  const invite = `${wsUrl}/?room=${room}&token=${token}`
  await connect(localWsUrl, { type: 'hello', room, token, user: makeUser(identity), createWith: { project: getState().project, adminToken } }, { invite, isHost: true, mediaBase: localWsUrl.replace(/^ws/, 'http') })
  return invite
}

export async function joinRoom(invite: string, identity: Identity): Promise<void> {
  const u = new URL(invite.trim())
  const room = u.searchParams.get('room')
  const token = u.searchParams.get('token')
  if (!room || !token) throw new Error('Invite link is missing room or token')
  const base = `${u.protocol}//${u.host}`
  await connect(base, { type: 'hello', room, token, user: makeUser(identity) }, { invite: invite.trim(), isHost: false, mediaBase: base.replace(/^ws/, 'http') })
}

export async function leaveRoom(): Promise<void> {
  const host = getState().collab.isHost
  ws?.close()
  ws = null
  useStore.setState({ remote: null })
  getState().setCollab({ status: 'off', peers: {}, room: null, invite: null, isHost: false })
  if (host) await window.api.collabStop()
}

/** Presence is throttled to ~30 updates/s and always flushes the latest value. */
export function publishPresence(p: Presence): void {
  if (!ws || getState().collab.status !== 'connected') return
  queued = { ...queued, ...p }
  const wait = 33 - (Date.now() - lastPresence)
  if (wait <= 0) flush()
  else if (!flushTimer) flushTimer = setTimeout(flush, wait)
}

function flush() {
  flushTimer = null
  if (!queued) return
  send({ type: 'presence', presence: queued })
  queued = null
  lastPresence = Date.now()
}

export const sendChat = (text: string) => send({ type: 'chat', text })
