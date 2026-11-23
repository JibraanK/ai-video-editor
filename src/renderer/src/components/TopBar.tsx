import { getState, useStore } from '../store'
import { autoCaptions, autoCut, importDialog, newProject, openProject, saveProject, suggestCuts } from '../lib/actions'

export function TopBar({ onAsk, onSettings, onShare, onShortcuts }: { onAsk: () => void; onSettings: () => void; onShare: () => void; onShortcuts: () => void }) {
  const page = useStore((s) => s.page)
  const magnetic = useStore((s) => s.project.magnetic)
  const tool = useStore((s) => s.tool)
  const name = useStore((s) => s.project.name)
  const dirty = useStore((s) => s.dirty)
  const busy = useStore((s) => s.busy)
  const collab = useStore((s) => s.collab)
  const canUndo = useStore((s) => s.past.length > 0 || !!s.remote)
  const canRedo = useStore((s) => s.future.length > 0 || !!s.remote)
  const people = collab.status === 'connected' ? [collab.me!, ...Object.values(collab.peers).map((p) => p.user)] : []
  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">◢</span> Cutline
      </div>
      <div className="menu">
        <button className="btn sm ghost" onClick={newProject}>
          New
        </button>
        <button className="btn sm ghost" onClick={openProject}>
          Open
        </button>
        <button className="btn sm ghost" onClick={() => saveProject()}>
          Save
        </button>
        <button className="btn sm" data-guide="topbar.import" onClick={importDialog}>
          Import
        </button>
      </div>
      <div className="divider" />
      <div className="row" data-guide="topbar.undo">
        <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => getState().undo()}>
          ↶
        </button>
        <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => getState().redo()}>
          ↷
        </button>
      </div>
      <div className="seg">
        <button data-guide="topbar.tool-select" className={tool === 'select' ? 'on' : ''} title="Select (V)" onClick={() => getState().set({ tool: 'select' })}>
          ⬉
        </button>
        <button data-guide="topbar.tool-razor" className={tool === 'razor' ? 'on' : ''} title="Razor (B)" onClick={() => getState().set({ tool: 'razor' })}>
          ✂
        </button>
      </div>
      <button className={`btn sm toggle${magnetic ? ' on' : ''}`} data-guide="topbar.magnetic" title="Magnetic timeline (N)" onClick={() => getState().dispatch('set_magnetic', { enabled: !magnetic })}>
        🧲 Magnetic
      </button>
      <div className="divider" />
      <button className="btn sm" data-guide="topbar.captions" onClick={autoCaptions} disabled={!!busy}>
        CC Captions
      </button>
      <button className="btn sm" data-guide="topbar.suggest" onClick={suggestCuts} disabled={!!busy}>
        Suggest cuts
      </button>
      <button className="btn sm" data-guide="topbar.autocut" onClick={autoCut} disabled={!!busy}>
        Auto cut
      </button>
      <div className="spacer title">
        {name}
        {dirty ? ' •' : ''}
        {busy && <span className="busy">{busy}</span>}
      </div>
      <div className="seg pages">
        <button data-guide="page.edit" className={page === 'edit' ? 'on' : ''} onClick={() => getState().set({ page: 'edit' })}>
          Edit
        </button>
        <button data-guide="page.export" className={page === 'export' ? 'on' : ''} onClick={() => getState().set({ page: 'export' })}>
          Export
        </button>
      </div>
      <div className="avatars">
        {people.map((u) => (
          <span key={u.id} className="avatar" style={{ background: u.color }} title={u.name}>
            {u.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>
      <button className={`btn sm${collab.status === 'connected' ? ' live' : ''}`} data-guide="topbar.share" onClick={onShare}>
        {collab.status === 'connected' ? '● Live' : 'Share'}
      </button>
      <button className="btn sm primary" data-guide="topbar.ask" onClick={onAsk} title="Ask Cutline (Ctrl+K)">
        ✦ Ask
      </button>
      <button className="icon-btn" title="Shortcuts (?)" onClick={onShortcuts}>
        ?
      </button>
      <button className="icon-btn" data-guide="topbar.settings" title="Settings" onClick={onSettings}>
        ⚙
      </button>
    </div>
  )
}
