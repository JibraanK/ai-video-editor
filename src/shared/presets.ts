import type { ExportOptions, ProjectSettings, TextAnimation, TextStyle } from './types'

export const DEFAULT_SETTINGS: ProjectSettings = { width: 1920, height: 1080, fps: 30, sampleRate: 48000, background: '#000000' }

export const BASE_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter, Helvetica, Arial, sans-serif',
  fontSize: 72,
  fontWeight: 700,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0,
  background: null,
  x: 0.5,
  y: 0.5,
  align: 'center',
  shadow: true,
  uppercase: false,
  maxWidth: 0.85
}

export const CAPTION_STYLE: TextStyle = {
  ...BASE_TEXT_STYLE,
  fontSize: 54,
  fontWeight: 800,
  strokeColor: '#000000',
  strokeWidth: 6,
  y: 0.85,
  shadow: false
}

export interface TextPreset {
  id: string
  name: string
  text: string
  duration: number
  style: Partial<TextStyle>
  animIn: TextAnimation
  animOut: TextAnimation
}

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'title', name: 'Title', text: 'Your Title', duration: 4, style: { fontSize: 120, fontWeight: 800 }, animIn: 'fade', animOut: 'fade' },
  { id: 'subtitle', name: 'Subtitle', text: 'Subtitle text', duration: 4, style: { fontSize: 56, fontWeight: 500, y: 0.62 }, animIn: 'fade', animOut: 'fade' },
  { id: 'lower-third', name: 'Lower Third', text: 'Name Surname', duration: 5, style: { fontSize: 52, align: 'left', x: 0.06, y: 0.82, background: 'rgba(17,17,17,0.85)', shadow: false }, animIn: 'slide-up', animOut: 'fade' },
  { id: 'big-bold', name: 'Big Bold', text: 'WAIT FOR IT', duration: 2.5, style: { fontSize: 140, fontWeight: 900, uppercase: true, strokeWidth: 10, color: '#ffe14d', shadow: false }, animIn: 'pop', animOut: 'none' },
  { id: 'typewriter', name: 'Typewriter', text: 'Once upon a time…', duration: 4, style: { fontFamily: '"Courier New", monospace', fontSize: 64, fontWeight: 600 }, animIn: 'typewriter', animOut: 'fade' },
  { id: 'neon', name: 'Neon', text: 'NEON', duration: 3, style: { fontSize: 130, color: '#7cf7ff', strokeColor: '#00a2ff', strokeWidth: 3, shadow: true }, animIn: 'fade', animOut: 'fade' },
  { id: 'caption-pop', name: 'Caption Pop', text: 'caption', duration: 2, style: { ...CAPTION_STYLE, color: '#ffffff' }, animIn: 'pop', animOut: 'none' }
]

export interface ExportPreset {
  id: string
  name: string
  options: Omit<ExportOptions, 'outputPath' | 'burnCaptions' | 'range'>
}

const h264 = { container: 'mp4', videoCodec: 'libx264', crf: 20, preset: 'medium', audioCodec: 'aac', audioBitrate: '192k' } as const

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'yt-1080', name: 'YouTube 1080p (H.264)', options: { ...h264, width: 1920, height: 1080, fps: 30 } },
  { id: 'yt-4k', name: 'YouTube 4K (H.264)', options: { ...h264, width: 3840, height: 2160, fps: 30, crf: 18, preset: 'slow' } },
  { id: 'web-720', name: 'Web 720p (small)', options: { ...h264, width: 1280, height: 720, fps: 30, crf: 24, preset: 'fast', audioBitrate: '128k' } },
  { id: 'vertical', name: 'Shorts / Reels / TikTok 1080×1920', options: { ...h264, width: 1080, height: 1920, fps: 30 } },
  { id: 'square', name: 'Square 1080×1080', options: { ...h264, width: 1080, height: 1080, fps: 30 } },
  { id: 'hevc', name: 'HEVC 1080p (H.265)', options: { ...h264, videoCodec: 'libx265', crf: 24, width: 1920, height: 1080, fps: 30 } },
  { id: 'prores', name: 'ProRes 422 HQ (MOV)', options: { container: 'mov', videoCodec: 'prores_ks', crf: 0, preset: '3', audioCodec: 'pcm_s24le', audioBitrate: '0', width: 1920, height: 1080, fps: 30 } },
  { id: 'webm', name: 'WebM VP9', options: { container: 'webm', videoCodec: 'libvpx-vp9', crf: 32, preset: 'good', audioCodec: 'libopus', audioBitrate: '160k', width: 1920, height: 1080, fps: 30 } },
  { id: 'mp3', name: 'Audio only (MP3)', options: { container: 'mp3', videoCodec: 'none', crf: 0, preset: '', audioCodec: 'libmp3lame', audioBitrate: '256k', width: 0, height: 0, fps: 0 } },
  { id: 'wav', name: 'Audio only (WAV)', options: { container: 'wav', videoCodec: 'none', crf: 0, preset: '', audioCodec: 'pcm_s16le', audioBitrate: '0', width: 0, height: 0, fps: 0 } }
]
