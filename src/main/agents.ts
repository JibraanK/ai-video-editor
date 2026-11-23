import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_SYSTEM_PROMPT, ALL_TOOLS } from '@shared/agentTools'
import { emit } from './bridge'
import { mcpStatus, mcpUrl, startMcpServer } from './mcpServer'
import { anthropicKey, getSecrets, getSettings, openaiKey } from './settings'
import { executeTool } from './tools'

type Event = { source: string; type: 'assistant' | 'tool' | 'tool_result' | 'log' | 'error' | 'done' | 'status'; text?: string; name?: string; args?: unknown; ok?: boolean; error?: string }
const ev = (e: Event) => emit('agent:event', e)

let abort: AbortController | null = null
let child: ChildProcess | null = null
let openaiHistory: any[] = []
let anthropicHistory: any[] = []

export function cancelAgent(): void {
  abort?.abort()
  child?.kill()
}

export function resetAgent(): void {
  openaiHistory = []
  anthropicHistory = []
}

const truncate = (v: unknown, n = 6000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > n ? s.slice(0, n) + '…(truncated)' : s
}

async function runTool(name: string, args: any): Promise<string> {
  ev({ source: 'cloud', type: 'tool', name, args })
  try {
    const r = await executeTool(name, args)
    ev({ source: 'cloud', type: 'tool_result', name, ok: true })
    return truncate(r ?? { ok: true })
  } catch (e) {
    ev({ source: 'cloud', type: 'tool_result', name, ok: false, error: (e as Error).message })
    return `Error: ${(e as Error).message}`
  }
}

async function postJSON(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 600)}`)
  return res.json()
}

async function runOpenAI(prompt: string, baseUrl: string, key: string | undefined, model: string, signal: AbortSignal) {
  const tools = ALL_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
  openaiHistory.push({ role: 'user', content: prompt })
  for (let step = 0; step < 40; step++) {
    const j = await postJSON(`${baseUrl.replace(/\/$/, '')}/chat/completions`, key ? { Authorization: `Bearer ${key}` } : {}, { model, messages: [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, ...openaiHistory], tools }, signal)
    const msg = j.choices?.[0]?.message
    if (!msg) throw new Error('Empty response from model')
    openaiHistory.push(msg)
    if (msg.content) ev({ source: 'cloud', type: 'assistant', text: msg.content })
    if (!msg.tool_calls?.length) return
    for (const call of msg.tool_calls) {
      let args = {}
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        /* model sent invalid JSON; pass empty args */
      }
      openaiHistory.push({ role: 'tool', tool_call_id: call.id, content: await runTool(call.function.name, args) })
    }
  }
}

async function runAnthropic(prompt: string, key: string, model: string, signal: AbortSignal) {
  const tools = ALL_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
  anthropicHistory.push({ role: 'user', content: prompt })
  for (let step = 0; step < 40; step++) {
    const j = await postJSON('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: 4096, system: AGENT_SYSTEM_PROMPT, messages: anthropicHistory, tools }, signal)
    anthropicHistory.push({ role: 'assistant', content: j.content })
    const text = (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    if (text) ev({ source: 'cloud', type: 'assistant', text })
    const uses = (j.content ?? []).filter((b: any) => b.type === 'tool_use')
    if (j.stop_reason !== 'tool_use' || !uses.length) return
    const results = []
    for (const u of uses) results.push({ type: 'tool_result', tool_use_id: u.id, content: await runTool(u.name, u.input ?? {}) })
    anthropicHistory.push({ role: 'user', content: results })
  }
}

/** Built-in cloud agent: tool-calling loop over the editor tools (OpenAI, Anthropic or any OpenAI-compatible server such as Ollama). */
export async function runCloudAgent(prompt: string): Promise<void> {
  const s = getSettings()
  abort = new AbortController()
  try {
    if (s.cloudProvider === 'anthropic') {
      const key = anthropicKey()
      if (!key) throw new Error('Add an Anthropic API key in Settings')
      await runAnthropic(prompt, key, s.anthropicModel, abort.signal)
    } else if (s.cloudProvider === 'openai-compatible') {
      await runOpenAI(prompt, s.compatibleBaseUrl, getSecrets().compatibleKey, s.compatibleModel, abort.signal)
    } else {
      const key = openaiKey()
      if (!key) throw new Error('Add an OpenAI API key in Settings')
      await runOpenAI(prompt, 'https://api.openai.com/v1', key, s.openaiModel, abort.signal)
    }
  } catch (e) {
    if (!abort.signal.aborted) ev({ source: 'cloud', type: 'error', text: (e as Error).message })
  } finally {
    abort = null
    ev({ source: 'cloud', type: 'done' })
  }
}

function workspace(): string {
  const dir = join(app.getPath('userData'), 'agent-workspace')
  mkdirSync(join(dir, '.gemini'), { recursive: true })
  return dir
}

export function stdioBridgePath(): string {
  return join(app.getAppPath(), 'bin', 'mcp-stdio.mjs')
}

/** Ready-to-paste MCP configs for external agents. */
export function mcpConfigSnippets() {
  const url = mcpUrl(mcpStatus().port || getSettings().mcpPort)
  return {
    url,
    claude: `claude mcp add --transport http cutline ${url}`,
    json: JSON.stringify({ mcpServers: { cutline: { type: 'http', url } } }, null, 2),
    codex: `[mcp_servers.cutline]\ncommand = "node"\nargs = [${JSON.stringify(stdioBridgePath())}]\nenv = { CUTLINE_MCP_URL = "${url}" }`,
    stdio: `CUTLINE_MCP_URL=${url} node ${stdioBridgePath()}`
  }
}

function spawnAgent(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}, shell = false): Promise<void> {
  return new Promise((resolve) => {
    ev({ source: 'cli', type: 'status', text: `$ ${cmd} ${args.map((a) => (a.length > 60 ? a.slice(0, 57) + '…' : a)).join(' ')}` })
    const proc = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: shell || process.platform === 'win32', windowsHide: true })
    child = proc
    proc.stdout.on('data', (d) => ev({ source: 'cli', type: 'log', text: d.toString() }))
    proc.stderr.on('data', (d) => ev({ source: 'cli', type: 'log', text: d.toString() }))
    proc.on('error', (e: NodeJS.ErrnoException) => ev({ source: 'cli', type: 'error', text: e.code === 'ENOENT' ? `${cmd} is not installed or not on PATH` : e.message }))
    proc.on('close', (code) => {
      child = null
      ev({ source: 'cli', type: code === 0 ? 'done' : 'error', text: code === 0 ? undefined : `exited with code ${code}` })
      resolve()
    })
  })
}

/** Runs a local CLI agent (Claude Code, Codex, Gemini CLI or custom) connected to the editor through MCP. */
export async function runCliAgent(prompt: string): Promise<void> {
  const s = getSettings()
  const { url } = await startMcpServer(mcpStatus().port || s.mcpPort)
  const cwd = workspace()
  const full = `${AGENT_SYSTEM_PROMPT}\n\nThe editor is connected through the "cutline" MCP server. User request:\n${prompt}`
  if (s.cliAgent === 'claude') {
    const cfg = join(cwd, 'mcp.json')
    writeFileSync(cfg, JSON.stringify({ mcpServers: { cutline: { type: 'http', url } } }))
    return spawnAgent('claude', ['-p', full, '--mcp-config', cfg, '--allowedTools', 'mcp__cutline', '--output-format', 'text'], cwd)
  }
  if (s.cliAgent === 'codex') {
    return spawnAgent(
      'codex',
      ['exec', '--skip-git-repo-check', '-c', `mcp_servers.cutline.command=${JSON.stringify(process.execPath)}`, '-c', `mcp_servers.cutline.args=[${JSON.stringify(stdioBridgePath())}]`, '-c', `mcp_servers.cutline.env={ELECTRON_RUN_AS_NODE="1",CUTLINE_MCP_URL="${url}"}`, full],
      cwd
    )
  }
  if (s.cliAgent === 'gemini') {
    writeFileSync(join(cwd, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: { cutline: { httpUrl: url, trust: true } } }))
    return spawnAgent('gemini', ['-p', full, '--yolo'], cwd)
  }
  return spawnAgent(s.customCliCommand, [], cwd, { CUTLINE_PROMPT: full, CUTLINE_MCP_URL: url }, true)
}

/** "Build it for me": a coding agent edits Cutline's own source; electron-vite dev reloads the app. */
export async function buildFeature(request: string): Promise<{ started: boolean; cwd: string }> {
  if (app.isPackaged) throw new Error('Building features needs Cutline running from source (npm run dev)')
  const cwd = app.getAppPath()
  const prompt = `You are working on Cutline, an Electron + React + TypeScript video editor (this repository). Read README.md for the architecture. Implement this feature end to end, keep changes minimal and consistent with existing code, and make sure \`npm run typecheck\` and \`npm test\` pass:\n\n${request}`
  const s = getSettings()
  const run =
    s.cliAgent === 'codex'
      ? spawnAgent('codex', ['exec', '--full-auto', prompt], cwd)
      : s.cliAgent === 'gemini'
        ? spawnAgent('gemini', ['-p', prompt, '--yolo'], cwd)
        : spawnAgent('claude', ['-p', prompt, '--permission-mode', 'acceptEdits', '--output-format', 'text'], cwd)
  void run
  return { started: true, cwd }
}
