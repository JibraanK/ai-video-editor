import { create } from 'zustand'
import type { getState } from '../store'

/** Every element tagged with data-guide="<id>" can be pointed at by the assistant. */
export const GUIDE_TARGETS: Record<string, string> = {
  'topbar.import': 'Add footage: import media files into the Media Pool',
  'topbar.pool': 'Toggle the Media Pool drawer (media, text presets, templates, plugins)',
  'topbar.inspector': 'Toggle the Inspector drawer',
  'topbar.mixer': 'Toggle the audio Mixer drawer',
  'timeline.split': 'Split selected clips (or clips under the playhead) at the playhead (S)',
  'timeline.delete': 'Delete the selected clips',
  'timeline.gain': 'Lower or raise the selected clips by 1 dB',
  'topbar.undo': 'Undo / redo (Ctrl+Z / Ctrl+Shift+Z)',
  'topbar.magnetic': 'Magnetic timeline toggle: closes gaps on the main video track automatically',
  'topbar.tool-select': 'Selection tool (V): select, move and trim clips',
  'topbar.tool-razor': 'Razor tool (B): click a clip to split it',
  'topbar.captions': 'Auto captions: transcribes the timeline and adds a caption track',
  'topbar.suggest': 'Suggest cuts: finds silences and filler words and marks them for review',
  'topbar.autocut': 'Auto cut: removes silences/fillers immediately',
  'topbar.share': 'Share / collaborate: host or join a live multiplayer room',
  'topbar.ask': 'Ask Cutline: the AI assistant panel',
  'topbar.settings': 'Settings: AI providers, API keys, CLI agent, MCP, transcription',
  'topbar.help': 'Help: interactive tutorial, quickstart checklist, keyboard shortcuts',
  'page.edit': 'Edit page',
  'page.export': 'Export page',
  'pool.media': 'Media Pool tab: imported files; drag onto the timeline or double-click to append',
  'pool.items': 'Imported media files in the Media Pool',
  'pool.text': 'Text tab: text effect presets; click to add at the playhead',
  'pool.templates': 'Templates tab: apply or save video/timeline templates and analyse a reference video',
  'pool.plugins': 'Plugins tab: custom script features created by the assistant',
  'pool.reference': 'Reference video: upload a video and let the agent recreate its style with your footage',
  'pool.save-template': 'Save the current timeline as a reusable template',
  preview: 'Live playback preview',
  'preview.play': 'Play / pause (Space)',
  'preview.timecode': 'Current timecode',
  timeline: 'Timeline with video, audio, text and caption tracks',
  'timeline.ruler': 'Timeline ruler: click or drag to move the playhead',
  'timeline.zoom': 'Timeline zoom slider',
  'timeline.add-track': 'Add a new track',
  'timeline.suggestions': 'Suggested cuts bar: review, apply or dismiss suggestions',
  inspector: 'Inspector: properties of the selected clip, or project settings when nothing is selected',
  'inspector.transform': 'Clip position, scale and opacity',
  'inspector.audio': 'Clip volume and fades',
  'inspector.text': 'Text content, font, colours and animation',
  'inspector.project': 'Project settings: resolution, frame rate, magnetic mode',
  mixer: 'Audio mixer: per-track faders, mute/solo, master',
  'agent.input': 'Ask Cutline prompt box',
  'agent.mode': 'Choose which agent runs your request: cloud model or local CLI agent',
  'agent.mcp': 'MCP server status and connection snippets for external agents',
  'export.preset': 'Export format preset',
  'export.start': 'Start the export render',
  'export.captions': 'Export captions as SRT/VTT files'
}

export interface GuideContext {
  s: ReturnType<typeof getState>
  /** Commands (plus 'undo' / 'redo') performed since this step appeared. */
  seen: Set<string>
}

export interface GuideStep {
  target: string
  text: string
  shortcut?: string
  /** Interactive step: waits for the user to do it and advances when this returns true. */
  until?: (ctx: GuideContext) => boolean
}

interface GuideState {
  title: string
  steps: GuideStep[]
  index: number
  active: boolean
  onDone?: () => void
  start: (title: string, steps: GuideStep[], opts?: { onDone?: () => void }) => void
  next: () => void
  back: () => void
  stop: () => void
}

export const useGuide = create<GuideState>((set, get) => ({
  title: '',
  steps: [],
  index: 0,
  active: false,
  start: (title, steps, opts) => set({ title, steps, index: 0, active: steps.length > 0, onDone: opts?.onDone }),
  next: () => {
    const { index, steps, onDone } = get()
    if (index + 1 < steps.length) return set({ index: index + 1 })
    set({ active: false, onDone: undefined })
    onDone?.()
  },
  back: () => set({ index: Math.max(0, get().index - 1) }),
  stop: () => set({ active: false })
}))

export function visibleTargets(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-guide]')].filter((el) => el.offsetParent !== null).map((el) => el.dataset.guide!)
}
