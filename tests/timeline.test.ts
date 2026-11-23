import { describe, expect, it } from 'vitest'
import { applyCommand } from '@shared/commands'
import { createProject } from '@shared/project'
import { clipsOnTrack, projectDuration } from '@shared/timeline'
import type { MediaItem, Project } from '@shared/types'

const media = (id: string, duration: number, kind: MediaItem['kind'] = 'video'): MediaItem => ({ id, name: `${id}.mp4`, path: `/tmp/${id}.mp4`, kind, duration, hasAudio: kind !== 'image', hasVideo: kind !== 'audio', width: 1920, height: 1080 })

function setup(): Project {
  const p = createProject('t')
  p.media = [media('a', 10), media('b', 6), media('m', 30, 'audio')]
  return p
}

const run = (p: Project, name: string, args: unknown = {}) => applyCommand(p, name, args)
const video = (p: Project) => p.tracks.find((t) => t.kind === 'video')!

describe('edit commands', () => {
  it('appends clips back to back', () => {
    let p = setup()
    p = run(p, 'add_clip', { mediaId: 'a' }).project
    p = run(p, 'add_clip', { mediaId: 'b' }).project
    const clips = clipsOnTrack(p, video(p).id)
    expect(clips.map((c) => [c.start, c.duration])).toEqual([[0, 10], [10, 6]])
    expect(projectDuration(p)).toBe(16)
  })

  it('routes audio media to audio tracks', () => {
    const p = run(setup(), 'add_clip', { mediaId: 'm' }).project
    expect(p.tracks.find((t) => t.id === p.clips[0].trackId)!.kind).toBe('audio')
  })

  it('splits and ripple deletes in magnetic mode', () => {
    let p = run(setup(), 'add_clip', { mediaId: 'a' }).project
    p = run(p, 'add_clip', { mediaId: 'b' }).project
    p = run(p, 'split', { time: 4 }).project
    const mid = clipsOnTrack(p, video(p).id)
    expect(mid).toHaveLength(3)
    expect(mid[1].in).toBe(4)
    p = run(p, 'delete_clips', { clipIds: [mid[0].id] }).project
    const after = clipsOnTrack(p, video(p).id)
    expect(after.map((c) => c.start)).toEqual([0, 6])
  })

  it('keeps gaps when magnetic is off', () => {
    let p = run(setup(), 'set_magnetic', { enabled: false }).project
    p = run(p, 'add_clip', { mediaId: 'a' }).project
    p = run(p, 'add_clip', { mediaId: 'b', start: 20 }).project
    expect(clipsOnTrack(p, video(p).id).map((c) => c.start)).toEqual([0, 20])
    p = run(p, 'move_clip', { clipId: clipsOnTrack(p, video(p).id)[1].id, start: 5 }).project
    const c = clipsOnTrack(p, video(p).id)
    expect(c.map((x) => [x.start, x.duration])).toEqual([[0, 5], [5, 6]])
  })

  it('ripple removes ranges across tracks', () => {
    let p = run(setup(), 'add_clip', { mediaId: 'a' }).project
    p = run(p, 'add_clip', { mediaId: 'm' }).project
    p = run(p, 'remove_ranges', { ranges: [{ start: 2, end: 3 }, { start: 5, end: 7 }] }).project
    expect(projectDuration(p)).toBe(27)
    const v = clipsOnTrack(p, video(p).id)
    expect(v.map((c) => [c.start, c.in, c.duration])).toEqual([[0, 0, 2], [2, 3, 2], [4, 7, 3]])
  })

  it('trims with source limits', () => {
    let p = run(setup(), 'add_clip', { mediaId: 'b' }).project
    const id = p.clips[0].id
    p = run(p, 'trim_clip', { clipId: id, end: 100 }).project
    expect(p.clips[0].duration).toBe(6)
    p = run(p, 'trim_clip', { clipId: id, start: 2 }).project
    expect(p.clips[0]).toMatchObject({ in: 2, duration: 4, start: 0 })
  })

  it('applies suggestions', () => {
    let p = run(setup(), 'add_clip', { mediaId: 'a' }).project
    p = run(p, 'suggest_cuts', { suggestions: [{ kind: 'remove', start: 1, end: 2 }, { kind: 'split', start: 6 }] }).project
    p = run(p, 'apply_suggestions').project
    expect(p.suggestions).toHaveLength(0)
    expect(clipsOnTrack(p, video(p).id).map((c) => c.start)).toEqual([0, 1, 5])
  })

  it('adds captions and text', () => {
    let p = run(setup(), 'add_captions', { segments: [{ start: 0, end: 1, text: 'hi' }, { start: 1, end: 2, text: 'there' }] }).project
    p = run(p, 'add_text', { text: 'Title', start: 0, preset: 'title' }).project
    expect(p.clips.filter((c) => c.text)).toHaveLength(3)
    expect(p.clips.find((c) => c.text === 'Title')!.textStyle!.fontSize).toBe(120)
  })

  it('does not mutate the input project', () => {
    const p = setup()
    run(p, 'add_clip', { mediaId: 'a' })
    expect(p.clips).toHaveLength(0)
  })
})
