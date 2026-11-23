import { fillerSuggestions, wordsToCaptions } from '@shared/captions'
import { UI_TOOLS } from '@shared/agentTools'
import { COMMANDS_BY_NAME } from '@shared/commands'
import { mergeRanges, round } from '@shared/timeline'
import { applyTemplate, planFromStyle, templateFromProject } from '@shared/templates'
import type { MediaItem, Project, StyleProfile } from '@shared/types'
import { basename } from 'node:path'
import { callRenderer } from './bridge'
import { detectScenes, detectSilences, importMedia, probe, type Range } from './ffmpeg'
import { exportOptionsFromPreset, renderProject, renderTimelineAudio } from './render'
import { listTemplates, saveTemplate } from './templatesStore'
import { transcribe } from './transcribe'

const getProject = (): Promise<Project> => callRenderer('getProject')
const apply = (name: string, args: unknown) => callRenderer('applyCommand', { name, args })
const setProject = (project: Project, label: string) => callRenderer('setProject', { project, label })

let lastProfile: StyleProfile | null = null

export async function silenceRanges(project: Project, a: { thresholdDb?: number; minDuration?: number; padding?: number } = {}): Promise<Range[]> {
  const wav = await renderTimelineAudio(project)
  const pad = a.padding ?? 0.12
  return (await detectSilences(wav, a.thresholdDb ?? -35, a.minDuration ?? 0.6))
    .map((r) => ({ start: round(r.start + (r.start > 0.01 ? pad : 0), 3), end: round(r.end - pad, 3) }))
    .filter((r) => r.end - r.start > 0.1)
}

export async function analyzeReference(path: string): Promise<StyleProfile> {
  const info = await probe(path)
  const scenes = await detectScenes(path, 0.3)
  const cuts = [0, ...scenes.filter((t) => t > 0.2 && t < info.duration - 0.2), info.duration]
  const shots: number[] = []
  for (let i = 1; i < cuts.length; i++) {
    const d = cuts[i] - cuts[i - 1]
    if (d < 0.25 && shots.length) shots[shots.length - 1] += d
    else shots.push(round(d, 3))
  }
  let speechRatio = 0
  if (info.hasAudio) {
    const silent = (await detectSilences(path, -35, 0.4)).reduce((s, r) => s + (r.end - r.start), 0)
    speechRatio = round(Math.max(0, 1 - silent / Math.max(info.duration, 0.01)), 3)
  }
  const sorted = [...shots].sort((a, b) => a - b)
  lastProfile = {
    source: basename(path),
    width: info.width ?? 1920,
    height: info.height ?? 1080,
    fps: Math.round(info.fps ?? 30),
    duration: round(info.duration, 3),
    shotCount: shots.length,
    averageShot: round(info.duration / Math.max(1, shots.length), 3),
    medianShot: sorted[Math.floor(sorted.length / 2)] ?? info.duration,
    shots,
    speechRatio,
    hasAudio: info.hasAudio,
    captions: (info.height ?? 0) > (info.width ?? 0) && speechRatio > 0.4,
    notes: (info.height ?? 0) > (info.width ?? 0) ? 'Vertical short-form video' : undefined
  }
  return lastProfile
}

export async function buildFromReference(a: { path?: string; mediaIds?: string[]; targetDuration?: number; profile?: StyleProfile }) {
  const profile = a.profile ?? (a.path ? await analyzeReference(a.path) : lastProfile)
  if (!profile) throw new Error('Analyze a reference video first')
  const project = await getProject()
  const media = (a.mediaIds?.length ? a.mediaIds.map((id) => project.media.find((m) => m.id === id)) : project.media).filter((m): m is MediaItem => !!m && m.kind !== 'audio')
  if (!media.length) throw new Error('Import some video or image media first')
  const items = planFromStyle(profile, media, a.targetDuration)
  await apply('set_project_settings', { width: profile.width, height: profile.height, fps: profile.fps })
  await apply('assemble_sequence', { items, replace: true, start: 0 })
  return { profile: { ...profile, shots: undefined }, shots: items.length, duration: round(items.reduce((s, i) => s + i.duration, 0), 3), captionsRecommended: profile.captions }
}

export async function transcribeTimeline(a: { captions?: boolean; language?: string } = {}) {
  const project = await getProject()
  const wav = await renderTimelineAudio(project)
  const words = await transcribe(wav, a.language)
  await callRenderer('setTranscript', { words })
  let captions = 0
  if (a.captions) {
    const segs = wordsToCaptions(words)
    await apply('add_captions', { segments: segs, replace: true })
    captions = segs.length
  }
  return { words: words.length, captions, preview: words.slice(0, 60).map((w) => w.text).join(' ') }
}

/** Executes any agent tool: edit commands go to the renderer, service tools run here. */
export async function executeTool(name: string, args: any = {}): Promise<unknown> {
  if (COMMANDS_BY_NAME.has(name)) return apply(name, args)
  if (UI_TOOLS.some((t) => t.name === name)) return callRenderer('uiTool', { name, args }, 600_000)
  if (name === 'build_feature') return (await import('./agents')).buildFeature(args.request)
  switch (name) {
    case 'import_media': {
      const items = await Promise.all((args.paths as string[]).map((p) => importMedia(p)))
      await callRenderer('addMedia', { items })
      return items.map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: m.duration }))
    }
    case 'transcribe_timeline':
      return transcribeTimeline(args)
    case 'detect_silences': {
      const ranges = await silenceRanges(await getProject(), args)
      if (args.suggest)
        await apply('suggest_cuts', { suggestions: ranges.map((r) => ({ kind: 'remove', start: r.start, end: r.end, reason: 'silence', label: `Silence ${round(r.end - r.start, 1)}s` })) })
      return { ranges, totalSeconds: round(ranges.reduce((s, r) => s + r.end - r.start, 0), 3) }
    }
    case 'auto_cut': {
      const project = await getProject()
      const ranges: Range[] = await silenceRanges(project, args)
      if (args.fillers !== false && project.transcript?.words.length) ranges.push(...fillerSuggestions(project.transcript.words))
      const merged = mergeRanges(ranges)
      const res = await apply('remove_ranges', { ranges: merged })
      return { cuts: merged.length, ...res }
    }
    case 'detect_scenes': {
      const project = await getProject()
      const m = project.media.find((x) => x.id === args.mediaId)
      if (!m) throw new Error(`Media not found: ${args.mediaId}`)
      return { mediaId: m.id, sceneChanges: (await detectScenes(m.path, args.threshold ?? 0.35)).map((t) => round(t, 3)) }
    }
    case 'analyze_reference':
      return analyzeReference(args.path)
    case 'build_from_reference':
      return buildFromReference(args)
    case 'list_templates':
      return listTemplates().map((t) => ({ id: t.id, name: t.name, description: t.description, slots: t.slots.length, builtin: !!t.builtin }))
    case 'apply_template': {
      const tpl = listTemplates().find((t) => t.id === args.templateId)
      if (!tpl) throw new Error(`Template not found: ${args.templateId}`)
      const project = await getProject()
      const ids = args.mediaIds ?? project.media.map((m) => m.id)
      await setProject(applyTemplate(project, tpl, ids), `Apply template ${tpl.name}`)
      return { applied: tpl.name, autoCaptions: !!tpl.autoCaptions }
    }
    case 'save_template': {
      const t = saveTemplate(templateFromProject(await getProject(), args.name, args.description))
      return { id: t.id, name: t.name }
    }
    case 'export_video': {
      const project = await getProject()
      return renderProject(project, exportOptionsFromPreset(args.preset, project, args.outputPath, args.burnCaptions ?? true))
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
