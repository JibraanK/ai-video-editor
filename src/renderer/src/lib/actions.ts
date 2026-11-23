import { fillerSuggestions } from '@shared/captions'
import { createProject, normalizeProject } from '@shared/project'
import type { MediaItem } from '@shared/types'
import { getState, useStore } from '../store'

async function busy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const s = getState()
  s.set({ busy: label })
  try {
    return await fn()
  } catch (e) {
    s.toast((e as Error).message, 'error')
    return undefined
  } finally {
    useStore.setState({ busy: null })
  }
}

export async function importPaths(paths: string[]): Promise<MediaItem[]> {
  if (!paths.length) return []
  const res = (await busy('Importing media…', () => window.api.importMedia(paths))) ?? []
  const ok = res.filter((r: any) => !r.error) as MediaItem[]
  for (const r of res.filter((r: any) => r.error)) getState().toast(`Could not import ${r.path}: ${r.error}`, 'error')
  if (ok.length) getState().addMedia(ok)
  const existing = getState().project.media
  return ok.map((m) => existing.find((x) => x.path === m.path) ?? m)
}

export async function importDialog(): Promise<void> {
  await importPaths(await window.api.openMediaDialog())
}

export const appendToTimeline = (mediaId: string) => getState().dispatch('add_clip', { mediaId }).catch((e) => getState().toast(e.message, 'error'))

export async function autoCaptions(): Promise<void> {
  const r: any = await busy('Transcribing… (this can take a while)', () => window.api.runTool('transcribe_timeline', { captions: true }))
  if (r) getState().toast(`Added ${r.captions ?? 0} captions from ${r.words} words`)
}

export async function suggestCuts(): Promise<void> {
  const r: any = await busy('Finding silences…', () => window.api.runTool('detect_silences', { suggest: true }))
  const words = getState().project.transcript?.words
  if (words?.length) {
    const fillers = fillerSuggestions(words)
    if (fillers.length) await getState().dispatch('suggest_cuts', { suggestions: fillers.map((f) => ({ kind: 'remove', start: f.start, end: f.end, label: f.label })) })
  }
  if (r) getState().toast(r.ranges.length ? `${getState().project.suggestions.length} cuts suggested — review them on the timeline` : 'No silences found')
}

export async function autoCut(): Promise<void> {
  const r: any = await busy('Auto cutting…', () => window.api.runTool('auto_cut', {}))
  if (r) getState().toast(r.cuts ? `Removed ${r.cuts} silent/filler sections` : 'Nothing to cut')
}

export function newProject(): void {
  if (getState().dirty && !confirm('Discard unsaved changes?')) return
  getState().setProject(createProject(), 'New', { resetHistory: true })
  getState().set({ projectPath: null, playhead: 0 })
}

export async function saveProject(saveAs = false): Promise<void> {
  const s = getState()
  const path = await window.api.saveProject(s.project, saveAs ? undefined : (s.projectPath ?? undefined))
  if (path) {
    s.set({ projectPath: path, dirty: false })
    s.toast('Project saved')
  }
}

export async function openProject(): Promise<void> {
  const r = await window.api.openProject()
  if (!r) return
  getState().setProject(normalizeProject(r.project), 'Open', { resetHistory: true })
  getState().set({ projectPath: r.path, playhead: 0, dirty: false })
}

export const runTool = (label: string, name: string, args: unknown) => busy(label, () => window.api.runTool(name, args))
