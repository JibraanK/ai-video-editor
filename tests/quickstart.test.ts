import { describe, expect, it } from 'vitest'
import { applyCommand } from '@shared/commands'
import { createProject } from '@shared/project'
import type { MediaItem } from '@shared/types'
import { milestoneFromCommand, milestonesFromProject, nextMilestone } from '@shared/quickstart'

const media: MediaItem = { id: 'a', name: 'a.mp4', path: '/tmp/a.mp4', kind: 'video', duration: 10, hasAudio: true, hasVideo: true, width: 1920, height: 1080 }

describe('quickstart milestones', () => {
  it('reads progress from the project', () => {
    const p = createProject('t')
    expect(milestonesFromProject(p)).toEqual([])
    p.media = [media]
    expect(milestonesFromProject(p)).toEqual(['import'])
    const placed = applyCommand(p, 'add_clip', { mediaId: 'a' }).project
    expect(milestonesFromProject(placed)).toEqual(['import', 'place'])
    const suggested = applyCommand(placed, 'suggest_cuts', { suggestions: [{ kind: 'remove', start: 1, end: 2 }] }).project
    expect(milestonesFromProject(suggested)).toContain('ai')
  })

  it('maps edit commands to milestones', () => {
    expect(milestoneFromCommand('split')).toBe('cut')
    expect(milestoneFromCommand('apply_suggestions')).toBe('cut')
    expect(milestoneFromCommand('suggest_cuts')).toBe('ai')
    expect(milestoneFromCommand('move_clip')).toBeNull()
  })

  it('finds the next step in order', () => {
    expect(nextMilestone([])).toBe('import')
    expect(nextMilestone(['import', 'cut'])).toBe('place')
    expect(nextMilestone(['import', 'place', 'cut', 'ai', 'export'])).toBeNull()
  })
})
