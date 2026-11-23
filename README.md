# Cutline (ai-video-editor)

A clean, AI-native desktop video editor (Electron + React + TypeScript). It has a Premiere/Resolve-style layout and every edit goes through one command API that the UI, MCP clients, local CLI agents, cloud agents and multiplayer collaborators all share.

## Features
- **Edit page:** media pool (media / text presets / templates / plugins), live canvas preview, multi-track timeline (magnetic mode, razor, trim, snapping, markers), inspector, simple audio mixer (gain, mute, solo, master).
- **Captions:** auto-transcription (OpenAI Whisper API, whisper.cpp or openai-whisper CLI) into a caption track. Captions can be styled, burned in, or exported as SRT/VTT.
- **Text effects:** presets plus fade/slide/pop/typewriter animations. The same canvas renderer draws the preview and the export.
- **Suggested cuts / auto cut:** silence detection (FFmpeg) and filler words (from the transcript). Review them as overlays on the timeline, or apply them with a ripple delete.
- **Templates:** analyse a reference video (pacing, scenes, captions), save the timeline as a template, apply templates or presets, or let an agent "make a video like this".
- **Export page:** presets (1080p, 720p, vertical 9:16, square, ProRes, audio-only), whole timeline or a custom range, optional caption burn-in.
- **AI:**
  - Built-in MCP server (`http://127.0.0.1:47821/mcp`) and a stdio bridge (`npm run mcp:stdio`).
  - Local CLI agents: Claude Code, Codex, Gemini CLI, or a custom command.
  - Cloud agents: OpenAI, Anthropic, or any OpenAI-compatible endpoint.
- **Ask Cutline:**
  - "Show me how": a spotlight and ghost cursor walk you through the UI.
  - "Just do it": the assistant makes the edit for you.
  - "Build it": the assistant creates an instant sandboxed script plugin. For bigger features, `build_feature` runs a local coding agent on this repo (dev mode only).
- **Multiplayer:** host or join a room. Edits are host-authoritative, and everyone sees live cursors, selections and playheads. Media streams from the host to guests.

## Requirements
- Node 20+ (tested with 24) and npm
- FFmpeg and ffprobe on `PATH`, or set their paths in Settings
- Optional: an OpenAI or Anthropic key (cloud agent, Whisper API), `whisper.cpp` or `openai-whisper` (local captions), and `claude`, `codex` or `gemini` CLIs

## Run
```bash
npm install
npm run dev        # hot-reloading dev app
npm run build && npm start   # production build preview
npm run typecheck && npm test
```
If Electron fails to start after install, run `node node_modules/electron/install.js`.

## Connect an external agent (MCP)
The MCP server starts with the app. Open Ask Cutline, then the MCP card, to copy configs. You can also connect manually:
```bash
claude mcp add --transport http cutline http://127.0.0.1:47821/mcp
# stdio-only clients:
CUTLINE_MCP_URL=http://127.0.0.1:47821/mcp node bin/mcp-stdio.mjs
```

## Collaboration
Click **Share**, then **Host room**, and send the invite link (guests must be able to reach the host's port on your LAN, or through a tunnel). To run the room server on its own: `npm run collab-server`.

## Design
Near-black, minimal UI modelled on internetVin's custom editor: a top bar of pill actions, a large centred preview, a pill toolbar above a full-width timeline, and drawers for the Library (left) and Inspector / Mixer / Ask (right). Type: Pilowlava (wordmark), Orbitron (chrome labels), Chakra Petch (UI text) and JetBrains Mono (timecodes, track labels). All fonts are bundled under the SIL OFL in `src/renderer/src/assets/fonts`; icons are from `lucide-react`.

## Layout
- `src/shared`: types, the pure command API (`commands.ts`), timeline maths, captions, FFmpeg export graph, agent tool defs
- `src/main`: Electron main (FFmpeg, transcription, render, MCP server, agents, settings, IPC)
- `src/preload`: the `window.api` bridge
- `src/renderer`: React UI (Zustand store, components, guides, plugins, collab client)
- `src/collab`: WebSocket room server and protocol
