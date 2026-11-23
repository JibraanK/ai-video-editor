import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toASS, type CaptionSegment } from '@shared/captions'
import { buildExportArgs } from '@shared/exportGraph'
import { uid } from '@shared/id'
import { CAPTION_STYLE, EXPORT_PRESETS } from '@shared/presets'
import { projectDuration } from '@shared/timeline'
import type { ExportOptions, Project } from '@shared/types'
import { callRenderer, emit } from './bridge'
import { cacheDir, ffmpeg } from './ffmpeg'

let current: AbortController | null = null

export function cancelExport(): void {
  current?.abort()
}

export function exportOptionsFromPreset(presetId: string | undefined, project: Project, outputPath: string, burnCaptions = true): ExportOptions {
  const preset = EXPORT_PRESETS.find((p) => p.id === presetId) ?? EXPORT_PRESETS[0]
  const o = { ...preset.options, outputPath, burnCaptions }
  // Keep the project's aspect when the preset is a generic landscape one.
  if (o.width && preset.id.startsWith('yt') && project.settings.height > project.settings.width) [o.width, o.height] = [o.height, o.width]
  return o
}

function captionSegments(p: Project): { segs: CaptionSegment[]; style: typeof CAPTION_STYLE } {
  const ids = new Set(p.tracks.filter((t) => t.kind === 'caption' && !t.hidden).map((t) => t.id))
  const clips = p.clips.filter((c) => ids.has(c.trackId) && c.text).sort((a, b) => a.start - b.start)
  return { segs: clips.map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text! })), style: clips[0]?.textStyle ?? CAPTION_STYLE }
}

/** Renders the project with FFmpeg. Text clips are rasterised by the renderer so they match the preview. */
export async function renderProject(project: Project, options: ExportOptions): Promise<{ outputPath: string; duration: number }> {
  if (current) throw new Error('An export is already running')
  const work = join(cacheDir('export'), uid('job_'))
  mkdirSync(work, { recursive: true })
  const W = options.width || project.settings.width
  const H = options.height || project.settings.height
  const wantVideo = options.videoCodec !== 'none'

  const textOverlays: { clipId: string; pngPath: string }[] = []
  if (wantVideo) {
    const textTrackIds = new Set(project.tracks.filter((t) => t.kind === 'text' && !t.hidden).map((t) => t.id))
    const clipIds = project.clips.filter((c) => textTrackIds.has(c.trackId)).map((c) => c.id)
    if (clipIds.length) {
      const images: { clipId: string; dataUrl: string }[] = await callRenderer('renderTextOverlays', { clipIds, width: W, height: H })
      for (const img of images) {
        const pngPath = join(work, `${img.clipId}.png`)
        writeFileSync(pngPath, Buffer.from(img.dataUrl.split(',')[1], 'base64'))
        textOverlays.push({ clipId: img.clipId, pngPath })
      }
    }
  }
  let captionsPath: string | undefined
  const { segs, style } = captionSegments(project)
  if (wantVideo && options.burnCaptions && segs.length) {
    const shift = options.range?.start ?? 0
    const shifted = segs.map((s) => ({ ...s, start: s.start - shift, end: s.end - shift })).filter((s) => s.end > 0)
    const scale = H / project.settings.height
    captionsPath = join(work, 'captions.ass')
    writeFileSync(captionsPath, toASS(shifted, { ...style, fontSize: Math.round(style.fontSize * scale), strokeWidth: style.strokeWidth * scale }, W, H))
  }

  const args = buildExportArgs({ project, options, textOverlays, captionsPath })
  const total = (options.range ? options.range.end - options.range.start : projectDuration(project)) || 0.04
  current = new AbortController()
  emit('export:progress', { progress: 0, status: 'running' })
  try {
    let buffer = ''
    const r = await ffmpeg(args, {
      signal: current.signal,
      onStdout: (chunk) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const m = line.match(/^out_time_(?:ms|us)=(\d+)/)
          if (m) emit('export:progress', { progress: Math.min(1, Number(m[1]) / 1e6 / total), status: 'running' })
        }
      }
    })
    if (current.signal.aborted) throw new Error('Export cancelled')
    if (r.code !== 0) throw new Error(`FFmpeg failed:\n${r.stderr.split('\n').slice(-12).join('\n')}`)
    emit('export:progress', { progress: 1, status: 'done', outputPath: options.outputPath })
    return { outputPath: options.outputPath, duration: total }
  } catch (e) {
    emit('export:progress', { progress: 0, status: 'error', error: (e as Error).message })
    throw e
  } finally {
    current = null
  }
}

/** Mixes the timeline's audio to a WAV (for transcription and silence detection). */
export async function renderTimelineAudio(project: Project): Promise<string> {
  if (projectDuration(project) <= 0) throw new Error('The timeline is empty')
  const out = join(cacheDir('mixdown'), `${uid('mix_')}.wav`)
  const options = { ...EXPORT_PRESETS.find((p) => p.id === 'wav')!.options, outputPath: out, burnCaptions: false }
  const args = buildExportArgs({ project, options, audioOnly: true })
  const r = await ffmpeg(args)
  if (r.code !== 0) throw new Error(`Audio mixdown failed: ${r.stderr.split('\n').slice(-5).join('\n')}`)
  return out
}
