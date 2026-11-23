import { useEffect, useState } from 'react'
import { toSRT, toVTT } from '@shared/captions'
import { EXPORT_PRESETS } from '@shared/presets'
import { formatTimecode, projectDuration } from '@shared/timeline'
import type { ExportOptions } from '@shared/types'
import { getState, useStore } from '../store'
import { Preview } from './Preview'

export function ExportPage() {
  const project = useStore((s) => s.project)
  const [presetId, setPresetId] = useState(() => (project.settings.height > project.settings.width ? 'vertical' : 'yt-1080'))
  const [burn, setBurn] = useState(true)
  const [range, setRange] = useState<'all' | 'custom'>('all')
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(0)
  const [progress, setProgress] = useState<{ progress: number; status: string; outputPath?: string; error?: string } | null>(null)
  const preset = EXPORT_PRESETS.find((p) => p.id === presetId)!
  const duration = projectDuration(project)
  const captions = project.clips.filter((c) => project.tracks.find((t) => t.id === c.trackId)?.kind === 'caption').sort((a, b) => a.start - b.start)

  useEffect(() => window.api.onExportProgress(setProgress), [])
  useEffect(() => setTo(duration), [duration])

  const start = async () => {
    const ext = preset.options.container
    const path = await window.api.savePathDialog(`${project.name.replace(/[^\w\- ]+/g, '') || 'export'}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }])
    if (!path) return
    const { width, height } = project.settings
    const landscapePreset = preset.options.width >= preset.options.height
    const fit = landscapePreset !== width >= height && preset.options.width > 0
    const options: ExportOptions = {
      ...preset.options,
      ...(fit ? { width: preset.options.height, height: preset.options.width } : {}),
      outputPath: path,
      burnCaptions: burn,
      range: range === 'custom' ? { start: from, end: to } : undefined
    }
    setProgress({ progress: 0, status: 'running' })
    try {
      await window.api.startExport(getState().project, options)
    } catch (e) {
      setProgress({ progress: 0, status: 'error', error: (e as Error).message })
    }
  }

  const saveCaptions = async (kind: 'srt' | 'vtt') => {
    const path = await window.api.savePathDialog(`${project.name}.${kind}`, [{ name: kind.toUpperCase(), extensions: [kind] }])
    if (!path) return
    const segs = captions.map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text ?? '' }))
    await window.api.writeFile(path, kind === 'srt' ? toSRT(segs) : toVTT(segs))
    getState().toast(`Saved ${path}`)
  }

  return (
    <div className="export-page">
      <div className="export-preview">
        <Preview />
      </div>
      <div className="panel export-settings">
        <div className="panel-title">Export</div>
        <div className="inspector-body">
          <label className="field" data-guide="export.preset">
            <span>Preset</span>
            <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {EXPORT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="muted small">
            {preset.options.videoCodec !== 'none' ? `${preset.options.videoCodec} · ${preset.options.width}×${preset.options.height} · ${preset.options.fps}fps · ` : ''}
            {preset.options.audioCodec} {preset.options.audioBitrate !== '0' ? preset.options.audioBitrate : ''}
          </div>
          <label className="field">
            <span>Range</span>
            <select className="input sm" value={range} onChange={(e) => setRange(e.target.value as 'all' | 'custom')}>
              <option value="all">Whole timeline ({formatTimecode(duration, project.settings.fps)})</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {range === 'custom' && (
            <div className="grid2">
              <label className="field">
                <span>From</span>
                <input className="input sm" type="number" step={0.1} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
              </label>
              <label className="field">
                <span>To</span>
                <input className="input sm" type="number" step={0.1} value={to} onChange={(e) => setTo(Number(e.target.value))} />
              </label>
            </div>
          )}
          <label className="field">
            <span>Burn in captions</span>
            <input type="checkbox" checked={burn} disabled={!captions.length} onChange={(e) => setBurn(e.target.checked)} />
          </label>
          <button className="btn primary big" data-guide="export.start" disabled={!duration || progress?.status === 'running'} onClick={start}>
            Export
          </button>
          {progress && (
            <div className={`progress ${progress.status}`}>
              <div className="bar">
                <div style={{ width: `${Math.round(progress.progress * 100)}%` }} />
              </div>
              <div className="row between small">
                <span>{progress.status === 'running' ? `Rendering… ${Math.round(progress.progress * 100)}%` : progress.status === 'done' ? 'Done' : progress.status === 'error' ? progress.error : progress.status}</span>
                {progress.status === 'running' && (
                  <button className="btn sm" onClick={() => window.api.cancelExport()}>
                    Cancel
                  </button>
                )}
                {progress.status === 'done' && progress.outputPath && (
                  <button className="btn sm" onClick={() => window.api.showItem(progress.outputPath!)}>
                    Show file
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="group" data-guide="export.captions">
            <div className="group-title">Captions ({captions.length})</div>
            <div className="row">
              <button className="btn sm" disabled={!captions.length} onClick={() => saveCaptions('srt')}>
                Save SRT
              </button>
              <button className="btn sm" disabled={!captions.length} onClick={() => saveCaptions('vtt')}>
                Save VTT
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
