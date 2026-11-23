import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { uid } from '@shared/id'
import type { Word } from '@shared/types'
import { cacheDir, ffmpeg, run } from './ffmpeg'
import { getSettings, openaiKey } from './settings'

function which(cmd: string): string | null {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' })
    return out.split(/\r?\n/)[0].trim() || null
  } catch {
    return null
  }
}

async function convert(input: string, ext: 'wav' | 'mp3'): Promise<string> {
  const out = join(cacheDir('transcribe'), `${uid('aud_')}.${ext}`)
  const codec = ext === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '48k'] : ['-c:a', 'pcm_s16le']
  const r = await ffmpeg(['-hide_banner', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', ...codec, out])
  if (r.code !== 0) throw new Error('Could not prepare audio for transcription')
  return out
}

async function viaOpenAI(audio: string, language?: string): Promise<Word[]> {
  const key = openaiKey()
  if (!key) throw new Error('Set an OpenAI API key in Settings for cloud transcription')
  const mp3 = await convert(audio, 'mp3')
  const form = new FormData()
  form.append('file', new Blob([readFileSync(mp3)], { type: 'audio/mpeg' }), basename(mp3))
  form.append('model', 'whisper-1')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  if (language) form.append('language', language)
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form })
  if (!res.ok) throw new Error(`OpenAI transcription failed (${res.status}): ${await res.text()}`)
  const j: any = await res.json()
  return (j.words ?? []).map((w: any) => ({ start: w.start, end: w.end, text: w.word }))
}

function whisperCppBinary(): string | null {
  const s = getSettings()
  if (s.whisperCppBinary && existsSync(s.whisperCppBinary)) return s.whisperCppBinary
  return which('whisper-cli') ?? which('whisper-cpp')
}

async function viaWhisperCpp(audio: string, language?: string): Promise<Word[]> {
  const bin = whisperCppBinary()
  const model = getSettings().whisperCppModel
  if (!bin) throw new Error('whisper.cpp (whisper-cli) not found')
  if (!model || !existsSync(model)) throw new Error('Set the whisper.cpp model file (ggml-*.bin) in Settings')
  const wav = await convert(audio, 'wav')
  const outBase = wav.replace(/\.wav$/, '')
  const r = await run(bin, ['-m', model, '-f', wav, '-ml', '1', '-sow', '-oj', '-of', outBase, '-l', language ?? 'auto'])
  if (r.code !== 0) throw new Error(`whisper.cpp failed: ${r.stderr.slice(-400)}`)
  const j = JSON.parse(readFileSync(`${outBase}.json`, 'utf8'))
  return (j.transcription ?? [])
    .map((s: any) => ({ start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: String(s.text).trim() }))
    .filter((w: Word) => w.text && !/^\[.*\]$/.test(w.text))
}

async function viaWhisperPy(audio: string, language?: string): Promise<Word[]> {
  const bin = which('whisper')
  if (!bin) throw new Error('openai-whisper CLI not found (pip install openai-whisper)')
  const dir = join(cacheDir('transcribe'), uid('wpy_'))
  const args = [audio, '--model', getSettings().whisperPyModel || 'base', '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', dir]
  if (language) args.push('--language', language)
  const r = await run(bin, args)
  if (r.code !== 0) throw new Error(`whisper failed: ${r.stderr.slice(-400)}`)
  const file = readdirSync(dir).find((f) => f.endsWith('.json'))
  const j = JSON.parse(readFileSync(join(dir, file!), 'utf8'))
  return (j.segments ?? []).flatMap((s: any) => (s.words ?? []).map((w: any) => ({ start: w.start, end: w.end, text: String(w.word).trim() })))
}

export function transcriptionBackends() {
  return { whisperCpp: !!whisperCppBinary(), whisperPy: !!which('whisper'), openai: !!openaiKey() }
}

/** Transcribes an audio/video file to word timings using the configured backend. */
export async function transcribe(audio: string, language?: string): Promise<Word[]> {
  const mode = getSettings().transcription
  if (mode === 'openai') return viaOpenAI(audio, language)
  if (mode === 'whisper-cpp') return viaWhisperCpp(audio, language)
  if (mode === 'whisper-py') return viaWhisperPy(audio, language)
  const b = transcriptionBackends()
  if (b.whisperCpp && getSettings().whisperCppModel) return viaWhisperCpp(audio, language)
  if (b.whisperPy) return viaWhisperPy(audio, language)
  if (b.openai) return viaOpenAI(audio, language)
  throw new Error('No transcription backend: install whisper.cpp or openai-whisper, or add an OpenAI API key in Settings.')
}
