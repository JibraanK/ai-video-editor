import { useEffect, useRef, useState } from 'react'
import { getState } from '../store'
import { useGuide } from '../lib/guide'
import { findBuiltinGuide } from '../lib/builtinGuides'

type Msg = { role: 'user' | 'assistant' | 'tool' | 'log' | 'error' | 'status'; text: string }
type Mode = 'cloud' | 'cli'

const QUICK = ['How do I add captions?', 'Suggest cuts for silences and filler words', 'Make this a 30s vertical short with captions', 'Add a button that inserts a 1s gap between every clip']

function McpCard() {
  const [st, setSt] = useState<any>(null)
  useEffect(() => void window.api.mcpStatus().then(setSt), [])
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => getState().toast('Copied'))
  if (!st) return null
  return (
    <details className="card mcp" data-guide="agent.mcp">
      <summary>
        <span className={`dot ${st.running ? 'ok' : ''}`} /> MCP server {st.running ? `on :${st.port}` : 'off'}
      </summary>
      <p className="muted small">Any MCP client (Claude Code, Codex, Cursor, Gemini CLI…) can drive this editor.</p>
      <div className="row wrap">
        <button className="btn sm" onClick={() => (st.running ? window.api.mcpStop() : window.api.mcpStart()).then(setSt)}>
          {st.running ? 'Stop' : 'Start'}
        </button>
        <button className="btn sm" onClick={() => copy(st.snippets.claude)}>
          Copy Claude Code cmd
        </button>
        <button className="btn sm" onClick={() => copy(st.snippets.json)}>
          Copy JSON config
        </button>
        <button className="btn sm" onClick={() => copy(st.snippets.codex)}>
          Copy Codex config
        </button>
      </div>
      <code className="small">{st.snippets.url}</code>
    </details>
  )
}

export function AgentPanel({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', text: 'Hi! Ask me to edit (“remove the silences”), to show you how to do something (“how do I add a title?”), or to build a feature the editor doesn’t have yet.' }])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('cutline.agentMode') as Mode) || 'cloud')
  const [running, setRunning] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      window.api.onAgentEvent((e) => {
        const add = (m: Msg) => setMsgs((prev) => (m.role === 'log' && prev[prev.length - 1]?.role === 'log' ? [...prev.slice(0, -1), { role: 'log', text: (prev[prev.length - 1].text + m.text).slice(-4000) }] : [...prev, m]))
        if (e.type === 'assistant') add({ role: 'assistant', text: e.text })
        else if (e.type === 'tool') add({ role: 'tool', text: `→ ${e.name}` })
        else if (e.type === 'tool_result' && !e.ok) add({ role: 'error', text: `${e.name} failed: ${e.error}` })
        else if (e.type === 'log') add({ role: 'log', text: e.text })
        else if (e.type === 'status') add({ role: 'status', text: e.text })
        else if (e.type === 'error') add({ role: 'error', text: e.text })
        if (e.type === 'done' || (e.type === 'error' && e.source === 'cloud')) setRunning(false)
      }),
    []
  )
  useEffect(() => scroll.current?.scrollTo(0, scroll.current.scrollHeight), [msgs])
  useEffect(() => localStorage.setItem('cutline.agentMode', mode), [mode])

  const send = async (text = input) => {
    const prompt = text.trim()
    if (!prompt || running) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text: prompt }])
    const guide = findBuiltinGuide(prompt)
    if (guide) {
      useGuide.getState().start(guide.title, guide.steps)
      setMsgs((m) => [...m, { role: 'assistant', text: `Showing you on screen: ${guide.title}. Want me to just do it instead? Say “do it”.` }])
      return
    }
    setRunning(true)
    try {
      await (mode === 'cloud' ? window.api.agentCloud(prompt) : window.api.agentCli(prompt))
    } catch (e) {
      setMsgs((m) => [...m, { role: 'error', text: (e as Error).message }])
      setRunning(false)
    }
  }

  return (
    <div className="panel agent">
      <div className="panel-title row between">
        <span>Ask Cutline</span>
        <div className="row">
          <select className="input sm" data-guide="agent.mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} title="Who handles your request">
            <option value="cloud">Cloud agent</option>
            <option value="cli">Local CLI agent</option>
          </select>
          <button
            className="btn sm ghost"
            title="New conversation"
            onClick={() => {
              void window.api.agentReset()
              setMsgs([])
            }}
          >
            ⟲
          </button>
          <button className="btn sm ghost" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      <McpCard />
      <div className="chat" ref={scroll}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {running && <div className="msg status">Working…</div>}
      </div>
      {msgs.length <= 1 && (
        <div className="quick">
          {QUICK.map((q) => (
            <button key={q} className="chip" onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="chat-input" data-guide="agent.input">
        <textarea
          className="input"
          rows={2}
          placeholder="Ask, or describe an edit…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        {running ? (
          <button className="btn danger" onClick={() => window.api.agentCancel()}>
            Stop
          </button>
        ) : (
          <button className="btn primary" onClick={() => send()}>
            Send
          </button>
        )}
      </div>
    </div>
  )
}
