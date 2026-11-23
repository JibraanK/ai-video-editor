/**
 * Pure FFmpeg argument builder for rendering a project. Kept free of Node APIs so it can be unit-tested
 * and reused for timeline audio mixdowns (transcription, silence detection).
 */
import { clipEnd, isTrackAudible, projectDuration, visualTracksBottomUp } from './timeline'
import type { Clip, ExportOptions, Project, TextAnimation } from './types'

export interface TextOverlay {
  clipId: string
  /** Full-frame transparent PNG rendered at export resolution. */
  pngPath: string
}

export interface BuildArgsInput {
  project: Project
  options: ExportOptions
  textOverlays?: TextOverlay[]
  /** .ass file for burned-in captions. */
  captionsPath?: string
  audioOnly?: boolean
}

const f = (n: number) => Number(n.toFixed(4)).toString()

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\\\:').replace(/'/g, "\\\\'")
}

function slideExpr(anim: TextAnimation | undefined, start: number): string {
  if (anim !== 'slide-up') return '0'
  return `if(lt(t-${f(start)},0.4),(1-(t-${f(start)})/0.4)*60,0)`
}

export function buildExportArgs({ project: p, options: o, textOverlays = [], captionsPath, audioOnly }: BuildArgsInput): string[] {
  const rangeStart = o.range?.start ?? 0
  const rangeEnd = o.range?.end ?? projectDuration(p)
  const total = Math.max(0.04, rangeEnd - rangeStart)
  const W = o.width || p.settings.width
  const H = o.height || p.settings.height
  const fps = o.fps || p.settings.fps
  const sx = W / p.settings.width
  const sy = H / p.settings.height
  const wantVideo = !audioOnly && o.videoCodec !== 'none'

  const args: string[] = ['-hide_banner', '-y']
  const filters: string[] = []
  let inputIndex = 0
  const addInput = (...a: string[]) => {
    args.push(...a)
    return inputIndex++
  }

  const mediaById = new Map(p.media.map((m) => [m.id, m]))
  const inRange = (c: Clip) => clipEnd(c) > rangeStart + 1e-6 && c.start < rangeEnd - 1e-6
  /** Clip clamped to the export range, in output time. */
  const window = (c: Clip) => {
    const s = Math.max(c.start, rangeStart)
    const e = Math.min(clipEnd(c), rangeEnd)
    return { outStart: s - rangeStart, dur: e - s, srcIn: c.in + (s - c.start), headCut: s - c.start, tailCut: clipEnd(c) - e }
  }

  // ---------- video ----------
  if (wantVideo) {
    const bg = p.settings.background.replace('#', '0x')
    filters.push(`color=c=${bg}:s=${W}x${H}:r=${fps}:d=${f(total)},format=yuv420p[base0]`)
    let cur = 'base0'
    let n = 0
    const overlayByClip = new Map(textOverlays.map((t) => [t.clipId, t.pngPath]))
    for (const track of visualTracksBottomUp(p)) {
      if (track.hidden || track.kind === 'caption') continue
      const clips = p.clips.filter((c) => c.trackId === track.id && inRange(c)).sort((a, b) => a.start - b.start)
      for (const c of clips) {
        const w = window(c)
        const label = `v${n}`
        if (track.kind === 'text') {
          const png = overlayByClip.get(c.id)
          if (!png) continue
          const idx = addInput('-loop', '1', '-framerate', String(fps), '-t', f(w.dur), '-i', png)
          const chain = [`[${idx}:v]format=rgba`]
          const fadeIn = c.animIn && c.animIn !== 'none' ? 0.35 : 0
          const fadeOut = c.animOut && c.animOut !== 'none' ? 0.35 : 0
          if (fadeIn && w.headCut < fadeIn) chain.push(`fade=t=in:st=0:d=${f(fadeIn - w.headCut)}:alpha=1`)
          if (fadeOut && w.tailCut < fadeOut) chain.push(`fade=t=out:st=${f(Math.max(0, w.dur - (fadeOut - w.tailCut)))}:d=${f(fadeOut - w.tailCut)}:alpha=1`)
          chain.push(`setpts=PTS-STARTPTS+${f(w.outStart)}/TB[${label}]`)
          filters.push(chain.join(','))
          filters.push(`[${cur}][${label}]overlay=x=0:y='${slideExpr(c.animIn, w.outStart)}':eof_action=pass:enable='between(t,${f(w.outStart)},${f(w.outStart + w.dur)})'[base${++n}]`)
          cur = `base${n}`
          continue
        }
        const media = c.mediaId ? mediaById.get(c.mediaId) : undefined
        if (!media || !media.hasVideo) continue
        const idx =
          media.kind === 'image'
            ? addInput('-loop', '1', '-framerate', String(fps), '-t', f(w.dur), '-i', media.path)
            : addInput('-ss', f(w.srcIn), '-t', f(w.dur), '-i', media.path)
        const s = c.transform.scale
        const chain = [
          `[${idx}:v]fps=${fps}`,
          `scale=w=${Math.max(2, Math.round(W * s))}:h=${Math.max(2, Math.round(H * s))}:force_original_aspect_ratio=decrease`,
          'setsar=1',
          'format=rgba'
        ]
        if (c.transform.opacity < 1) chain.push(`colorchannelmixer=aa=${f(c.transform.opacity)}`)
        if (c.fadeIn > w.headCut) chain.push(`fade=t=in:st=0:d=${f(c.fadeIn - w.headCut)}:alpha=1`)
        if (c.fadeOut > w.tailCut) chain.push(`fade=t=out:st=${f(Math.max(0, w.dur - (c.fadeOut - w.tailCut)))}:d=${f(c.fadeOut - w.tailCut)}:alpha=1`)
        chain.push(`setpts=PTS-STARTPTS+${f(w.outStart)}/TB[${label}]`)
        filters.push(chain.join(','))
        const x = `(main_w-overlay_w)/2+${f(c.transform.x * sx)}`
        const y = `(main_h-overlay_h)/2+${f(c.transform.y * sy)}`
        filters.push(`[${cur}][${label}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${f(w.outStart)},${f(w.outStart + w.dur)})'[base${++n}]`)
        cur = `base${n}`
      }
    }
    if (captionsPath && o.burnCaptions) {
      filters.push(`[${cur}]subtitles=filename='${escapeFilterPath(captionsPath)}'[base${++n}]`)
      cur = `base${n}`
    }
    filters.push(`[${cur}]format=yuv420p[vout]`)
  }

  // ---------- audio ----------
  const audioLabels: string[] = []
  const sr = p.settings.sampleRate || 48000
  for (const track of p.tracks) {
    if (track.kind !== 'audio' && track.kind !== 'video') continue
    if (!isTrackAudible(p, track)) continue
    for (const c of p.clips.filter((x) => x.trackId === track.id && inRange(x))) {
      const media = c.mediaId ? mediaById.get(c.mediaId) : undefined
      if (!media || !media.hasAudio || media.kind === 'image') continue
      const w = window(c)
      const idx = addInput('-ss', f(w.srcIn), '-t', f(w.dur), '-i', media.path)
      const label = `a${audioLabels.length}`
      const vol = c.volume * track.gain
      const delay = Math.round(w.outStart * 1000)
      const chain = [`[${idx}:a]asetpts=PTS-STARTPTS`, `aresample=${sr}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo']
      if (vol !== 1) chain.push(`volume=${f(vol)}`)
      if (c.fadeIn > w.headCut) chain.push(`afade=t=in:st=0:d=${f(c.fadeIn - w.headCut)}`)
      if (c.fadeOut > w.tailCut) chain.push(`afade=t=out:st=${f(Math.max(0, w.dur - (c.fadeOut - w.tailCut)))}:d=${f(c.fadeOut - w.tailCut)}`)
      if (delay > 0) chain.push(`adelay=${delay}|${delay}`)
      filters.push(chain.join(',') + `[${label}]`)
      audioLabels.push(label)
    }
  }
  const master = p.masterGain ?? 1
  if (audioLabels.length === 0) {
    filters.push(`anullsrc=r=${sr}:cl=stereo,atrim=0:${f(total)}[aout]`)
  } else if (audioLabels.length === 1) {
    filters.push(`[${audioLabels[0]}]apad,atrim=0:${f(total)}${master !== 1 ? `,volume=${f(master)}` : ''}[aout]`)
  } else {
    // amix divides by input count; scale back up so levels match the preview.
    filters.push(`${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,volume=${f(audioLabels.length * master)},apad,atrim=0:${f(total)}[aout]`)
  }

  args.push('-filter_complex', filters.join(';'))
  if (wantVideo) {
    args.push('-map', '[vout]', '-c:v', o.videoCodec)
    if (o.videoCodec === 'libx264' || o.videoCodec === 'libx265') args.push('-preset', o.preset || 'medium', '-crf', String(o.crf), '-pix_fmt', 'yuv420p')
    else if (o.videoCodec === 'libvpx-vp9') args.push('-b:v', '0', '-crf', String(o.crf), '-deadline', o.preset || 'good', '-row-mt', '1')
    else if (o.videoCodec === 'prores_ks') args.push('-profile:v', o.preset || '3', '-pix_fmt', 'yuv422p10le')
    args.push('-r', String(fps))
  }
  args.push('-map', '[aout]', '-c:a', o.audioCodec, '-ar', String(sr))
  if (o.audioBitrate && o.audioBitrate !== '0') args.push('-b:a', o.audioBitrate)
  if (o.container === 'mp4' || o.container === 'mov') args.push('-movflags', '+faststart')
  args.push('-t', f(total), '-progress', 'pipe:1', '-nostats', o.outputPath)
  return args
}
