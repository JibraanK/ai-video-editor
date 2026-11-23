import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type CloudProvider = 'openai' | 'anthropic' | 'openai-compatible'
export type CliAgent = 'claude' | 'codex' | 'gemini' | 'custom'
export type TranscriptionMode = 'auto' | 'openai' | 'whisper-cpp' | 'whisper-py'

export interface Settings {
  cloudProvider: CloudProvider
  openaiModel: string
  anthropicModel: string
  compatibleBaseUrl: string
  compatibleModel: string
  cliAgent: CliAgent
  customCliCommand: string
  mcpEnabled: boolean
  mcpPort: number
  transcription: TranscriptionMode
  whisperCppBinary: string
  whisperCppModel: string
  whisperPyModel: string
  ffmpegPath: string
  ffprobePath: string
}

export interface Secrets {
  openaiKey?: string
  anthropicKey?: string
  compatibleKey?: string
}

export const DEFAULT_SETTINGS: Settings = {
  cloudProvider: 'openai',
  openaiModel: 'gpt-4.1',
  anthropicModel: 'claude-sonnet-4-5',
  compatibleBaseUrl: 'http://localhost:11434/v1',
  compatibleModel: 'llama3.1',
  cliAgent: 'claude',
  customCliCommand: 'my-agent --prompt "$CUTLINE_PROMPT"',
  mcpEnabled: true,
  mcpPort: 47821,
  transcription: 'auto',
  whisperCppBinary: '',
  whisperCppModel: '',
  whisperPyModel: 'base',
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe'
}

const file = () => join(app.getPath('userData'), 'settings.json')
const secretsFile = () => join(app.getPath('userData'), 'secrets.bin')

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  try {
    cache = { ...DEFAULT_SETTINGS, ...(existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}) }
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache!
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  writeFileSync(file(), JSON.stringify(cache, null, 2))
  return cache
}

export function getSecrets(): Secrets {
  if (!existsSync(secretsFile())) return {}
  try {
    const raw = readFileSync(secretsFile())
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
    return JSON.parse(json)
  } catch {
    return {}
  }
}

export function saveSecrets(patch: Secrets): void {
  const next = { ...getSecrets(), ...patch }
  for (const k of Object.keys(next) as (keyof Secrets)[]) if (!next[k]) delete next[k]
  const json = JSON.stringify(next)
  writeFileSync(secretsFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8'))
}

/** Which secrets are set, without revealing them to the renderer. */
export function secretStatus(): Record<keyof Secrets, boolean> {
  const s = getSecrets()
  return { openaiKey: !!s.openaiKey || !!process.env.OPENAI_API_KEY, anthropicKey: !!s.anthropicKey || !!process.env.ANTHROPIC_API_KEY, compatibleKey: !!s.compatibleKey }
}

export function openaiKey(): string | undefined {
  return getSecrets().openaiKey || process.env.OPENAI_API_KEY
}

export function anthropicKey(): string | undefined {
  return getSecrets().anthropicKey || process.env.ANTHROPIC_API_KEY
}
