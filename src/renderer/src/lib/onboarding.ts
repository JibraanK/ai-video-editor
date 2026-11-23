import { create } from 'zustand'
import { createProject } from '@shared/project'
import { projectDuration } from '@shared/timeline'
import { getState, onCommand, useStore } from '../store'
import { importDialog, importPaths } from './actions'
import { BUILTIN_GUIDES } from './builtinGuides'
import { useGuide, type GuideStep } from './guide'
import { milestoneFromCommand, milestonesFromProject, QUICKSTART_ORDER, type QuickstartId } from '@shared/quickstart'

const KEY = 'cutline.onboarding:v1'

interface Saved {
  /** First-run welcome has been answered. */
  welcomed: boolean
  checklist: boolean
  done: QuickstartId[]
  tutorialDone: boolean
}

interface OnboardingState extends Saved {
  welcome: boolean
  collapsed: boolean
  mark: (id: QuickstartId) => void
  set: (patch: Partial<OnboardingState>) => void
}

function load(): Saved {
  try {
    return { welcomed: false, checklist: false, done: [], tutorialDone: false, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { welcomed: false, checklist: false, done: [], tutorialDone: false }
  }
}

const saved = load()

export const useOnboarding = create<OnboardingState>((set, get) => ({
  ...saved,
  welcome: !saved.welcomed,
  collapsed: false,
  mark: (id) => {
    if (!get().done.includes(id)) set({ done: [...get().done, id] })
  },
  set: (patch) => set(patch)
}))

useOnboarding.subscribe((s) => {
  const { welcomed, checklist, done, tutorialDone } = s
  localStorage.setItem(KEY, JSON.stringify({ welcomed, checklist, done, tutorialDone }))
})

export const markQuickstart = (id: QuickstartId) => {
  if (!inTutorial()) useOnboarding.getState().mark(id)
}

const inTutorial = () => {
  const g = useGuide.getState()
  return g.active && g.title === 'Tutorial'
}

/** Ticks quickstart items off as the user does them in their own projects (the tutorial and its sample clip don't count). */
export function trackOnboarding(): () => void {
  const fromProject = () => milestonesFromProject(getState().project).forEach(markQuickstart)
  fromProject()
  const offStore = useStore.subscribe((s, prev) => s.project !== prev.project && fromProject())
  const offCmd = onCommand((name, args) => {
    const id = milestoneFromCommand(name, args)
    if (id) markQuickstart(id)
  })
  return () => {
    offStore()
    offCmd()
  }
}

const guide = (title: string) => BUILTIN_GUIDES.find((g) => g.title === title)!.steps

export const QUICKSTART: Record<QuickstartId, { title: string; detail: string; steps: GuideStep[] }> = {
  import: { title: 'Bring in footage', detail: 'Click Footage or drop files on the Library.', steps: guide('Import media') },
  place: {
    title: 'Put a clip on the timeline',
    detail: 'Double-click a clip in the Library, or drag it onto a track.',
    steps: [
      { target: 'pool.media', text: 'Double-click a clip to append it to the timeline, or drag it onto a track to place it.' },
      { target: 'timeline', text: 'Drag clips to move them, drag their edges to trim.' }
    ]
  },
  cut: {
    title: 'Make your first cut',
    detail: 'Park the playhead and press S to split, then Delete a piece.',
    steps: [
      { target: 'timeline.ruler', text: 'Click the ruler to move the playhead to where you want to cut.' },
      { target: 'timeline.split', text: 'Press S or click Split to cut at the playhead.', shortcut: 'S' },
      { target: 'timeline.delete', text: 'Click the piece you don’t want, then press Delete. Magnetic mode closes the gap.', shortcut: 'Delete' }
    ]
  },
  ai: {
    title: 'Let AI make an edit',
    detail: 'Suggest cuts finds dead air. Subtitles transcribes. Ask does the rest.',
    steps: [
      { target: 'topbar.suggest', text: 'Suggest cuts marks silences in pink without changing anything. Review, then apply.' },
      { target: 'topbar.captions', text: 'Subtitles transcribes your timeline and adds a caption track.' },
      { target: 'topbar.ask', text: 'Or ask in plain words: “remove the silences”, “add a title that says Hello”.', shortcut: 'Ctrl+K' }
    ]
  },
  export: { title: 'Export a video', detail: 'Pick a preset on the Export page and render.', steps: guide('Export your video') }
}

export function showQuickstartGuide(id: QuickstartId): void {
  useGuide.getState().start(QUICKSTART[id].title, QUICKSTART[id].steps)
}

export function openQuickstart(): void {
  useOnboarding.setState({ welcome: false, welcomed: true, checklist: true, collapsed: false })
}

export async function startQuickstart(): Promise<void> {
  openQuickstart()
  if (!getState().project.media.length) await importDialog()
}

export function skipOnboarding(): void {
  useOnboarding.setState({ welcome: false, welcomed: true })
}

const midClip = ({ s }: { s: ReturnType<typeof getState> }) => !s.playing && s.playhead > 0.5 && s.playhead < projectDuration(s.project) - 0.5

export const TUTORIAL: GuideStep[] = [
  { target: 'pool.items', text: 'This 12-second sample clip has tones with silent gaps. Double-click it, or drag it down, to put it on the timeline.', until: ({ s }) => s.project.clips.some((c) => c.mediaId) },
  { target: 'preview.play', text: 'Play it. Click Play or press Space.', shortcut: 'Space', until: ({ s }) => s.playing },
  { target: 'timeline.ruler', text: 'Pause, then click the ruler near 0:04 to park the playhead in the middle of the clip.', until: midClip },
  { target: 'timeline.split', text: 'Cut here. Press S, or click Split.', shortcut: 'S', until: ({ seen }) => seen.has('split') },
  { target: 'timeline', text: 'Click one of the two halves to select it, then press Delete. Magnetic mode closes the gap.', shortcut: 'Delete', until: ({ seen }) => seen.has('delete_clips') },
  { target: 'topbar.undo', text: 'Changed your mind? Undo brings it back. Every edit is undoable, including the AI’s.', shortcut: 'Ctrl+Z', until: ({ seen }) => seen.has('undo') },
  { target: 'topbar.suggest', text: 'Now let Cutline find the dead air. Click Suggest cuts. It marks silences in pink and changes nothing yet.', until: ({ s }) => s.project.suggestions.length > 0 },
  { target: 'timeline.suggestions', text: 'Review them: click a single pink range to cut just that one, or Apply all.', until: ({ s, seen }) => seen.has('apply_suggestions') || !s.project.suggestions.length },
  { target: 'agent.input', text: 'For anything else, ask: “add a title that says Hello”, “make it vertical”, “how do I add music?”. Cloud models need an API key in Settings; local CLI agents work too.' },
  { target: 'page.export', text: 'When it looks right, render it from Export. That’s the whole loop. Import your own footage whenever you’re ready.' }
]

export async function startTutorial(): Promise<void> {
  const s = getState()
  if (s.remote) return s.toast('Leave the live session before starting the tutorial', 'error')
  useGuide.getState().stop()
  useOnboarding.setState({ welcome: false, welcomed: true })
  s.set({ busy: 'Preparing sample clip…' })
  let path: string
  try {
    path = await window.api.sampleClip()
  } catch (e) {
    return s.toast((e as Error).message, 'error')
  } finally {
    useStore.setState({ busy: null })
  }
  if (getState().dirty && !confirm('The tutorial opens a fresh project. Discard unsaved changes?')) return
  const project = createProject('Tutorial')
  s.setProject(project, 'New', { resetHistory: true })
  s.set({ projectPath: null, playhead: 0, playing: false, selection: [], page: 'edit', pool: true, side: null, tool: 'select' })
  const [media] = await importPaths([path])
  if (!media) return
  getState().set({ dirty: false, past: [] })
  useGuide.getState().start('Tutorial', TUTORIAL, {
    onDone: () => {
      useOnboarding.setState({ tutorialDone: true })
      getState().toast('Tutorial complete. You know the loop: import, cut, ask, export.')
    }
  })
}

export const quickstartCount = (done: readonly QuickstartId[]) => QUICKSTART_ORDER.filter((id) => done.includes(id)).length
