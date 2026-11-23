import type { CutSuggestion, TextStyle, Word } from './types'
import { uid } from './id'

export interface CaptionSegment {
  start: number
  end: number
  text: string
}

export interface ChunkOptions {
  maxChars: number
  maxDuration: number
  maxGap: number
}

/** Groups word timings into caption-sized lines. */
export function wordsToCaptions(words: Word[], opts: Partial<ChunkOptions> = {}): CaptionSegment[] {
  const { maxChars = 32, maxDuration = 3, maxGap = 0.6 } = opts
  const out: CaptionSegment[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text.trim()).join(' ').replace(/\s+([,.!?;:])/g, '$1') })
    cur = []
  }
  for (const w of words) {
    if (!w.text.trim()) continue
    if (cur.length) {
      const text = cur.map((x) => x.text.trim()).join(' ')
      const prev = cur[cur.length - 1]
      const tooLong = text.length + 1 + w.text.trim().length > maxChars
      const tooSlow = w.end - cur[0].start > maxDuration
      const gap = w.start - prev.end > maxGap
      const sentenceEnd = /[.!?]$/.test(prev.text.trim())
      if (tooLong || tooSlow || gap || sentenceEnd) flush()
    }
    cur.push(w)
  }
  flush()
  // Close tiny gaps between consecutive captions so they don't flicker.
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i + 1].start - out[i].end < 0.25) out[i].end = out[i + 1].start
  }
  return out
}

const FILLERS = new Set(['um', 'uh', 'umm', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm'])

export function fillerSuggestions(words: Word[]): CutSuggestion[] {
  return words
    .filter((w) => FILLERS.has(w.text.toLowerCase().replace(/[^a-z]/g, '')))
    .map((w) => ({ id: uid('sug_'), kind: 'remove' as const, start: w.start, end: w.end, reason: 'filler' as const, label: `Filler “${w.text.trim()}”` }))
}

const pad = (n: number, l = 2) => String(Math.floor(n)).padStart(l, '0')

function stamp(t: number, sep: string): string {
  const ms = Math.round(t * 1000)
  return `${pad(ms / 3600000)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`
}

export function toSRT(segs: CaptionSegment[]): string {
  return segs.map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text}\n`).join('\n')
}

export function toVTT(segs: CaptionSegment[]): string {
  return 'WEBVTT\n\n' + segs.map((s) => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text}\n`).join('\n')
}

function assColor(css: string, alpha = 0): string {
  const m = css.match(/^#?([0-9a-f]{6})$/i)
  const hex = m ? m[1] : 'ffffff'
  const [r, g, b] = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
  return `&H${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase()
}

function assTime(t: number): string {
  const cs = Math.round(t * 100)
  return `${Math.floor(cs / 360000)}:${pad((cs / 6000) % 60)}:${pad((cs / 100) % 60)}.${pad(cs % 100)}`
}

/** Advanced SubStation file used to burn captions during export. */
export function toASS(segs: CaptionSegment[], style: TextStyle, width: number, height: number): string {
  const font = style.fontFamily.split(',')[0].replace(/["']/g, '').trim()
  const marginV = Math.round((1 - style.y) * height)
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${style.fontSize},${assColor(style.color)},${assColor(style.color)},${assColor(style.strokeColor)},&H80000000,${style.fontWeight >= 600 ? -1 : 0},0,0,0,100,100,0,0,${style.background ? 3 : 1},${style.strokeWidth / 2},${style.shadow ? 2 : 0},2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines = segs.map((s) => {
    const text = (style.uppercase ? s.text.toUpperCase() : s.text).replace(/\n/g, '\\N')
    return `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${text}`
  })
  return header + lines.join('\n') + '\n'
}
