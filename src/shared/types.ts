export type MediaKind = 'video' | 'audio' | 'image'

export interface MediaItem {
  id: string
  name: string
  path: string
  kind: MediaKind
  duration: number
  width?: number
  height?: number
  fps?: number
  hasAudio: boolean
  hasVideo: boolean
  thumbnail?: string
}

export type TrackKind = 'video' | 'audio' | 'text' | 'caption'

export interface Track {
  id: string
  kind: TrackKind
  name: string
  muted: boolean
  solo: boolean
  locked: boolean
  hidden: boolean
  /** Linear gain, 1 = 0 dB. */
  gain: number
}

export interface Transform {
  /** Offset from canvas centre in project pixels. */
  x: number
  y: number
  scale: number
  opacity: number
}

export interface TextStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  strokeColor: string
  strokeWidth: number
  background: string | null
  /** Horizontal / vertical anchor of the text block, 0..1 of the frame. */
  x: number
  y: number
  align: 'left' | 'center' | 'right'
  shadow: boolean
  uppercase: boolean
  /** Max line width as a fraction of frame width. */
  maxWidth: number
}

export type TextAnimation = 'none' | 'fade' | 'slide-up' | 'pop' | 'typewriter'

export interface Clip {
  id: string
  trackId: string
  /** Timeline position in seconds. */
  start: number
  duration: number
  mediaId?: string
  /** Source offset in seconds. */
  in: number
  volume: number
  fadeIn: number
  fadeOut: number
  transform: Transform
  text?: string
  textStyle?: TextStyle
  animIn?: TextAnimation
  animOut?: TextAnimation
  name?: string
}

export interface Marker {
  id: string
  time: number
  label: string
  color: string
}

export type SuggestionReason = 'silence' | 'filler' | 'scene' | 'agent'

export interface CutSuggestion {
  id: string
  /** remove = ripple delete [start,end]; split = razor at start. */
  kind: 'remove' | 'split'
  start: number
  end: number
  reason: SuggestionReason
  label: string
}

export interface Word {
  start: number
  end: number
  text: string
}

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  sampleRate: number
  background: string
}

export interface Project {
  version: 1
  id: string
  name: string
  settings: ProjectSettings
  media: MediaItem[]
  tracks: Track[]
  clips: Clip[]
  markers: Marker[]
  suggestions: CutSuggestion[]
  transcript?: { words: Word[]; createdAt: number }
  masterGain: number
  magnetic: boolean
}

export interface StyleProfile {
  source: string
  width: number
  height: number
  fps: number
  duration: number
  shotCount: number
  averageShot: number
  medianShot: number
  /** Shot durations in seconds, in order. */
  shots: number[]
  speechRatio: number
  hasAudio: boolean
  captions: boolean
  notes?: string
}

export interface TemplateSlot {
  trackIndex: number
  start: number
  duration: number
}

export interface Template {
  id: string
  name: string
  description: string
  builtin?: boolean
  settings: ProjectSettings
  tracks: Omit<Track, 'id'>[]
  /** Non-media clips (titles, text) by track index. */
  textClips: (Omit<Clip, 'id' | 'trackId'> & { trackIndex: number })[]
  /** Media placeholders filled in order with selected media. */
  slots: TemplateSlot[]
  captionStyle?: TextStyle
  autoCaptions?: boolean
  style?: StyleProfile
  createdAt: number
}

export interface ExportOptions {
  outputPath: string
  container: 'mp4' | 'mov' | 'webm' | 'mp3' | 'wav'
  width: number
  height: number
  fps: number
  videoCodec: 'libx264' | 'libx265' | 'prores_ks' | 'libvpx-vp9' | 'none'
  crf: number
  preset: string
  audioCodec: 'aac' | 'libopus' | 'libmp3lame' | 'pcm_s16le' | 'pcm_s24le'
  audioBitrate: string
  burnCaptions: boolean
  range?: { start: number; end: number }
}
