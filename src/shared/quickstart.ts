import type { Project } from '@shared/types'

export type QuickstartId = 'import' | 'place' | 'cut' | 'ai' | 'export'

export const QUICKSTART_ORDER: QuickstartId[] = ['import', 'place', 'cut', 'ai', 'export']

const CUT_COMMANDS = new Set(['split', 'delete_clips', 'trim_clip', 'remove_ranges', 'apply_suggestions'])
const AI_COMMANDS = new Set(['suggest_cuts', 'add_captions', 'assemble_sequence'])

/** Milestones the current project already proves. */
export function milestonesFromProject(p: Project): QuickstartId[] {
  const out: QuickstartId[] = []
  if (p.media.length) out.push('import')
  if (p.clips.some((c) => c.mediaId)) out.push('place')
  if (p.transcript?.words.length || p.suggestions.length || p.tracks.some((t) => t.kind === 'caption' && p.clips.some((c) => c.trackId === t.id))) out.push('ai')
  return out
}

/** Milestone reached by a successful edit command, if any. */
export function milestoneFromCommand(name: string): QuickstartId | null {
  if (CUT_COMMANDS.has(name)) return 'cut'
  if (AI_COMMANDS.has(name)) return 'ai'
  return null
}

export function nextMilestone(done: readonly QuickstartId[]): QuickstartId | null {
  return QUICKSTART_ORDER.find((id) => !done.includes(id)) ?? null
}
