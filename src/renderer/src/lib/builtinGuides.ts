import type { GuideStep } from './guide'

/** Offline "show me how" answers so common questions work instantly, even without an AI provider. */
export const BUILTIN_GUIDES: { keywords: RegExp; title: string; steps: GuideStep[] }[] = [
  {
    keywords: /import|add (media|video|footage|file)|upload/,
    title: 'Import media',
    steps: [
      { target: 'topbar.import', text: 'Click Footage (or press Ctrl+I) and pick your video, audio or image files.', shortcut: 'Ctrl+I' },
      { target: 'pool.media', text: 'Your files appear in the Media Pool. You can also drag files straight from your desktop here.' },
      { target: 'timeline', text: 'Drag a file onto a track, or double-click it to append it to the end of the timeline.' }
    ]
  },
  {
    keywords: /caption|subtitle|transcri/,
    title: 'Add auto captions',
    steps: [
      { target: 'topbar.captions', text: 'Click Subtitles. Cutline transcribes the timeline audio and creates a caption track.' },
      { target: 'timeline', text: 'Captions land on the Captions track. Click one to edit its text.' },
      { target: 'inspector.text', text: 'Style all captions at once here: font, size, colour, box and animation.' },
      { target: 'export.captions', text: 'On the Export page you can burn them in or save SRT/VTT files.' }
    ]
  },
  {
    keywords: /split|cut (a|the|this) clip|razor|blade/,
    title: 'Split a clip',
    steps: [
      { target: 'timeline.ruler', text: 'Move the playhead to where you want the cut.' },
      { target: 'topbar.tool-razor', text: 'Pick the Razor tool (B) and click the clip, or just press S to split selected clips at the playhead.', shortcut: 'B / S' }
    ]
  },
  {
    keywords: /silence|auto ?cut|dead air|pause|filler|um/,
    title: 'Remove silences automatically',
    steps: [
      { target: 'topbar.suggest', text: 'Suggest cuts marks silences (and filler words if you have captions) in red without changing anything.' },
      { target: 'timeline.suggestions', text: 'Review them here: Apply all, Dismiss, or click a single red range to cut just that one.' },
      { target: 'topbar.autocut', text: 'Or use Auto cut to remove them all in one go.' }
    ]
  },
  {
    keywords: /text|title|lower third/,
    title: 'Add text',
    steps: [
      { target: 'pool.text', text: 'Open the Text tab in the Media Pool.' },
      { target: 'timeline.ruler', text: 'Text is added at the playhead, so put it where you want the title to start.' },
      { target: 'inspector.text', text: 'Click a preset, then edit the words, font, colours and animation here.' }
    ]
  },
  {
    keywords: /export|render|save (the )?video|youtube|mp4/,
    title: 'Export your video',
    steps: [
      { target: 'page.export', text: 'Go to the Export page.' },
      { target: 'export.preset', text: 'Pick a preset (YouTube, Shorts, ProRes, audio-only…).' },
      { target: 'export.start', text: 'Click Export and choose where to save.' }
    ]
  },
  {
    keywords: /volume|audio|loud|quiet|music|mix/,
    title: 'Adjust audio',
    steps: [
      { target: 'mixer', text: 'Use the track faders to balance voice and music. M mutes, S solos. Double-click a fader to reset.' },
      { target: 'inspector.audio', text: 'For a single clip, select it and change its volume and fades here.' }
    ]
  },
  {
    keywords: /magnet|gap|ripple/,
    title: 'Magnetic timeline',
    steps: [{ target: 'topbar.magnetic', text: 'With Magnetic on, the main video track stays gapless: deleting a clip pulls later clips left and inserting pushes them right.' }]
  },
  {
    keywords: /collab|share|invite|together|multiplayer/,
    title: 'Edit together',
    steps: [
      { target: 'topbar.share', text: 'Click Share → Host to start a room, then send the invite link. Friends paste it under Share → Join.' },
      { target: 'timeline', text: 'Everyone sees each other’s cursors, selections and playheads live, and edits sync instantly.' }
    ]
  },
  {
    keywords: /template|like this|reference|style|preset/,
    title: 'Templates and reference videos',
    steps: [
      { target: 'pool.templates', text: 'Open the Templates tab.' },
      { target: 'pool.reference', text: 'Choose a reference video and click Build rough cut to recut your media in its style.' },
      { target: 'pool.save-template', text: 'Save your current timeline layout as a template to reuse later.' }
    ]
  },
  {
    keywords: /vertical|short|reel|tiktok|9:16|aspect|resolution/,
    title: 'Change format (e.g. vertical)',
    steps: [{ target: 'inspector.project', text: 'Deselect all clips (click empty timeline) and change Resolution here, e.g. 1080×1920 for Shorts/Reels.' }]
  },
  {
    keywords: /mcp|claude|codex|gemini|agent|api key|openai|anthropic/,
    title: 'Connect AI agents',
    steps: [
      { target: 'topbar.settings', text: 'Add API keys and pick the cloud model or local CLI agent in Settings.' },
      { target: 'agent.mode', text: 'Choose who runs your request: cloud model or local CLI agent.' },
      { target: 'agent.mcp', text: 'Copy these snippets to connect any external MCP client to the editor.' }
    ]
  }
]

export function findBuiltinGuide(prompt: string) {
  const q = prompt.toLowerCase()
  if (!/\b(how|where|show me|what is|what's|teach|help)\b/.test(q)) return null
  return BUILTIN_GUIDES.find((g) => g.keywords.test(q)) ?? null
}
