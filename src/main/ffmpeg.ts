import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { uid } from '@shared/id'
import type { MediaItem } from '@shared/types'
import { getSettings } from './settings'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  signal?: AbortSignal
  binary?: boolean
}

export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult & { buffer?: Buffer }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true })
    const out: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      out.push(d)
      opts.onStdout?.(d.toString())
    })
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      stderr += s
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000)
      opts.onStderr?.(s)
    })
    opts.signal?.addEventListener('abort', () => proc.kill('SIGKILL'))
    proc.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ENOENT' ? new Error(`${bin} not found. Install it or set its path in Settings.`) : e))
    proc.on('close', (code) => {
      const buffer = Buffer.concat(out)
      resolve({ code: code ?? -1, stdout: opts.binary ? '' : buffer.toString(), stderr, buffer: opts.binary ? buffer : undefined })
    })
  })
}

export const ffmpeg = (args: string[], opts?: RunOptions) => run(getSettings().ffmpegPath || 'ffmpeg', args, opts)
export const ffprobe = (args: string[], opts?: RunOptions) => run(getSettings().ffprobePath || 'ffprobe', args, opts)

export function cacheDir(sub: string): string {
  const d = join(app.getPath('userData'), 'cache', sub)
  mkdirSync(d, { recursive: true })
  return d
}

function fileKey(path: string): string {
  const st = statSync(path)
  return createHash('sha1').update(`${path}:${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 16)
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'])

export interface ProbeInfo {
  duration: number
  width?: number
  height?: number
  fps?: number
  hasAudio: boolean
  hasVideo: boolean
  isImage: boolean
}

export async function probe(path: string): Promise<ProbeInfo> {
  const r = await ffprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path])
  if (r.code !== 0) throw new Error(`Could not read ${basename(path)}: ${r.stderr.trim().split('\n').pop()}`)
  const j = JSON.parse(r.stdout)
  const streams: any[] = j.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const a = streams.find((s) => s.codec_type === 'audio')
  const isImage = IMAGE_EXT.has(extname(path).toLowerCase()) || /image2|_pipe$/.test(j.format?.format_name ?? '')
  const [n, d] = String(v?.avg_frame_rate || v?.r_frame_rate || '0/1').split('/').map(Number)
  return {
    duration: Number(j.format?.duration ?? v?.duration ?? a?.duration ?? 0) || (isImage ? 5 : 0),
    width: v?.width,
    height: v?.height,
    fps: d ? Math.round((n / d) * 100) / 100 : undefined,
    hasAudio: !!a,
    hasVideo: !!v,
    isImage
  }
}

export async function thumbnail(path: string, info: ProbeInfo): Promise<string | undefined> {
  if (!info.hasVideo) return undefined
  const out = join(cacheDir('thumbs'), `${fileKey(path)}.jpg`)
  if (existsSync(out)) return out
  const at = info.isImage ? [] : ['-ss', String(Math.min(1, info.duration * 0.1))]
  const r = await ffmpeg(['-hide_banner', '-y', ...at, '-i', path, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out])
  return r.code === 0 ? out : undefined
}

export async function importMedia(path: string): Promise<MediaItem> {
  const info = await probe(path)
  const kind: MediaItem['kind'] = info.isImage ? 'image' : info.hasVideo ? 'video' : 'audio'
  return {
    id: uid('med_'),
    name: basename(path),
    path,
    kind,
    duration: info.duration,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: info.hasAudio && kind !== 'image',
    hasVideo: info.hasVideo,
    thumbnail: await thumbnail(path, info)
  }
}

export const PEAKS_PER_SECOND = 50

/** Normalised audio peaks (0..1) at PEAKS_PER_SECOND, cached on disk. */
export async function waveform(path: string): Promise<number[]> {
  const cached = join(cacheDir('waveforms'), `${fileKey(path)}.json`)
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'))
  const rate = 4000
  const r = await ffmpeg(['-hide_banner', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { binary: true })
  const buf = r.buffer ?? Buffer.alloc(0)
  const per = rate / PEAKS_PER_SECOND
  const samples = Math.floor(buf.length / 2)
  const peaks: number[] = []
  for (let i = 0; i < samples; i += per) {
    let max = 0
    for (let j = i; j < Math.min(samples, i + per); j++) max = Math.max(max, Math.abs(buf.readInt16LE(j * 2)))
    peaks.push(Math.round((max / 32768) * 1000) / 1000)
  }
  writeFileSync(cached, JSON.stringify(peaks))
  return peaks
}

export interface Range {
  start: number
  end: number
}

export async function detectSilences(path: string, thresholdDb = -35, minDuration = 0.6): Promise<Range[]> {
  const r = await ffmpeg(['-hide_banner', '-nostats', '-i', path, '-vn', '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`, '-f', 'null', '-'])
  const out: Range[] = []
  let start: number | null = null
  for (const line of r.stderr.split('\n')) {
    const s = line.match(/silence_start: (-?[\d.]+)/)
    if (s) start = Math.max(0, Number(s[1]))
    const e = line.match(/silence_end: ([\d.]+)/)
    if (e && start != null) {
      out.push({ start, end: Number(e[1]) })
      start = null
    }
  }
  if (start != null) {
    const info = await probe(path)
    out.push({ start, end: info.duration })
  }
  return out
}

export async function detectScenes(path: string, threshold = 0.35, start?: number, duration?: number): Promise<number[]> {
  const seek = start != null ? ['-ss', String(start)] : []
  const len = duration != null ? ['-t', String(duration)] : []
  const r = await ffmpeg(['-hide_banner', '-nostats', ...seek, ...len, '-i', path, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'])
  const times: number[] = []
  for (const m of r.stderr.matchAll(/pts_time:([\d.]+)/g)) times.push(Number(m[1]) + (start ?? 0))
  return times
}
