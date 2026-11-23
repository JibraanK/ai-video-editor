import type { Project } from '@shared/types'

export type QuickstartId = 'import' | 'place' | 'cut' | 'ai' | 'export'

export const QUICKSTART_ORDER: QuickstartId[] = ['import', 'place', 'cut', 'ai', 'export']

/** File name of the generated tutorial clip; it never counts toward the quickstart. */
export const SAMPLE_CLIP_NAME = 'cutline-sample-v1.mp4'

export const isSampleMedia = (m: { path: string }) => m.path.endsWith(SAMPLE_CLIP_NAME)

const CUT_COMMANDS = new Set(['split', 'delete_clips', 'trim_clip', 'remove_ranges', 'apply_suggestions'])
const AI_COMMANDS = new Set(['suggest_cuts', 'add_captions', 'assemble_sequence'])

/** Milestones the current project already proves. */
export function milestonesFromProject(p: Project): QuickstartId[] {
  const out: QuickstartId[] = []
  const own = new Set(p.media.filter((m) => !isSampleMedia(m)).map((m) => m.id))
  if (own.size) out.push('import')
  if (p.clips.some((c) => c.mediaId && own.has(c.mediaId))) out.push('place')
  if (p.transcript?.words.length || p.suggestions.length || p.tracks.some((t) => t.kind === 'caption' && p.clips.some((c) => c.trackId === t.id))) out.push('ai')
  return out
}

/** Milestone reached by a successful edit command, if any. */
export function milestoneFromCommand(name: string, args?: unknown): QuickstartId | null {
  if (CUT_COMMANDS.has(name)) return 'cut'
  if (name === 'suggest_cuts' && !(args as { suggestions?: unknown[] } | undefined)?.suggestions?.length) return null
  if (AI_COMMANDS.has(name)) return 'ai'
  return null
}

export function nextMilestone(done: readonly QuickstartId[]): QuickstartId | null {
  return QUICKSTART_ORDER.find((id) => !done.includes(id)) ?? null
}
