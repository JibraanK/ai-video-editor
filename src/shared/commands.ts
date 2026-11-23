/**
 * Editor command API. Every edit an agent (MCP, CLI or cloud) or the UI can make goes through
 * these commands, so they share validation, undo and behaviour.
 */
import { uid } from './id'
import { makeClip, makeTrack } from './project'
import { BASE_TEXT_STYLE, CAPTION_STYLE, TEXT_PRESETS } from './presets'
import {
  clipEnd,
  clipsAt,
  clipsOnTrack,
  packTrack,
  projectDuration,
  removeRange,
  removeRanges,
  resolveOverlapsByOverwrite,
  resolveOverlapsByPush,
  round,
  splitClip,
  trackById,
  trackEnd
} from './timeline'
import type { Clip, CutSuggestion, Project, TextAnimation, TextStyle, Track, TrackKind } from './types'

export type JSONSchema = Record<string, unknown>

export interface CommandResult {
  project: Project
  result: unknown
}

export interface EditCommand {
  name: string
  description: string
  inputSchema: JSONSchema
  /** Read-only commands don't create undo steps. */
  readOnly?: boolean
  run: (p: Project, args: any) => unknown
}

const num = (description: string): JSONSchema => ({ type: 'number', description })
const str = (description: string): JSONSchema => ({ type: 'string', description })
const bool = (description: string): JSONSchema => ({ type: 'boolean', description })
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({ type: 'object', properties, required, additionalProperties: false })

const ANIMS: TextAnimation[] = ['none', 'fade', 'slide-up', 'pop', 'typewriter']

const textStyleSchema: JSONSchema = {
  type: 'object',
  description: 'Partial text style. x/y are 0..1 anchors in the frame; fontSize in project pixels.',
  properties: {
    fontFamily: str('CSS font family'),
    fontSize: num('Font size in px'),
    fontWeight: num('100..900'),
    color: str('CSS color'),
    strokeColor: str('Outline color'),
    strokeWidth: num('Outline width px'),
    background: { type: ['string', 'null'], description: 'Box background color or null' },
    x: num('Horizontal anchor 0..1'),
    y: num('Vertical anchor 0..1'),
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    shadow: bool('Drop shadow'),
    uppercase: bool('Render uppercase'),
    maxWidth: num('Max line width as fraction of frame width')
  }
}

function getClip(p: Project, id: string): Clip {
  const c = p.clips.find((x) => x.id === id)
  if (!c) throw new Error(`Clip not found: ${id}`)
  return c
}

function getTrack(p: Project, id: string): Track {
  const t = trackById(p, id)
  if (!t) throw new Error(`Track not found: ${id}`)
  return t
}

function firstTrack(p: Project, kind: TrackKind, create = true): Track {
  let t = p.tracks.find((x) => x.kind === kind)
  if (!t && create) {
    t = makeTrack(kind, `${kind[0].toUpperCase()}${kind.slice(1)} 1`)
    insertTrack(p, t)
  }
  return t!
}

function insertTrack(p: Project, t: Track): void {
  // Visual tracks above existing visual tracks of the same kind; audio at the bottom.
  if (t.kind === 'audio') p.tracks.push(t)
  else {
    const idx = p.tracks.findIndex((x) => x.kind === t.kind)
    if (idx >= 0) p.tracks.splice(idx, 0, t)
    else if (t.kind === 'caption') p.tracks.unshift(t)
    else {
      const firstVideo = p.tracks.findIndex((x) => x.kind === 'video' || x.kind === 'audio')
      p.tracks.splice(firstVideo < 0 ? p.tracks.length : firstVideo, 0, t)
    }
  }
}

function placeClip(p: Project, clip: Clip, mode: 'insert' | 'overwrite' | 'auto' = 'auto'): void {
  const m = mode === 'auto' ? (p.magnetic ? 'insert' : 'overwrite') : mode
  if (m === 'insert') resolveOverlapsByPush(p, clip)
  else resolveOverlapsByOverwrite(p, clip)
  if (p.magnetic && isMagneticTrack(p, clip.trackId)) packTrack(p, clip.trackId)
}

/** Magnetic packing applies to the primary storyline (first video track) and audio tracks. */
export function isMagneticTrack(p: Project, trackId: string): boolean {
  const t = trackById(p, trackId)
  if (!t) return false
  const primary = p.tracks.find((x) => x.kind === 'video')
  return t.id === primary?.id
}

function summarizeClip(p: Project, c: Clip) {
  const media = c.mediaId ? p.media.find((m) => m.id === c.mediaId) : undefined
  return {
    id: c.id,
    trackId: c.trackId,
    start: round(c.start, 3),
    end: round(clipEnd(c), 3),
    duration: round(c.duration, 3),
    sourceIn: c.mediaId ? round(c.in, 3) : undefined,
    media: media ? { id: media.id, name: media.name } : undefined,
    text: c.text,
    volume: c.volume !== 1 ? c.volume : undefined
  }
}

export function projectSummary(p: Project) {
  return {
    name: p.name,
    settings: p.settings,
    duration: round(projectDuration(p), 3),
    magnetic: p.magnetic,
    media: p.media.map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: round(m.duration, 3), width: m.width, height: m.height, hasAudio: m.hasAudio })),
    tracks: p.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, muted: t.muted, solo: t.solo, locked: t.locked, hidden: t.hidden, gain: t.gain })),
    clips: [...p.clips].sort((a, b) => a.start - b.start).map((c) => summarizeClip(p, c)),
    markers: p.markers,
    suggestions: p.suggestions,
    hasTranscript: !!p.transcript?.words.length
  }
}

function addTextClip(p: Project, a: { text: string; start: number; duration: number; trackId?: string; preset?: string; style?: Partial<TextStyle>; animIn?: TextAnimation; animOut?: TextAnimation }) {
  const preset = TEXT_PRESETS.find((x) => x.id === a.preset)
  const track = a.trackId ? getTrack(p, a.trackId) : firstTrack(p, 'text')
  const clip = makeClip({
    trackId: track.id,
    start: Math.max(0, a.start),
    duration: Math.max(0.1, a.duration ?? preset?.duration ?? 3),
    text: a.text,
    textStyle: { ...BASE_TEXT_STYLE, ...(preset?.style ?? {}), ...(a.style ?? {}) },
    animIn: a.animIn ?? preset?.animIn ?? 'fade',
    animOut: a.animOut ?? preset?.animOut ?? 'fade'
  })
  p.clips.push(clip)
  resolveOverlapsByOverwrite(p, clip)
  return clip
}

export const EDIT_COMMANDS: EditCommand[] = [
  {
    name: 'get_project',
    description: 'Get the full timeline: settings, media pool, tracks, clips (timeline seconds), markers, suggestions.',
    inputSchema: obj({}),
    readOnly: true,
    run: (p) => projectSummary(p)
  },
  {
    name: 'get_transcript',
    description: 'Get word-level transcript of the timeline audio (timeline seconds). Run transcribe_timeline first if empty.',
    inputSchema: obj({ start: num('Optional range start'), end: num('Optional range end') }),
    readOnly: true,
    run: (p, a) => {
      const words = (p.transcript?.words ?? []).filter((w) => (a.start == null || w.end >= a.start) && (a.end == null || w.start <= a.end))
      return { words, text: words.map((w) => w.text).join(' ') }
    }
  },
  {
    name: 'set_project_settings',
    description: 'Change project name, resolution (e.g. 1080x1920 for vertical), frame rate or background colour.',
    inputSchema: obj({ name: str('Project name'), width: num('Width px'), height: num('Height px'), fps: num('Frames per second'), background: str('CSS color') }),
    run: (p, a) => {
      if (a.name) p.name = a.name
      for (const k of ['width', 'height', 'fps', 'background'] as const) if (a[k] != null) (p.settings as any)[k] = a[k]
      return p.settings
    }
  },
  {
    name: 'set_magnetic',
    description: 'Enable/disable magnetic timeline (ripple edits, primary video track stays gapless).',
    inputSchema: obj({ enabled: bool('Magnetic on/off') }, ['enabled']),
    run: (p, a) => {
      p.magnetic = !!a.enabled
      if (p.magnetic) {
        const primary = p.tracks.find((t) => t.kind === 'video')
        if (primary) packTrack(p, primary.id)
      }
      return { magnetic: p.magnetic }
    }
  },
  {
    name: 'add_track',
    description: 'Add a track. kind: video | audio | text | caption.',
    inputSchema: obj({ kind: { type: 'string', enum: ['video', 'audio', 'text', 'caption'] }, name: str('Track name') }, ['kind']),
    run: (p, a) => {
      const count = p.tracks.filter((t) => t.kind === a.kind).length + 1
      const t = makeTrack(a.kind, a.name ?? `${a.kind[0].toUpperCase()}${a.kind.slice(1)} ${count}`)
      insertTrack(p, t)
      return t
    }
  },
  {
    name: 'remove_track',
    description: 'Remove a track and all its clips.',
    inputSchema: obj({ trackId: str('Track id') }, ['trackId']),
    run: (p, a) => {
      getTrack(p, a.trackId)
      p.tracks = p.tracks.filter((t) => t.id !== a.trackId)
      p.clips = p.clips.filter((c) => c.trackId !== a.trackId)
      return { removed: a.trackId }
    }
  },
  {
    name: 'update_track',
    description: 'Update track mixer/visibility: muted, solo, gain (linear, 1 = 0dB, max 4), hidden, locked, name.',
    inputSchema: obj({ trackId: str('Track id'), name: str(''), muted: bool(''), solo: bool(''), hidden: bool(''), locked: bool(''), gain: num('Linear gain 0..4') }, ['trackId']),
    run: (p, a) => {
      const t = getTrack(p, a.trackId)
      for (const k of ['name', 'muted', 'solo', 'hidden', 'locked', 'gain'] as const) if (a[k] != null) (t as any)[k] = a[k]
      t.gain = Math.min(4, Math.max(0, t.gain))
      return t
    }
  },
  {
    name: 'set_master_gain',
    description: 'Set master output gain (linear, 1 = 0dB).',
    inputSchema: obj({ gain: num('Linear gain 0..4') }, ['gain']),
    run: (p, a) => {
      p.masterGain = Math.min(4, Math.max(0, a.gain))
      return { masterGain: p.masterGain }
    }
  },
  {
    name: 'add_clip',
    description:
      'Place a media item on the timeline. Defaults: first matching track, appended at the track end, full media length. sourceIn/duration select the part of the source. mode insert pushes later clips, overwrite replaces.',
    inputSchema: obj(
      {
        mediaId: str('Media id from the media pool'),
        trackId: str('Target track id'),
        start: num('Timeline start seconds'),
        sourceIn: num('Source in-point seconds'),
        duration: num('Duration seconds'),
        mode: { type: 'string', enum: ['insert', 'overwrite', 'auto'] }
      },
      ['mediaId']
    ),
    run: (p, a) => {
      const media = p.media.find((m) => m.id === a.mediaId)
      if (!media) throw new Error(`Media not found: ${a.mediaId}`)
      const kind: TrackKind = media.kind === 'audio' ? 'audio' : 'video'
      const track = a.trackId ? getTrack(p, a.trackId) : firstTrack(p, kind)
      if ((track.kind === 'audio') !== (kind === 'audio')) throw new Error(`Cannot put ${media.kind} on a ${track.kind} track`)
      const sourceIn = Math.max(0, a.sourceIn ?? 0)
      const maxDur = media.kind === 'image' ? Infinity : media.duration - sourceIn
      const duration = Math.max(0.05, Math.min(a.duration ?? (media.kind === 'image' ? 5 : maxDur), maxDur))
      const clip = makeClip({ trackId: track.id, mediaId: media.id, in: sourceIn, start: Math.max(0, a.start ?? trackEnd(p, track.id)), duration: round(duration), name: media.name })
      p.clips.push(clip)
      placeClip(p, clip, a.mode)
      return summarizeClip(p, clip)
    }
  },
  {
    name: 'assemble_sequence',
    description: 'Append several media segments in order to a track (fast rough cut). Each item: mediaId, sourceIn, duration.',
    inputSchema: obj(
      {
        items: { type: 'array', items: obj({ mediaId: str(''), sourceIn: num(''), duration: num('') }, ['mediaId']) },
        trackId: str('Target track id (default: first video track)'),
        start: num('Timeline start (default: end of track)'),
        replace: bool('Clear the track first')
      },
      ['items']
    ),
    run: (p, a) => {
      const track = a.trackId ? getTrack(p, a.trackId) : firstTrack(p, 'video')
      if (a.replace) p.clips = p.clips.filter((c) => c.trackId !== track.id)
      let t = a.start ?? trackEnd(p, track.id)
      const added: unknown[] = []
      for (const it of a.items as { mediaId: string; sourceIn?: number; duration?: number }[]) {
        const media = p.media.find((m) => m.id === it.mediaId)
        if (!media) throw new Error(`Media not found: ${it.mediaId}`)
        const sourceIn = Math.max(0, it.sourceIn ?? 0)
        const maxDur = media.kind === 'image' ? Infinity : media.duration - sourceIn
        const duration = round(Math.max(0.05, Math.min(it.duration ?? (media.kind === 'image' ? 3 : maxDur), maxDur)))
        const clip = makeClip({ trackId: track.id, mediaId: media.id, in: sourceIn, start: round(t), duration, name: media.name })
        p.clips.push(clip)
        resolveOverlapsByOverwrite(p, clip)
        t += duration
        added.push(summarizeClip(p, clip))
      }
      return { added }
    }
  },
  {
    name: 'move_clip',
    description: 'Move a clip to a new timeline start and optionally another track of a compatible kind.',
    inputSchema: obj({ clipId: str(''), start: num('New start seconds'), trackId: str('Optional new track id') }, ['clipId', 'start']),
    run: (p, a) => {
      const c = getClip(p, a.clipId)
      const from = c.trackId
      if (a.trackId) {
        const t = getTrack(p, a.trackId)
        const cur = getTrack(p, c.trackId)
        const visualMedia = (k: TrackKind) => k === 'video'
        const textual = (k: TrackKind) => k === 'text' || k === 'caption'
        const ok = t.kind === cur.kind || (textual(t.kind) && textual(cur.kind)) || (visualMedia(t.kind) && visualMedia(cur.kind))
        if (!ok) throw new Error(`Cannot move a ${cur.kind} clip to a ${t.kind} track`)
        c.trackId = t.id
      }
      c.start = round(Math.max(0, a.start))
      placeClip(p, c)
      if (from !== c.trackId && p.magnetic && isMagneticTrack(p, from)) packTrack(p, from)
      return summarizeClip(p, c)
    }
  },
  {
    name: 'trim_clip',
    description: 'Trim a clip. Set any of: start (moves left edge, keeps right edge), end (moves right edge), sourceIn (slip).',
    inputSchema: obj({ clipId: str(''), start: num('New left edge on timeline'), end: num('New right edge on timeline'), sourceIn: num('New source in-point (slip)') }, ['clipId']),
    run: (p, a) => {
      const c = getClip(p, a.clipId)
      const media = c.mediaId ? p.media.find((m) => m.id === c.mediaId) : undefined
      const srcLen = media && media.kind !== 'image' ? media.duration : Infinity
      if (a.sourceIn != null) c.in = round(Math.min(Math.max(0, a.sourceIn), srcLen - c.duration))
      if (a.start != null) {
        let delta = a.start - c.start
        if (c.mediaId) delta = Math.max(delta, -c.in)
        delta = Math.min(delta, c.duration - 0.05)
        c.start = round(c.start + delta)
        if (c.mediaId) c.in = round(c.in + delta)
        c.duration = round(c.duration - delta)
      }
      if (a.end != null) {
        const maxEnd = c.start + (srcLen - c.in)
        c.duration = round(Math.max(0.05, Math.min(a.end, maxEnd) - c.start))
      }
      if (p.magnetic && isMagneticTrack(p, c.trackId)) packTrack(p, c.trackId)
      else resolveOverlapsByOverwrite(p, c)
      return summarizeClip(p, c)
    }
  },
  {
    name: 'split',
    description: 'Razor cut at a timeline time. If clipIds is omitted, splits every clip under the time on unlocked tracks.',
    inputSchema: obj({ time: num('Timeline seconds'), clipIds: { type: 'array', items: { type: 'string' } } }, ['time']),
    run: (p, a) => {
      const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id))
      const targets = (a.clipIds as string[] | undefined) ?? clipsAt(p, a.time).filter((c) => !locked.has(c.trackId)).map((c) => c.id)
      const created = targets.map((id) => splitClip(p, id, a.time)?.id).filter(Boolean)
      return { created }
    }
  },
  {
    name: 'delete_clips',
    description: 'Delete clips. ripple=true closes the gap on the same track (default follows magnetic mode).',
    inputSchema: obj({ clipIds: { type: 'array', items: { type: 'string' } }, ripple: bool('Close gaps') }, ['clipIds']),
    run: (p, a) => {
      const ids = new Set<string>(a.clipIds)
      const ripple = a.ripple ?? p.magnetic
      const removed = p.clips.filter((c) => ids.has(c.id))
      p.clips = p.clips.filter((c) => !ids.has(c.id))
      if (ripple) {
        for (const c of [...removed].sort((x, y) => y.start - x.start)) {
          for (const o of clipsOnTrack(p, c.trackId)) if (o.start >= c.start) o.start = round(o.start - c.duration)
        }
      }
      return { removed: removed.length }
    }
  },
  {
    name: 'update_clip',
    description: 'Update clip properties: volume (linear), fadeIn/fadeOut seconds, transform {x,y,scale,opacity}, text, textStyle, animIn/animOut.',
    inputSchema: obj(
      {
        clipId: str(''),
        volume: num('Linear volume, 1 = unchanged'),
        fadeIn: num('Seconds'),
        fadeOut: num('Seconds'),
        transform: obj({ x: num('px offset from centre'), y: num('px offset from centre'), scale: num('1 = fit'), opacity: num('0..1') }),
        text: str('Text content (text/caption clips)'),
        textStyle: textStyleSchema,
        animIn: { type: 'string', enum: ANIMS },
        animOut: { type: 'string', enum: ANIMS },
        name: str('Clip label')
      },
      ['clipId']
    ),
    run: (p, a) => {
      const c = getClip(p, a.clipId)
      for (const k of ['volume', 'fadeIn', 'fadeOut', 'text', 'animIn', 'animOut', 'name'] as const) if (a[k] != null) (c as any)[k] = a[k]
      if (a.transform) c.transform = { ...c.transform, ...a.transform }
      if (a.textStyle) c.textStyle = { ...(c.textStyle ?? BASE_TEXT_STYLE), ...a.textStyle }
      return summarizeClip(p, c)
    }
  },
  {
    name: 'add_text',
    description: `Add a text overlay. preset: ${TEXT_PRESETS.map((t) => t.id).join(', ')}.`,
    inputSchema: obj(
      {
        text: str('Text'),
        start: num('Timeline start'),
        duration: num('Seconds'),
        preset: { type: 'string', enum: TEXT_PRESETS.map((t) => t.id) },
        trackId: str('Text track id'),
        style: textStyleSchema,
        animIn: { type: 'string', enum: ANIMS },
        animOut: { type: 'string', enum: ANIMS }
      },
      ['text', 'start']
    ),
    run: (p, a) => summarizeClip(p, addTextClip(p, a))
  },
  {
    name: 'add_captions',
    description: 'Write caption segments onto the caption track (timeline seconds). replace=true clears existing captions first.',
    inputSchema: obj(
      {
        segments: { type: 'array', items: obj({ start: num(''), end: num(''), text: str('') }, ['start', 'end', 'text']) },
        replace: bool('Clear existing captions'),
        style: textStyleSchema,
        animIn: { type: 'string', enum: ANIMS }
      },
      ['segments']
    ),
    run: (p, a) => {
      const track = firstTrack(p, 'caption')
      const existing = clipsOnTrack(p, track.id)
      const baseStyle = existing[0]?.textStyle ?? CAPTION_STYLE
      if (a.replace) p.clips = p.clips.filter((c) => c.trackId !== track.id)
      const style = { ...baseStyle, ...(a.style ?? {}) }
      for (const s of a.segments as { start: number; end: number; text: string }[]) {
        if (s.end - s.start < 0.05) continue
        p.clips.push(makeClip({ trackId: track.id, start: round(s.start), duration: round(s.end - s.start), text: s.text, textStyle: { ...style }, animIn: a.animIn ?? 'none', animOut: 'none' }))
      }
      return { count: a.segments.length, trackId: track.id }
    }
  },
  {
    name: 'style_captions',
    description: 'Restyle every caption clip at once.',
    inputSchema: obj({ style: textStyleSchema, animIn: { type: 'string', enum: ANIMS } }, ['style']),
    run: (p, a) => {
      const ids = new Set(p.tracks.filter((t) => t.kind === 'caption').map((t) => t.id))
      let n = 0
      for (const c of p.clips)
        if (ids.has(c.trackId)) {
          c.textStyle = { ...(c.textStyle ?? CAPTION_STYLE), ...a.style }
          if (a.animIn) c.animIn = a.animIn
          n++
        }
      return { updated: n }
    }
  },
  {
    name: 'remove_ranges',
    description: 'Ripple-delete time ranges from the whole timeline (all unlocked tracks), e.g. silences or bad takes.',
    inputSchema: obj({ ranges: { type: 'array', items: obj({ start: num(''), end: num('') }, ['start', 'end']) } }, ['ranges']),
    run: (p, a) => ({ removedSeconds: round(removeRanges(p, a.ranges), 3), newDuration: round(projectDuration(p), 3) })
  },
  {
    name: 'add_marker',
    description: 'Add a timeline marker.',
    inputSchema: obj({ time: num(''), label: str(''), color: str('CSS color') }, ['time']),
    run: (p, a) => {
      const m = { id: uid('mrk_'), time: a.time, label: a.label ?? '', color: a.color ?? '#f5a524' }
      p.markers.push(m)
      return m
    }
  },
  {
    name: 'suggest_cuts',
    description: 'Show cut suggestions on the timeline for the user to review. kind remove = ripple delete [start,end]; split = razor at start.',
    inputSchema: obj(
      {
        suggestions: {
          type: 'array',
          items: obj({ kind: { type: 'string', enum: ['remove', 'split'] }, start: num(''), end: num(''), label: str('Why') }, ['kind', 'start'])
        },
        replace: bool('Replace existing suggestions')
      },
      ['suggestions']
    ),
    run: (p, a) => {
      const add: CutSuggestion[] = a.suggestions.map((s: any) => ({ id: uid('sug_'), kind: s.kind, start: s.start, end: s.end ?? s.start, reason: s.reason ?? 'agent', label: s.label ?? 'Suggested by agent' }))
      p.suggestions = a.replace ? add : [...p.suggestions, ...add]
      return { count: p.suggestions.length }
    }
  },
  {
    name: 'apply_suggestions',
    description: 'Apply cut suggestions (all, or by id). Splits first, then ripple-removes ranges.',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' } } }),
    run: (p, a) => applySuggestions(p, a.ids)
  },
  {
    name: 'clear_suggestions',
    description: 'Dismiss cut suggestions (all, or by id).',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' } } }),
    run: (p, a) => {
      const ids = a.ids ? new Set<string>(a.ids) : null
      p.suggestions = ids ? p.suggestions.filter((s) => !ids.has(s.id)) : []
      return { remaining: p.suggestions.length }
    }
  }
]

export function applySuggestions(p: Project, ids?: string[]) {
  const set = ids ? new Set(ids) : null
  const chosen = p.suggestions.filter((s) => !set || set.has(s.id))
  for (const s of chosen.filter((s) => s.kind === 'split')) {
    const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id))
    for (const c of clipsAt(p, s.start)) if (!locked.has(c.trackId)) splitClip(p, c.id, s.start)
  }
  const removed = removeRanges(p, chosen.filter((s) => s.kind === 'remove').map((s) => ({ start: s.start, end: s.end })))
  const done = new Set(chosen.map((s) => s.id))
  p.suggestions = p.suggestions.filter((s) => !done.has(s.id))
  return { applied: chosen.length, removedSeconds: round(removed, 3) }
}

export const COMMANDS_BY_NAME = new Map(EDIT_COMMANDS.map((c) => [c.name, c]))

/** Applies a command immutably; returns the new project and the command's result. */
export function applyCommand(project: Project, name: string, args: unknown = {}): CommandResult {
  const cmd = COMMANDS_BY_NAME.get(name)
  if (!cmd) throw new Error(`Unknown command: ${name}`)
  const draft = structuredClone(project)
  const result = cmd.run(draft, args ?? {})
  return { project: cmd.readOnly ? project : draft, result }
}

export { removeRange }
