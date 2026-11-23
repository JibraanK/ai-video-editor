import { useEffect, useState } from 'react'
import { getState, useStore } from '../store'
import { COLORS, hostRoom, joinRoom, leaveRoom, loadIdentity, saveIdentity } from '../lib/collab'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="row between">
          <div className="section-title">{title}</div>
          <button className="btn sm ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [keys, setKeys] = useState({ openaiKey: '', anthropicKey: '', compatibleKey: '' })
  useEffect(() => void window.api.getSettings().then(setData), [])
  if (!data) return null
  const s = data.settings
  const set = async (patch: object) => setData({ ...data, settings: await window.api.setSettings(patch) })
  const saveKey = async (k: keyof typeof keys) => {
    const secrets = await window.api.setSecrets({ [k]: keys[k] })
    setData({ ...data, secrets })
    setKeys({ ...keys, [k]: '' })
    getState().toast('Key saved (encrypted on this machine)')
  }
  const keyField = (k: keyof typeof keys, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input className="input sm" type="password" placeholder={data.secrets[k] ? '•••••••• saved' : 'not set'} value={keys[k]} onChange={(e) => setKeys({ ...keys, [k]: e.target.value })} />
      <button className="btn sm" disabled={!keys[k]} onClick={() => saveKey(k)}>
        Save
      </button>
    </label>
  )
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="group">
        <div className="group-title">Cloud agent</div>
        <label className="field">
          <span>Provider</span>
          <select className="input sm" value={s.cloudProvider} onChange={(e) => set({ cloudProvider: e.target.value })}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai-compatible">OpenAI-compatible (Ollama, LM Studio, OpenRouter…)</option>
          </select>
        </label>
        {s.cloudProvider === 'openai' && (
          <>
            <label className="field">
              <span>Model</span>
              <input className="input sm" value={s.openaiModel} onChange={(e) => set({ openaiModel: e.target.value })} />
            </label>
            {keyField('openaiKey', 'API key')}
          </>
        )}
        {s.cloudProvider === 'anthropic' && (
          <>
            <label className="field">
              <span>Model</span>
              <input className="input sm" value={s.anthropicModel} onChange={(e) => set({ anthropicModel: e.target.value })} />
            </label>
            {keyField('anthropicKey', 'API key')}
          </>
        )}
        {s.cloudProvider === 'openai-compatible' && (
          <>
            <label className="field">
              <span>Base URL</span>
              <input className="input sm" value={s.compatibleBaseUrl} onChange={(e) => set({ compatibleBaseUrl: e.target.value })} />
            </label>
            <label className="field">
              <span>Model</span>
              <input className="input sm" value={s.compatibleModel} onChange={(e) => set({ compatibleModel: e.target.value })} />
            </label>
            {keyField('compatibleKey', 'API key (optional)')}
          </>
        )}
      </div>
      <div className="group">
        <div className="group-title">Local CLI agent</div>
        <label className="field">
          <span>Agent</span>
          <select className="input sm" value={s.cliAgent} onChange={(e) => set({ cliAgent: e.target.value })}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex CLI</option>
            <option value="gemini">Gemini CLI</option>
            <option value="custom">Custom command</option>
          </select>
        </label>
        {s.cliAgent === 'custom' && (
          <label className="field">
            <span>Command</span>
            <input className="input sm" value={s.customCliCommand} onChange={(e) => set({ customCliCommand: e.target.value })} title="$CUTLINE_PROMPT and $CUTLINE_MCP_URL are set" />
          </label>
        )}
        <label className="field">
          <span>MCP port</span>
          <input className="input sm" type="number" value={s.mcpPort} onChange={(e) => set({ mcpPort: Number(e.target.value) })} />
        </label>
      </div>
      <div className="group">
        <div className="group-title">Transcription</div>
        <label className="field">
          <span>Engine</span>
          <select className="input sm" value={s.transcription} onChange={(e) => set({ transcription: e.target.value })}>
            <option value="auto">Auto</option>
            <option value="openai">OpenAI Whisper API {data.transcription.openai ? '✓' : ''}</option>
            <option value="whisper-cpp">whisper.cpp (local) {data.transcription.whisperCpp ? '✓' : ''}</option>
            <option value="whisper-py">openai-whisper (local) {data.transcription.whisperPy ? '✓' : ''}</option>
          </select>
        </label>
        {s.transcription === 'whisper-cpp' && (
          <>
            <label className="field">
              <span>Binary</span>
              <input className="input sm" value={s.whisperCppBinary} placeholder="whisper-cli" onChange={(e) => set({ whisperCppBinary: e.target.value })} />
            </label>
            <label className="field">
              <span>Model file</span>
              <input className="input sm" value={s.whisperCppModel} placeholder="/path/ggml-base.en.bin" onChange={(e) => set({ whisperCppModel: e.target.value })} />
            </label>
          </>
        )}
      </div>
      <div className="group">
        <div className="group-title">FFmpeg</div>
        <div className="grid2">
          <label className="field">
            <span>ffmpeg</span>
            <input className="input sm" value={s.ffmpegPath} onChange={(e) => set({ ffmpegPath: e.target.value })} />
          </label>
          <label className="field">
            <span>ffprobe</span>
            <input className="input sm" value={s.ffprobePath} onChange={(e) => set({ ffprobePath: e.target.value })} />
          </label>
        </div>
      </div>
    </Modal>
  )
}

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const collab = useStore((s) => s.collab)
  const [identity, setIdentity] = useState(loadIdentity)
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    saveIdentity(identity)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      getState().toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Collaborate" onClose={onClose}>
      <div className="row">
        <input className="input" value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} placeholder="Your name" disabled={collab.status === 'connected'} />
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} className={`swatch${identity.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setIdentity({ ...identity, color: c })} disabled={collab.status === 'connected'} />
          ))}
        </div>
      </div>
      {collab.status === 'connected' ? (
        <div className="group">
          <div className="group-title">{collab.isHost ? 'You are hosting' : 'Connected'} · {Object.keys(collab.peers).length + 1} in room</div>
          {collab.invite && (
            <div className="row">
              <input className="input sm" readOnly value={collab.invite} onFocus={(e) => e.target.select()} />
              <button className="btn sm" onClick={() => navigator.clipboard.writeText(collab.invite!).then(() => getState().toast('Invite copied'))}>
                Copy invite
              </button>
            </div>
          )}
          <p className="muted small">Guests need network access to this machine (same LAN, VPN like Tailscale, or a tunnel). Media streams from the host.</p>
          <button className="btn danger" onClick={() => run(leaveRoom)}>
            {collab.isHost ? 'End session' : 'Leave'}
          </button>
        </div>
      ) : (
        <>
          <div className="group">
            <div className="group-title">Host a room</div>
            <p className="muted small">Start a live session from this project. Everyone sees cursors, selections and playheads; edits sync instantly.</p>
            <button className="btn primary" disabled={busy} onClick={() => run(() => hostRoom(identity))}>
              Host session
            </button>
          </div>
          <div className="group">
            <div className="group-title">Join a room</div>
            <div className="row">
              <input className="input sm" placeholder="Paste invite link (ws://…)" value={invite} onChange={(e) => setInvite(e.target.value)} />
              <button className="btn" disabled={busy || !invite} onClick={() => run(() => joinRoom(invite, identity))}>
                Join
              </button>
            </div>
          </div>
        </>
      )}
      {collab.error && <p className="error small">{collab.error}</p>}
    </Modal>
  )
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows = [
    ['Space', 'Play / pause'],
    ['J / K / L', 'Back 5s / pause / forward 5s'],
    ['← / →', 'Previous / next frame'],
    ['Home / End', 'Start / end'],
    ['V / B', 'Select / razor tool'],
    ['S', 'Split selected (or all) at playhead'],
    ['Delete / Backspace', 'Delete (ripple when magnetic)'],
    ['N', 'Toggle magnetic'],
    ['M', 'Add marker'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
    ['Ctrl+I', 'Import media'],
    ['Ctrl+S', 'Save project'],
    ['Ctrl+K', 'Ask Cutline'],
    ['+ / -', 'Zoom timeline']
  ]
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
