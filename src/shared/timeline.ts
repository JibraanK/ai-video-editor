import { uid } from './id'
import type { Clip, Project, Track } from './types'

export const EPS = 1e-6

export const clipEnd = (c: Clip): number => c.start + c.duration

export function projectDuration(p: Project): number {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
}

export function trackById(p: Project, id: string): Track | undefined {
  return p.tracks.find((t) => t.id === id)
}

export function clipsOnTrack(p: Project, trackId: string): Clip[] {
  return p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start)
}

export function clipsAt(p: Project, t: number): Clip[] {
  return p.clips.filter((c) => t >= c.start - EPS && t < clipEnd(c) - EPS)
}

export function trackEnd(p: Project, trackId: string): number {
  return clipsOnTrack(p, trackId).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
}

/** Tracks drawn in compositing order: bottom-most visual track first. */
export function visualTracksBottomUp(p: Project): Track[] {
  return p.tracks.filter((t) => t.kind !== 'audio').reverse()
}

export function isTrackAudible(p: Project, track: Track): boolean {
  if (track.muted) return false
  const anySolo = p.tracks.some((t) => t.solo)
  return !anySolo || track.solo
}

export const round = (n: number, digits = 4): number => Math.round(n * 10 ** digits) / 10 ** digits

/** Magnetic mode: closes gaps on a track so clips sit back to back from t=0 (keeping order). */
export function packTrack(p: Project, trackId: string): void {
  let t = 0
  for (const c of clipsOnTrack(p, trackId)) {
    c.start = round(t)
    t = clipEnd(c)
  }
}

/** Moves later clips on the track right so nothing overlaps `clip` (insert edit). */
export function resolveOverlapsByPush(p: Project, clip: Clip): void {
  const others = clipsOnTrack(p, clip.trackId).filter((c) => c.id !== clip.id)
  let cursor = clipEnd(clip)
  for (const c of others) {
    if (clipEnd(c) <= clip.start + EPS) continue
    if (c.start < clip.start - EPS) {
      // Clip starts before the inserted clip but overlaps it: split it around the insert.
      const tail = splitClip(p, c.id, clip.start)
      if (tail) {
        tail.start = cursor
        cursor = clipEnd(tail)
      }
      continue
    }
    if (c.start < cursor - EPS) c.start = round(cursor)
    cursor = clipEnd(c)
  }
}

/** Overwrite edit: trims / removes whatever lies under `clip` on its track. */
export function resolveOverlapsByOverwrite(p: Project, clip: Clip): void {
  const s = clip.start
  const e = clipEnd(clip)
  for (const c of clipsOnTrack(p, clip.trackId)) {
    if (c.id === clip.id || clipEnd(c) <= s + EPS || c.start >= e - EPS) continue
    if (c.start >= s - EPS && clipEnd(c) <= e + EPS) {
      p.clips = p.clips.filter((x) => x.id !== c.id)
    } else if (c.start < s && clipEnd(c) > e) {
      const tail = splitClip(p, c.id, e)
      c.duration = round(s - c.start)
      void tail
    } else if (c.start < s) {
      c.duration = round(s - c.start)
    } else {
      const cut = e - c.start
      c.start = round(e)
      c.in = round(c.in + cut)
      c.duration = round(c.duration - cut)
    }
  }
}

/** Splits a clip at timeline time `t`; returns the new right-hand clip. */
export function splitClip(p: Project, clipId: string, t: number): Clip | undefined {
  const c = p.clips.find((x) => x.id === clipId)
  if (!c || t <= c.start + EPS || t >= clipEnd(c) - EPS) return undefined
  const leftDur = t - c.start
  const right: Clip = {
    ...structuredClone(c),
    id: uid('clp_'),
    start: round(t),
    in: round(c.in + (c.mediaId ? leftDur : 0)),
    duration: round(c.duration - leftDur),
    fadeIn: 0
  }
  c.duration = round(leftDur)
  c.fadeOut = 0
  p.clips.push(right)
  return right
}

/**
 * Ripple-deletes [start, end) across all unlocked tracks: content inside is removed,
 * straddling clips are trimmed and everything after shifts left.
 */
export function removeRange(p: Project, start: number, end: number): void {
  if (end - start <= EPS) return
  const len = end - start
  const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id))
  for (const c of [...p.clips]) {
    if (locked.has(c.trackId)) continue
    if (c.start < start - EPS && clipEnd(c) > start + EPS) splitClip(p, c.id, start)
  }
  for (const c of [...p.clips]) {
    if (locked.has(c.trackId)) continue
    if (c.start < end - EPS && clipEnd(c) > end + EPS) splitClip(p, c.id, end)
  }
  p.clips = p.clips.filter((c) => locked.has(c.trackId) || !(c.start >= start - EPS && clipEnd(c) <= end + EPS))
  for (const c of p.clips) {
    if (!locked.has(c.trackId) && c.start >= end - EPS) c.start = round(c.start - len)
  }
  p.markers = p.markers.filter((m) => m.time < start || m.time >= end).map((m) => (m.time >= end ? { ...m, time: m.time - len } : m))
  if (p.transcript) {
    p.transcript = {
      ...p.transcript,
      words: p.transcript.words
        .filter((w) => w.end <= start + EPS || w.start >= end - EPS)
        .map((w) => (w.start >= end - EPS ? { ...w, start: round(w.start - len), end: round(w.end - len) } : w))
    }
  }
}

/** Removes several ranges (any order, may overlap) with ripple. */
export function removeRanges(p: Project, ranges: { start: number; end: number }[]): number {
  const merged = mergeRanges(ranges)
  for (const r of [...merged].reverse()) removeRange(p, r.start, r.end)
  return merged.reduce((s, r) => s + (r.end - r.start), 0)
}

export function mergeRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start)
  const out: { start: number; end: number }[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/** Edges a dragged time can snap to. */
export function snapPoints(p: Project, excludeIds: Set<string>, playhead: number): number[] {
  const pts = [0, playhead]
  for (const c of p.clips) {
    if (excludeIds.has(c.id)) continue
    pts.push(c.start, clipEnd(c))
  }
  for (const m of p.markers) pts.push(m.time)
  return pts
}

export function snap(t: number, points: number[], threshold: number): number {
  let best = t
  let bestD = threshold
  for (const pt of points) {
    const d = Math.abs(pt - t)
    if (d < bestD) {
      bestD = d
      best = pt
    }
  }
  return best
}

export function formatTimecode(t: number, fps = 30): string {
  const total = Math.max(0, t)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const f = Math.floor((total - Math.floor(total)) * fps + EPS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`
}
