import { describe, expect, it } from 'vitest'
import { applyCommand } from '@shared/commands'
import { wordsToCaptions, toSRT, toASS } from '@shared/captions'
import { buildExportArgs } from '@shared/exportGraph'
import { createProject } from '@shared/project'
import { CAPTION_STYLE, EXPORT_PRESETS } from '@shared/presets'
import { planFromStyle, applyTemplate, BUILTIN_TEMPLATES, templateFromProject } from '@shared/templates'

const preset = EXPORT_PRESETS[0].options

function project() {
  let p = createProject('t')
  p.media = [{ id: 'a', name: 'a.mp4', path: '/x/a.mp4', kind: 'video', duration: 10, hasAudio: true, hasVideo: true, width: 1920, height: 1080 }]
  p = applyCommand(p, 'add_clip', { mediaId: 'a' }).project
  p = applyCommand(p, 'add_text', { text: 'Hi', start: 1, duration: 2 }).project
  return p
}

describe('export graph', () => {
  it('builds a filter graph with video, text overlay and audio', () => {
    const p = project()
    const text = p.clips.find((c) => c.text)!
    const args = buildExportArgs({ project: p, options: { ...preset, outputPath: '/o.mp4', burnCaptions: false }, textOverlays: [{ clipId: text.id, pngPath: '/t.png' }] })
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('color=c=0x000000:s=1920x1080')
    expect(fc).toContain('overlay')
    expect(fc).toContain('[aout]')
    expect(args).toContain('/t.png')
    expect(args.slice(-1)[0]).toBe('/o.mp4')
    expect(args.filter((a) => a === '/x/a.mp4')).toHaveLength(2)
  })

  it('honours range and mute', () => {
    let p = project()
    const v = p.tracks.find((t) => t.kind === 'video')!
    p = applyCommand(p, 'update_track', { trackId: v.id, muted: true }).project
    const args = buildExportArgs({ project: p, options: { ...preset, outputPath: '/o.mp4', burnCaptions: false, range: { start: 2, end: 5 } } })
    expect(args[args.indexOf('-t', args.indexOf('-progress') - 3) + 1]).toBe('3')
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('anullsrc')
    expect(args).toContain('2')
  })

  it('audio-only export skips video', () => {
    const args = buildExportArgs({ project: project(), options: { ...EXPORT_PRESETS.find((x) => x.id === 'wav')!.options, outputPath: '/o.wav', burnCaptions: false } })
    expect(args).not.toContain('[vout]')
  })
})

describe('captions', () => {
  const words = 'Hello there. This is a fairly long sentence that should wrap into lines'.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 }))
  it('chunks words', () => {
    const segs = wordsToCaptions(words, { maxChars: 24 })
    expect(segs[0].text).toBe('Hello there.')
    expect(segs.every((s) => s.text.length <= 24)).toBe(true)
    expect(toSRT(segs)).toContain('00:00:00,000 --> ')
    expect(toASS(segs, CAPTION_STYLE, 1920, 1080)).toContain('PlayResX: 1920')
  })
})

describe('templates', () => {
  it('plans a cut that mimics pacing', () => {
    const p = project()
    const plan = planFromStyle({ source: 'r', width: 1080, height: 1920, fps: 30, duration: 6, shotCount: 3, averageShot: 2, medianShot: 2, shots: [1, 2, 3], speechRatio: 0, hasAudio: true, captions: false }, p.media)
    expect(plan.map((x) => x.duration)).toEqual([1, 2, 3])
    expect(plan.every((x) => x.sourceIn + x.duration <= 10)).toBe(true)
  })
  it('round-trips a template', () => {
    const p = project()
    const tpl = templateFromProject(p, 'mine')
    expect(tpl.slots).toHaveLength(1)
    const q = applyTemplate(p, tpl, ['a'])
    expect(q.clips).toHaveLength(2)
    const shorts = applyTemplate(p, BUILTIN_TEMPLATES[1], ['a'])
    expect(shorts.settings.height).toBe(1920)
    expect(shorts.clips.filter((c) => c.mediaId)).toHaveLength(8)
  })
})
