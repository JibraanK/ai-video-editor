import { EDIT_COMMANDS, type JSONSchema } from './commands'

export interface ToolDef {
  name: string
  description: string
  inputSchema: JSONSchema
}

const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({ type: 'object', properties, required, additionalProperties: false })

/** Tools implemented by the main process (FFmpeg / transcription / templates / export). */
export const SERVICE_TOOLS: ToolDef[] = [
  {
    name: 'import_media',
    description: 'Import media files (absolute paths) into the media pool. Returns the new media items with ids.',
    inputSchema: obj({ paths: { type: 'array', items: { type: 'string' } } }, ['paths'])
  },
  {
    name: 'transcribe_timeline',
    description: 'Transcribe the current timeline audio into a word-level transcript. captions=true also writes the caption track.',
    inputSchema: obj({ captions: { type: 'boolean' }, language: { type: 'string', description: 'ISO code, optional' } })
  },
  {
    name: 'detect_silences',
    description: 'Find silent ranges in the timeline audio. Returns ranges in timeline seconds; suggest=true shows them as cut suggestions.',
    inputSchema: obj({ thresholdDb: { type: 'number', description: 'Default -35' }, minDuration: { type: 'number', description: 'Default 0.6 s' }, padding: { type: 'number', description: 'Seconds of breathing room kept on each side, default 0.12' }, suggest: { type: 'boolean' } })
  },
  {
    name: 'auto_cut',
    description: 'One-shot auto edit: detect silences (and filler words if a transcript exists) and ripple-remove them from the timeline.',
    inputSchema: obj({ thresholdDb: { type: 'number' }, minDuration: { type: 'number' }, padding: { type: 'number' }, fillers: { type: 'boolean' } })
  },
  {
    name: 'detect_scenes',
    description: 'Detect shot changes inside a media item (source seconds). Useful to find natural cut points or b-roll moments.',
    inputSchema: obj({ mediaId: { type: 'string' }, threshold: { type: 'number', description: '0..1, default 0.35' } }, ['mediaId'])
  },
  {
    name: 'analyze_reference',
    description: 'Analyze a reference/template video file (absolute path): format, pacing (shot lengths), speech ratio. Returns a style profile.',
    inputSchema: obj({ path: { type: 'string' } }, ['path'])
  },
  {
    name: 'build_from_reference',
    description: 'Rough-cut the media pool into a new timeline mimicking a reference video style (format + pacing). Uses the last analyzed profile if path omitted.',
    inputSchema: obj({ path: { type: 'string' }, mediaIds: { type: 'array', items: { type: 'string' } }, targetDuration: { type: 'number' } })
  },
  {
    name: 'list_templates',
    description: 'List saved and built-in timeline templates.',
    inputSchema: obj({})
  },
  {
    name: 'apply_template',
    description: 'Rebuild the timeline from a template, filling its media slots with the given media ids (default: whole pool).',
    inputSchema: obj({ templateId: { type: 'string' }, mediaIds: { type: 'array', items: { type: 'string' } } }, ['templateId'])
  },
  {
    name: 'save_template',
    description: 'Save the current timeline as a reusable template.',
    inputSchema: obj({ name: { type: 'string' }, description: { type: 'string' } }, ['name'])
  },
  {
    name: 'export_video',
    description: 'Render the timeline to a file. preset: yt-1080, yt-4k, web-720, vertical, square, hevc, prores, webm, mp3, wav.',
    inputSchema: obj({ outputPath: { type: 'string', description: 'Absolute output path' }, preset: { type: 'string' }, burnCaptions: { type: 'boolean' } }, ['outputPath'])
  }
]

/** Tools handled by the renderer UI: guided tours and instant script plugins. */
export const UI_TOOLS: ToolDef[] = [
  {
    name: 'list_ui_targets',
    description: 'List UI elements that show_guide can point at (id + description), plus what is currently on screen.',
    inputSchema: obj({})
  },
  {
    name: 'show_guide',
    description:
      'Teach the user how to do something by walking them through the UI: a ghost cursor moves to each target, spotlights it and shows the step text. Use list_ui_targets for valid targets.',
    inputSchema: obj(
      {
        title: { type: 'string' },
        steps: { type: 'array', items: obj({ target: { type: 'string', description: 'UI target id' }, text: { type: 'string' }, shortcut: { type: 'string' } }, ['target', 'text']) }
      },
      ['title', 'steps']
    )
  },
  {
    name: 'create_plugin',
    description:
      'Instantly add a new feature as a script plugin (a button in the Plugins panel). code is the body of an async JS function receiving `api` with: api.run(commandName, args) -> result, api.project() -> project summary, api.playhead() -> seconds, api.selection() -> clip ids, api.toast(text). It runs sandboxed in a worker and can only use editor commands.',
    inputSchema: obj({ name: { type: 'string' }, description: { type: 'string' }, code: { type: 'string' }, runNow: { type: 'boolean' } }, ['name', 'code'])
  },
  {
    name: 'run_plugin',
    description: 'Run a saved script plugin by id or name.',
    inputSchema: obj({ plugin: { type: 'string' } }, ['plugin'])
  }
]

export const APP_TOOLS: ToolDef[] = [
  {
    name: 'build_feature',
    description:
      'For features that need real UI/code changes: run a local coding agent (Claude Code / Codex / Gemini CLI) on the Cutline source to implement the request; the app hot-reloads in dev mode. Ask the user first.',
    inputSchema: obj({ request: { type: 'string' } }, ['request'])
  }
]

export const ALL_TOOLS: ToolDef[] = [...EDIT_COMMANDS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), ...SERVICE_TOOLS, ...UI_TOOLS, ...APP_TOOLS]

export const AGENT_SYSTEM_PROMPT = `You are the built-in editing agent of Cutline, a desktop video editor.
You edit the user's open project only through the provided tools. Times are in seconds on the timeline unless a tool says "source seconds".
Workflow: call get_project first to see media, tracks and clips. Prefer small, verifiable steps and re-read the project after big edits.
For "suggest" requests, use suggest_cuts or detect_silences with suggest=true so the user can review; only apply edits directly when asked.
For "make a video like this template", call analyze_reference then build_from_reference, then add captions/text matching the style.
If the user asks HOW to do something, call list_ui_targets then show_guide to walk them through it on screen (and offer to just do it).
If they ask for something the editor can't do yet, build it: prefer create_plugin (instant, uses editor commands); use build_feature only for real UI changes and after the user agrees.
Keep replies short: say what you changed.`
