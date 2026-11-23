import { AudioLines, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TEXT_PRESETS } from '@shared/presets'
import { formatTimecode } from '@shared/timeline'
import type { Template } from '@shared/types'
import { getState, useStore } from '../store'
import { appendToTimeline, importDialog, importPaths, runTool } from '../lib/actions'
import { useGuide } from '../lib/guide'
import { thumbUrl } from '../lib/media'
import { runPlugin, usePlugins } from '../lib/plugins'
import { AreaCursors, areaPointer } from './Cursors'

type Tab = 'media' | 'text' | 'templates' | 'plugins'

function MediaTab() {
  const media = useStore((s) => s.project.media)
  const [over, setOver] = useState(false)
  return (
    <div
      className={`pool-body${over ? ' drop' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void importPaths([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)))
      }}
    >
      {media.length === 0 ? (
        <div className="empty">
          <p>Drop video, audio or images here</p>
          <button className="btn primary" onClick={importDialog}>
            Import media
          </button>
        </div>
      ) : (
        <div className="media-grid" data-guide="pool.items">
          {media.map((m) => (
            <div
              key={m.id}
              className="media-item"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/x-cutline-media', m.id)}
              onDoubleClick={() => appendToTimeline(m.id)}
              title={`${m.name}\nDouble-click to append, drag to place`}
            >
              <div className="media-thumb" style={thumbUrl(m) ? { backgroundImage: `url("${thumbUrl(m)}")` } : undefined}>
                {m.kind === 'audio' && <AudioLines className="media-icon" size={22} strokeWidth={1.5} />}
                {m.kind !== 'image' && <span className="media-dur">{formatTimecode(m.duration).slice(3, 8)}</span>}
              </div>
              <div className="media-name">{m.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TextTab() {
  return (
    <div className="pool-body preset-list">
      {TEXT_PRESETS.map((p) => (
        <button
          key={p.id}
          className="preset"
          onClick={() => getState().dispatch('add_text', { text: p.text, start: getState().playhead, duration: p.duration, preset: p.id }).then((r: any) => r?.id && getState().select([r.id]))}
        >
          <span className={`preset-sample preset-${p.id}`}>{p.name}</span>
          <span className="muted">{p.duration}s · {p.animIn}</span>
        </button>
      ))}
    </div>
  )
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [refPath, setRefPath] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const reload = () => window.api.listTemplates().then(setTemplates)
  useEffect(() => void reload(), [])
  const apply = async (t: Template) => {
    const r: any = await runTool(`Applying ${t.name}…`, 'apply_template', { templateId: t.id })
    if (r) getState().toast(`Applied ${t.name}${r.autoCaptions ? ' — run Auto captions to fill the caption track' : ''}`)
  }
  return (
    <div className="pool-body">
      <div className="card" data-guide="pool.reference">
        <div className="card-title">Make a video like this</div>
        <p className="muted small">Upload a reference video. Cutline measures its pacing, format and captions and recuts your media in that style.</p>
        <div className="row">
          <button className="btn sm" onClick={async () => setRefPath(await window.api.openFileDialog([{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }]))}>
            {refPath ? refPath.split(/[\\/]/).pop() : 'Choose reference…'}
          </button>
          <input className="input sm" style={{ width: 70 }} placeholder="secs" value={target} onChange={(e) => setTarget(e.target.value)} title="Target duration (optional)" />
        </div>
        <div className="row">
          <button
            className="btn sm primary"
            disabled={!refPath}
            onClick={async () => {
              const r: any = await runTool('Analysing reference & building…', 'build_from_reference', { path: refPath, targetDuration: Number(target) || undefined })
              if (r) getState().toast(`Built ${r.shots} shots (${r.duration}s) in the reference style`)
            }}
          >
            Build rough cut
          </button>
          <button
            className="btn sm"
            disabled={!refPath}
            onClick={async () => {
              const r: any = await runTool('Analysing reference…', 'analyze_reference', { path: refPath })
              if (r) getState().toast(`${r.width}×${r.height}, ${r.shotCount} shots, avg ${r.averageShot}s, speech ${Math.round(r.speechRatio * 100)}%`)
            }}
          >
            Analyse only
          </button>
        </div>
      </div>
      <div className="row between">
        <div className="section-title">Templates</div>
        <button
          className="btn sm"
          data-guide="pool.save-template"
          onClick={async () => {
            const name = prompt('Template name')
            if (!name) return
            await runTool('Saving template…', 'save_template', { name })
            void reload()
          }}
        >
          Save current as template
        </button>
      </div>
      {templates.map((t) => (
        <div key={t.id} className="template">
          <div>
            <div>{t.name}</div>
            <div className="muted small">
              {t.settings.width}×{t.settings.height} · {t.description}
            </div>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => apply(t)}>
              Apply
            </button>
            {!t.builtin && (
              <button className="btn sm ghost" onClick={() => window.api.deleteTemplate(t.id).then(reload)}>
                <X size={14} strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function PluginsTab() {
  const plugins = usePlugins((s) => s.plugins)
  return (
    <div className="pool-body">
      {plugins.length === 0 && <p className="muted small pad">No plugins yet. Ask Cutline for a feature the editor doesn't have (e.g. “add a button that adds a 1s black gap between every clip”) and it builds one here.</p>}
      {plugins.map((p) => (
        <div key={p.id} className="template">
          <div>
            <div>{p.name}</div>
            <div className="muted small">{p.description}</div>
          </div>
          <div className="row">
            <button
              className="btn sm primary"
              onClick={() =>
                runPlugin(p.id).then(
                  () => getState().toast(`${p.name} done`),
                  (e) => getState().toast(e.message, 'error')
                )
              }
            >
              Run
            </button>
            <button className="btn sm ghost" onClick={() => confirm(`Delete ${p.name}?`) && usePlugins.getState().remove(p.id)}>
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function MediaPool() {
  const [tab, setTab] = useState<Tab>('media')
  const guideTarget = useGuide((g) => (g.active ? g.steps[g.index]?.target : null))
  useEffect(() => {
    if (guideTarget === 'pool.items') setTab('media')
  }, [guideTarget])
  return (
    <div className="panel pool" {...areaPointer('pool')}>
      <div className="tabs">
        {(['media', 'text', 'templates', 'plugins'] as Tab[]).map((t) => (
          <button key={t} data-guide={`pool.${t}`} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'media' && <MediaTab />}
      {tab === 'text' && <TextTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'plugins' && <PluginsTab />}
      <AreaCursors area="pool" />
    </div>
  )
}
