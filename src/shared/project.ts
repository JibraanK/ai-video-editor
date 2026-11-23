import { uid } from './id'
import { BASE_TEXT_STYLE, DEFAULT_SETTINGS } from './presets'
import type { Clip, Project, ProjectSettings, Track, TrackKind } from './types'

export function makeTrack(kind: TrackKind, name: string): Track {
  return { id: uid('trk_'), kind, name, muted: false, solo: false, locked: false, hidden: false, gain: 1 }
}

export function createProject(name = 'Untitled Project', settings: Partial<ProjectSettings> = {}): Project {
  return {
    version: 1,
    id: uid('prj_'),
    name,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    media: [],
    tracks: [makeTrack('caption', 'Captions'), makeTrack('text', 'Text 1'), makeTrack('video', 'Video 1'), makeTrack('audio', 'Audio 1'), makeTrack('audio', 'Audio 2')],
    clips: [],
    markers: [],
    suggestions: [],
    masterGain: 1,
    magnetic: true
  }
}

export function makeClip(partial: Partial<Clip> & Pick<Clip, 'trackId' | 'start' | 'duration'>): Clip {
  return {
    id: uid('clp_'),
    in: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: { x: 0, y: 0, scale: 1, opacity: 1 },
    ...partial
  }
}

export function makeTextClip(trackId: string, text: string, start: number, duration: number, style = BASE_TEXT_STYLE): Clip {
  return makeClip({ trackId, start, duration, text, textStyle: { ...style }, animIn: 'fade', animOut: 'fade' })
}

/** Fills defaults for projects saved by older versions or written by agents. */
export function normalizeProject(p: Project): Project {
  return {
    ...createProject(p.name),
    ...p,
    settings: { ...DEFAULT_SETTINGS, ...p.settings },
    markers: p.markers ?? [],
    suggestions: p.suggestions ?? [],
    clips: (p.clips ?? []).map((c) => makeClip({ ...c, id: c.id }))
  }
}
