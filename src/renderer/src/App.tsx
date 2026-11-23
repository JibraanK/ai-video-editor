import { useEffect, useState } from 'react'
import { clipsAt, projectDuration } from '@shared/timeline'
import { getState, useStore } from './store'
import { registerRpc } from './lib/rpc'
import { publishPresence } from './lib/collab'
import { importDialog, saveProject } from './lib/actions'
import { TopBar } from './components/TopBar'
import { MediaPool } from './components/MediaPool'
import { Preview } from './components/Preview'
import { Inspector } from './components/Inspector'
import { Timeline } from './components/Timeline'
import { Mixer } from './components/Mixer'
import { AgentPanel } from './components/AgentPanel'
import { ExportPage } from './components/ExportPage'
import { GuideOverlay } from './components/GuideOverlay'
import { SettingsDialog, ShareDialog, ShortcutsDialog } from './components/Dialogs'

type Dialog = 'settings' | 'share' | 'shortcuts' | null

function useShortcuts(toggleAsk: () => void, setDialog: (d: Dialog) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      const s = getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const fps = s.project.settings.fps
      const handled = () => e.preventDefault()
      if (mod && k === 'z') return handled(), e.shiftKey ? s.redo() : s.undo()
      if (mod && k === 'y') return handled(), s.redo()
      if (mod && k === 's') return handled(), void saveProject(e.shiftKey)
      if (mod && k === 'i') return handled(), void importDialog()
      if (mod && k === 'k') return handled(), toggleAsk()
      if (mod) return
      switch (e.key) {
        case ' ':
          handled()
          if (!s.playing && s.playhead >= projectDuration(s.project) - 0.01) s.setPlayhead(0)
          return s.setPlaying(!s.playing)
        case 'ArrowLeft':
          return handled(), s.setPlayhead(s.playhead - (e.shiftKey ? 1 : 1 / fps))
        case 'ArrowRight':
          return handled(), s.setPlayhead(s.playhead + (e.shiftKey ? 1 : 1 / fps))
        case 'Home':
          return s.setPlayhead(0)
        case 'End':
          return s.setPlayhead(projectDuration(s.project))
        case 'Delete':
        case 'Backspace':
          if (s.selection.length) void s.dispatch('delete_clips', { clipIds: s.selection, ripple: s.project.magnetic })
          return handled()
        case '?':
          return setDialog('shortcuts')
        case '+':
        case '=':
          return s.set({ zoom: Math.min(400, s.zoom * 1.25) })
        case '-':
          return s.set({ zoom: Math.max(5, s.zoom / 1.25) })
      }
      switch (k) {
        case 'v':
          return s.set({ tool: 'select' })
        case 'b':
          return s.set({ tool: 'razor' })
        case 'n':
          return void s.dispatch('set_magnetic', { enabled: !s.project.magnetic })
        case 'm':
          return void s.dispatch('add_marker', { time: s.playhead })
        case 'k':
          return s.setPlaying(false)
        case 'j':
          return s.setPlayhead(s.playhead - 5)
        case 'l':
          return s.setPlayhead(s.playhead + 5)
        case 's': {
          const ids = s.selection.length ? s.selection : clipsAt(s.project, s.playhead).map((c) => c.id)
          if (ids.length) void s.dispatch('split', { time: s.playhead, clipIds: ids }).catch((err) => s.toast(err.message, 'error'))
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleAsk, setDialog])
}

export function App() {
  const page = useStore((s) => s.page)
  const toasts = useStore((s) => s.toasts)
  const [ask, setAsk] = useState(true)
  const [dialog, setDialog] = useState<Dialog>(null)

  useEffect(() => registerRpc(), [])
  // Share playhead/page/selection with collaborators.
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.collab.status !== 'connected') return
        if (s.page !== prev.page) publishPresence({ page: s.page })
        if (s.selection !== prev.selection) publishPresence({ selection: s.selection })
        if (Math.abs(s.playhead - prev.playhead) > 1 / 60) publishPresence({ playhead: s.playhead })
      }),
    []
  )
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (getState().dirty && import.meta.env.PROD) e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  const toggleAsk = () => setAsk((a) => !a)
  useShortcuts(toggleAsk, setDialog)

  return (
    <div className="app">
      <TopBar onAsk={toggleAsk} onSettings={() => setDialog('settings')} onShare={() => setDialog('share')} onShortcuts={() => setDialog('shortcuts')} />
      {page === 'edit' ? (
        <div className={`workspace${ask ? ' with-agent' : ''}`}>
          <MediaPool />
          <div className="center">
            <Preview />
          </div>
          <Inspector />
          {ask && <AgentPanel onClose={() => setAsk(false)} />}
          <div className="bottom">
            <Timeline />
            <Mixer />
          </div>
        </div>
      ) : (
        <ExportPage />
      )}
      <GuideOverlay />
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
