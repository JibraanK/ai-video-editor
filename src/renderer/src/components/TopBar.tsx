import { AudioLines, Captions, FilePlus2, FolderOpen, Library, Plus, Redo2, Save, Settings2, Share2, SlidersHorizontal, Sparkles, Undo2 } from 'lucide-react'
import { formatTimecode, projectDuration } from '@shared/timeline'
import { getState, useStore, type Side } from '../store'
import { autoCaptions, importDialog, newProject, openProject, saveProject } from '../lib/actions'
import { HelpMenu } from './Onboarding'

const I = { size: 14, strokeWidth: 1.75 }

function SideToggle({ side, guide, title, children }: { side: Exclude<Side, null>; guide: string; title: string; children: React.ReactNode }) {
  const on = useStore((s) => s.side === side)
  return (
    <button className={`icon-btn${on ? ' on' : ''}`} data-guide={guide} title={title} aria-pressed={on} onClick={() => getState().set({ side: on ? null : side })}>
      {children}
    </button>
  )
}

export function TopBar({ onSettings, onShare, onShortcuts }: { onSettings: () => void; onShare: () => void; onShortcuts: () => void }) {
  const page = useStore((s) => s.page)
  const pool = useStore((s) => s.pool)
  const ask = useStore((s) => s.side === 'ask')
  const name = useStore((s) => s.project.name)
  const fps = useStore((s) => s.project.settings.fps)
  const duration = useStore((s) => projectDuration(s.project))
  const dirty = useStore((s) => s.dirty)
  const busy = useStore((s) => s.busy)
  const collab = useStore((s) => s.collab)
  const canUndo = useStore((s) => s.past.length > 0 || !!s.remote)
  const canRedo = useStore((s) => s.future.length > 0 || !!s.remote)
  const people = collab.status === 'connected' ? [collab.me!, ...Object.values(collab.peers).map((p) => p.user)] : []
  return (
    <header className="topbar">
      <span className="brandmark" aria-label="Cutline">
        cutline
      </span>
      <div className="seg pages">
        <button data-guide="page.edit" className={page === 'edit' ? 'on' : ''} onClick={() => getState().set({ page: 'edit' })}>
          Edit
        </button>
        <button data-guide="page.export" className={page === 'export' ? 'on' : ''} onClick={() => getState().set({ page: 'export' })}>
          Export
        </button>
      </div>
      <div className="project-id" title={name}>
        <span className="project-name">{name}</span>
        {dirty && <span className="dirty" title="Unsaved changes" />}
        <span className="project-dur">{formatTimecode(duration, fps).slice(3, 8)}</span>
      </div>
      {people.length > 0 && (
        <div className="avatars">
          {people.map((u) => (
            <span key={u.id} className="avatar" style={{ borderColor: u.color, color: u.color }} title={u.name}>
              {u.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
      )}
      <nav className="actions">
        <button className="pill" data-guide="topbar.import" onClick={importDialog}>
          <Plus {...I} /> Footage
        </button>
        <button className={`pill${pool ? ' on' : ''}`} data-guide="topbar.pool" aria-pressed={pool} onClick={() => getState().set({ pool: !pool })}>
          <Library {...I} /> Library
        </button>
        <button className="pill" data-guide="topbar.captions" onClick={autoCaptions} disabled={!!busy}>
          <Captions {...I} /> Subtitles
        </button>
        <button className={`pill${collab.status === 'connected' ? ' live' : ''}`} data-guide="topbar.share" onClick={onShare}>
          <Share2 {...I} /> {collab.status === 'connected' ? 'Live' : 'Share'}
        </button>
        <button className={`pill accent${ask ? ' on' : ''}`} data-guide="topbar.ask" title="Ask Cutline (Ctrl+K)" aria-pressed={ask} onClick={() => getState().set({ side: ask ? null : 'ask' })}>
          <Sparkles {...I} /> Ask
        </button>
      </nav>
      {busy && (
        <span className="busy" role="status">
          {busy}
        </span>
      )}
      <div className="spacer" />
      <div className="icon-group">
        <SideToggle side="inspector" guide="topbar.inspector" title="Inspector">
          <SlidersHorizontal {...I} />
        </SideToggle>
        <SideToggle side="mixer" guide="topbar.mixer" title="Mixer">
          <AudioLines {...I} />
        </SideToggle>
      </div>
      <div className="icon-group">
        <button className="icon-btn" title="New project" onClick={newProject}>
          <FilePlus2 {...I} />
        </button>
        <button className="icon-btn" title="Open project" onClick={openProject}>
          <FolderOpen {...I} />
        </button>
        <button className="icon-btn" title="Save (Ctrl+S)" onClick={() => saveProject()}>
          <Save {...I} />
        </button>
      </div>
      <div className="icon-group" data-guide="topbar.undo">
        <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => getState().undo()}>
          <Undo2 {...I} />
        </button>
        <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => getState().redo()}>
          <Redo2 {...I} />
        </button>
        <HelpMenu onShortcuts={onShortcuts} />
        <button className="icon-btn" data-guide="topbar.settings" title="Settings" onClick={onSettings}>
          <Settings2 {...I} />
        </button>
      </div>
    </header>
  )
}

