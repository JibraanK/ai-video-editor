import { uid } from './id'
import { createProject, makeClip, makeTrack } from './project'
import { BASE_TEXT_STYLE, CAPTION_STYLE, DEFAULT_SETTINGS } from './presets'
import { clipsOnTrack, round } from './timeline'
import type { MediaItem, Project, StyleProfile, Template } from './types'

const t = (kind: Template['tracks'][number]['kind'], name: string): Template['tracks'][number] => ({ kind, name, muted: false, solo: false, locked: false, hidden: false, gain: 1 })

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: 'builtin-youtube',
    name: 'YouTube (16:9)',
    description: '1080p landscape, title card, captions track.',
    builtin: true,
    settings: { ...DEFAULT_SETTINGS },
    tracks: [t('caption', 'Captions'), t('text', 'Titles'), t('video', 'Video 1'), t('audio', 'Voice'), t('audio', 'Music')],
    textClips: [{ trackIndex: 1, start: 0, duration: 3, in: 0, volume: 1, fadeIn: 0, fadeOut: 0, transform: { x: 0, y: 0, scale: 1, opacity: 1 }, text: 'Video Title', textStyle: { ...BASE_TEXT_STYLE, fontSize: 120, fontWeight: 800 }, animIn: 'fade', animOut: 'fade' }],
    slots: [],
    captionStyle: CAPTION_STYLE,
    createdAt: 0
  },
  {
    id: 'builtin-shorts',
    name: 'Shorts / Reels / TikTok (9:16)',
    description: '1080×1920 vertical, fast 2s cuts, bold auto-captions, hook text.',
    builtin: true,
    settings: { ...DEFAULT_SETTINGS, width: 1080, height: 1920 },
    tracks: [t('caption', 'Captions'), t('text', 'Hook'), t('video', 'Video 1'), t('audio', 'Voice'), t('audio', 'Music')],
    textClips: [
      { trackIndex: 1, start: 0, duration: 2.5, in: 0, volume: 1, fadeIn: 0, fadeOut: 0, transform: { x: 0, y: 0, scale: 1, opacity: 1 }, text: 'WAIT FOR IT…', textStyle: { ...BASE_TEXT_STYLE, fontSize: 110, fontWeight: 900, uppercase: true, strokeWidth: 10, color: '#ffe14d', y: 0.22, shadow: false }, animIn: 'pop', animOut: 'none' }
    ],
    slots: Array.from({ length: 8 }, (_, i) => ({ trackIndex: 2, start: i * 2, duration: 2 })),
    captionStyle: { ...CAPTION_STYLE, fontSize: 76, fontWeight: 900, uppercase: true, strokeWidth: 10, y: 0.68 },
    autoCaptions: true,
    createdAt: 0
  },
  {
    id: 'builtin-podcast',
    name: 'Podcast clip (1:1)',
    description: '1080×1080 square, speaker lower third, captions.',
    builtin: true,
    settings: { ...DEFAULT_SETTINGS, width: 1080, height: 1080 },
    tracks: [t('caption', 'Captions'), t('text', 'Lower third'), t('video', 'Camera'), t('audio', 'Voice')],
    textClips: [
      { trackIndex: 1, start: 0.5, duration: 5, in: 0, volume: 1, fadeIn: 0, fadeOut: 0, transform: { x: 0, y: 0, scale: 1, opacity: 1 }, text: 'Guest Name', textStyle: { ...BASE_TEXT_STYLE, fontSize: 48, align: 'left', x: 0.06, y: 0.12, background: 'rgba(17,17,17,0.85)', shadow: false }, animIn: 'slide-up', animOut: 'fade' }
    ],
    slots: [],
    captionStyle: { ...CAPTION_STYLE, y: 0.8 },
    autoCaptions: true,
    createdAt: 0
  }
]

/** Saves the current timeline structure as a reusable template; media clips become fillable slots. */
export function templateFromProject(p: Project, name: string, description = ''): Template {
  const captionTrack = p.tracks.find((x) => x.kind === 'caption')
  const captionStyle = captionTrack ? clipsOnTrack(p, captionTrack.id)[0]?.textStyle : undefined
  return {
    id: uid('tpl_'),
    name,
    description,
    settings: { ...p.settings },
    tracks: p.tracks.map(({ id: _id, ...rest }) => ({ ...rest })),
    textClips: p.clips
      .filter((c) => !c.mediaId && p.tracks.find((x) => x.id === c.trackId)?.kind === 'text')
      .map(({ id: _id, trackId, ...rest }) => ({ ...structuredClone(rest), trackIndex: p.tracks.findIndex((x) => x.id === trackId) })),
    slots: p.clips
      .filter((c) => c.mediaId && p.tracks.find((x) => x.id === c.trackId)?.kind === 'video')
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ trackIndex: p.tracks.findIndex((x) => x.id === c.trackId), start: c.start, duration: c.duration })),
    captionStyle,
    autoCaptions: !!captionStyle,
    createdAt: Date.now()
  }
}

/** Picks evenly spread source segments of the requested durations, cycling through media. */
export function spreadSegments(media: MediaItem[], durations: number[]): { mediaId: string; sourceIn: number; duration: number }[] {
  const usable = media.filter((m) => m.kind !== 'audio')
  if (!usable.length) return []
  const counts = new Map<string, number>()
  durations.forEach((_, i) => {
    const m = usable[i % usable.length]
    counts.set(m.id, (counts.get(m.id) ?? 0) + 1)
  })
  const used = new Map<string, number>()
  return durations.map((d, i) => {
    const m = usable[i % usable.length]
    const k = counts.get(m.id)!
    const j = used.get(m.id) ?? 0
    used.set(m.id, j + 1)
    if (m.kind === 'image') return { mediaId: m.id, sourceIn: 0, duration: round(d) }
    const dur = Math.min(d, m.duration)
    const centre = ((j + 0.5) / k) * m.duration
    const sourceIn = Math.min(Math.max(0, centre - dur / 2), Math.max(0, m.duration - dur))
    return { mediaId: m.id, sourceIn: round(sourceIn), duration: round(dur) }
  })
}

/** Creates a project from a template, keeping the given project's media pool. */
export function applyTemplate(base: Project, tpl: Template, mediaIds: string[] = []): Project {
  const p = createProject(base.name, tpl.settings)
  p.id = base.id
  p.media = base.media
  p.tracks = tpl.tracks.map((x) => ({ ...makeTrack(x.kind, x.name), ...x, id: uid('trk_') }))
  for (const tc of tpl.textClips) {
    const track = p.tracks[tc.trackIndex]
    if (!track) continue
    const { trackIndex: _i, ...rest } = tc
    p.clips.push(makeClip({ ...structuredClone(rest), trackId: track.id }))
  }
  const media = mediaIds.map((id) => p.media.find((m) => m.id === id)).filter((m): m is MediaItem => !!m)
  if (tpl.slots.length && media.length) {
    const segs = spreadSegments(media, tpl.slots.map((s) => s.duration))
    tpl.slots.forEach((slot, i) => {
      const track = p.tracks[slot.trackIndex] ?? p.tracks.find((x) => x.kind === 'video')
      const seg = segs[i]
      if (!track || !seg) return
      p.clips.push(makeClip({ trackId: track.id, mediaId: seg.mediaId, in: seg.sourceIn, start: slot.start, duration: seg.duration, name: p.media.find((m) => m.id === seg.mediaId)?.name }))
    })
  } else if (media.length) {
    const track = p.tracks.find((x) => x.kind === 'video')!
    let start = 0
    for (const m of media.filter((x) => x.kind !== 'audio')) {
      const duration = m.kind === 'image' ? 5 : m.duration
      p.clips.push(makeClip({ trackId: track.id, mediaId: m.id, start, duration, name: m.name }))
      start += duration
    }
  }
  return p
}

/** Builds a rough cut whose pacing and format mimic a reference video's style profile. */
export function planFromStyle(profile: StyleProfile, media: MediaItem[], targetDuration?: number): { mediaId: string; sourceIn: number; duration: number }[] {
  const usable = media.filter((m) => m.kind !== 'audio')
  if (!usable.length) return []
  const available = usable.reduce((s, m) => s + (m.kind === 'image' ? 5 : m.duration), 0)
  const target = Math.min(targetDuration ?? profile.duration, available)
  const pattern = profile.shots.length ? profile.shots : [profile.averageShot || 3]
  const durations: number[] = []
  let total = 0
  for (let i = 0; total < target - 0.05 && i < 2000; i++) {
    const d = Math.max(0.3, Math.min(pattern[i % pattern.length], target - total))
    durations.push(d)
    total += d
  }
  return spreadSegments(usable, durations)
}
