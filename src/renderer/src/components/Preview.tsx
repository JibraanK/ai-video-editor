import { useEffect, useRef } from 'react'
import { clipEnd, formatTimecode, isTrackAudible, projectDuration, visualTracksBottomUp } from '@shared/timeline'
import type { Clip, MediaItem, Project } from '@shared/types'
import { getState, useStore } from '../store'
import { mediaUrl } from '../lib/media'
import { drawTextClip } from '../lib/textRender'
import { AreaCursors, areaPointer } from './Cursors'

type El = HTMLVideoElement | HTMLAudioElement | HTMLImageElement
const pool = new Map<string, { el: El; src: string }>()

function elementFor(clip: Clip, media: MediaItem): El {
  const src = mediaUrl(media)
  const hit = pool.get(clip.id)
  if (hit && hit.src === src) return hit.el
  if (hit && hit.el instanceof HTMLMediaElement) hit.el.pause()
  const el: El = media.kind === 'image' ? new Image() : media.kind === 'audio' ? new Audio() : document.createElement('video')
  if (el instanceof HTMLMediaElement) {
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    if (el instanceof HTMLVideoElement) el.playsInline = true
  }
  el.src = src
  pool.set(clip.id, { el, src })
  return el
}

function fadeGain(c: Clip, local: number): number {
  let g = 1
  if (c.fadeIn > 0 && local < c.fadeIn) g *= local / c.fadeIn
  if (c.fadeOut > 0 && c.duration - local < c.fadeOut) g *= Math.max(0, (c.duration - local) / c.fadeOut)
  return Math.max(0, Math.min(1, g))
}

function syncAndDraw(ctx: CanvasRenderingContext2D, p: Project, t: number, playing: boolean): void {
  const W = p.settings.width
  const H = p.settings.height
  ctx.fillStyle = p.settings.background
  ctx.fillRect(0, 0, W, H)
  const mediaById = new Map(p.media.map((m) => [m.id, m]))
  const live = new Set<string>()
  const trackById = new Map(p.tracks.map((tr) => [tr.id, tr]))

  for (const c of p.clips) {
    const m = c.mediaId ? mediaById.get(c.mediaId) : undefined
    if (!m) continue
    const active = t >= c.start && t < clipEnd(c)
    if (!active) continue
    live.add(c.id)
    const el = elementFor(c, m)
    if (!(el instanceof HTMLMediaElement)) continue
    const local = t - c.start
    const expected = c.in + local
    const track = trackById.get(c.trackId)!
    el.muted = !isTrackAudible(p, track) || !m.hasAudio
    el.volume = Math.min(1, track.gain * c.volume * p.masterGain * fadeGain(c, local))
    if (playing) {
      if (Math.abs(el.currentTime - expected) > 0.3) el.currentTime = expected
      if (el.paused) void el.play().catch(() => {})
    } else {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - expected) > 0.02 && !el.seeking) el.currentTime = expected
    }
  }
  for (const [id, { el }] of pool) {
    if (live.has(id)) continue
    if (el instanceof HTMLMediaElement && !el.paused) el.pause()
    if (!p.clips.some((c) => c.id === id)) pool.delete(id)
  }

  for (const track of visualTracksBottomUp(p)) {
    if (track.hidden) continue
    for (const c of p.clips) {
      if (c.trackId !== track.id || t < c.start || t >= clipEnd(c)) continue
      const local = t - c.start
      if (c.text !== undefined && !c.mediaId) {
        drawTextClip(ctx, c, W, H, local)
        continue
      }
      const m = c.mediaId ? mediaById.get(c.mediaId) : undefined
      const el = pool.get(c.id)?.el
      if (!m || !el || m.kind === 'audio') continue
      const sw = el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth
      const sh = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight
      if (!sw || !sh) continue
      const fit = Math.min(W / sw, H / sh) * c.transform.scale
      const dw = sw * fit
      const dh = sh * fit
      ctx.save()
      ctx.globalAlpha = c.transform.opacity * fadeGain(c, local)
      ctx.drawImage(el as HTMLVideoElement | HTMLImageElement, (W - dw) / 2 + c.transform.x, (H - dh) / 2 + c.transform.y, dw, dh)
      ctx.restore()
    }
  }
}

export function stopAllMedia(): void {
  for (const { el } of pool.values()) if (el instanceof HTMLMediaElement) el.pause()
}

export function Preview() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const settings = useStore((s) => s.project.settings)
  const playing = useStore((s) => s.playing)
  const playhead = useStore((s) => s.playhead)
  const duration = useStore((s) => projectDuration(s.project))

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const s = getState()
      const dt = (now - last) / 1000
      last = now
      if (s.playing) {
        const end = projectDuration(s.project)
        const next = s.playhead + dt
        if (next >= end) {
          s.set({ playing: false, playhead: end })
        } else s.setPlayhead(next)
      }
      const ctx = canvas.current?.getContext('2d')
      if (ctx) syncAndDraw(ctx, s.project, getState().playhead, getState().playing)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      stopAllMedia()
    }
  }, [])

  const toggle = () => {
    const s = getState()
    if (!s.playing && s.playhead >= projectDuration(s.project) - 0.01) s.setPlayhead(0)
    s.setPlaying(!s.playing)
  }

  return (
    <div className="preview" data-guide="preview">
      <div className="preview-stage" {...areaPointer('preview')}>
        <canvas ref={canvas} width={settings.width} height={settings.height} style={{ aspectRatio: `${settings.width}/${settings.height}` }} onClick={toggle} />
        <AreaCursors area="preview" />
      </div>
      <div className="transport">
        <button className="icon-btn" title="Go to start (Home)" onClick={() => getState().setPlayhead(0)}>
          ⏮
        </button>
        <button className="icon-btn" title="Back 1 frame (←)" onClick={() => getState().setPlayhead(playhead - 1 / settings.fps)}>
          ◀
        </button>
        <button className="play-btn" data-guide="preview.play" title="Play / pause (Space)" onClick={toggle}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="icon-btn" title="Forward 1 frame (→)" onClick={() => getState().setPlayhead(playhead + 1 / settings.fps)}>
          ▶
        </button>
        <button className="icon-btn" title="Go to end (End)" onClick={() => getState().setPlayhead(duration)}>
          ⏭
        </button>
        <span className="timecode" data-guide="preview.timecode">
          {formatTimecode(playhead, settings.fps)} <span className="muted">/ {formatTimecode(duration, settings.fps)}</span>
        </span>
      </div>
    </div>
  )
}
