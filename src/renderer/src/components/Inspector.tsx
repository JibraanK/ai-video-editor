import { useEffect, useState } from 'react'
import { BASE_TEXT_STYLE, TEXT_PRESETS } from '@shared/presets'
import { formatTimecode } from '@shared/timeline'
import type { Clip, TextAnimation, TextStyle } from '@shared/types'
import { getState, useStore } from '../store'

const ANIMS: TextAnimation[] = ['none', 'fade', 'slide-up', 'pop', 'typewriter']
const FONTS = ['Inter, system-ui, sans-serif', 'Arial, sans-serif', 'Georgia, serif', '"Courier New", monospace', 'Impact, sans-serif', '"Trebuchet MS", sans-serif']
const RESOLUTIONS = [
  { label: '1920×1080 (16:9)', w: 1920, h: 1080 },
  { label: '3840×2160 (4K)', w: 3840, h: 2160 },
  { label: '1280×720', w: 1280, h: 720 },
  { label: '1080×1920 (9:16)', w: 1080, h: 1920 },
  { label: '1080×1080 (1:1)', w: 1080, h: 1080 },
  { label: '1080×1350 (4:5)', w: 1080, h: 1350 }
]

function Num({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(Math.round(value * 1000) / 1000))
  }, [value])
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input sm"
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => Number.isFinite(Number(draft)) && Number(draft) !== value && onChange(Number(draft))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{fmt ? fmt(value) : value}</span>
    </label>
  )
}

function ClipInspector({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project)
  const track = project.tracks.find((t) => t.id === clip.trackId)
  const media = project.media.find((m) => m.id === clip.mediaId)
  const upd = (patch: Record<string, unknown>) => void getState().dispatch('update_clip', { clipId: clip.id, ...patch }).catch((e) => getState().toast(e.message, 'error'))
  const style: TextStyle = { ...BASE_TEXT_STYLE, ...clip.textStyle }
  const setStyle = (patch: Partial<TextStyle>) => (track?.kind === 'caption' ? void getState().dispatch('style_captions', { style: { ...style, ...patch } }) : upd({ textStyle: { ...style, ...patch } }))
  const isText = clip.text !== undefined && !clip.mediaId
  const visual = track?.kind !== 'audio'
  const audible = media?.hasAudio && (track?.kind === 'audio' || track?.kind === 'video')
  return (
    <div className="inspector-body">
      <div className="section-title">{isText ? (track?.kind === 'caption' ? 'Caption' : 'Text') : (media?.name ?? 'Clip')}</div>
      <div className="muted small">
        {track?.name} · {formatTimecode(clip.start, project.settings.fps)} · {clip.duration.toFixed(2)}s
      </div>
      <div className="grid2">
        <Num label="Start" value={clip.start} step={0.1} onChange={(v) => getState().dispatch('move_clip', { clipId: clip.id, start: v })} />
        <Num label="Duration" value={clip.duration} step={0.1} onChange={(v) => getState().dispatch('trim_clip', { clipId: clip.id, end: clip.start + v })} />
      </div>
      {isText && (
        <div className="group" data-guide="inspector.text">
          <textarea className="input" rows={3} value={clip.text} onChange={(e) => upd({ text: e.target.value })} />
          {track?.kind !== 'caption' && (
            <label className="field">
              <span>Preset</span>
              <select
                className="input sm"
                value=""
                onChange={(e) => {
                  const p = TEXT_PRESETS.find((x) => x.id === e.target.value)
                  if (p) upd({ textStyle: { ...BASE_TEXT_STYLE, ...p.style }, animIn: p.animIn, animOut: p.animOut })
                }}
              >
                <option value="">Apply preset…</option>
                {TEXT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Font</span>
            <select className="input sm" value={style.fontFamily} onChange={(e) => setStyle({ fontFamily: e.target.value })}>
              {[...new Set([style.fontFamily, ...FONTS])].map((f) => (
                <option key={f} value={f}>
                  {f.split(',')[0].replace(/"/g, '')}
                </option>
              ))}
            </select>
          </label>
          <div className="grid2">
            <Num label="Size" value={style.fontSize} onChange={(v) => setStyle({ fontSize: v })} />
            <Num label="Weight" value={style.fontWeight} step={100} min={100} max={900} onChange={(v) => setStyle({ fontWeight: v })} />
          </div>
          <div className="grid2">
            <label className="field">
              <span>Color</span>
              <input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} />
            </label>
            <label className="field">
              <span>Stroke</span>
              <input type="color" value={style.strokeColor} onChange={(e) => setStyle({ strokeColor: e.target.value })} />
            </label>
          </div>
          <Slider label="Stroke width" min={0} max={20} step={1} value={style.strokeWidth} onChange={(v) => setStyle({ strokeWidth: v })} />
          <div className="grid2">
            <label className="field">
              <span>Box</span>
              <input type="checkbox" checked={!!style.background} onChange={(e) => setStyle({ background: e.target.checked ? 'rgba(0,0,0,0.6)' : null })} />
            </label>
            <label className="field">
              <span>Shadow</span>
              <input type="checkbox" checked={style.shadow} onChange={(e) => setStyle({ shadow: e.target.checked })} />
            </label>
            <label className="field">
              <span>CAPS</span>
              <input type="checkbox" checked={style.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked })} />
            </label>
            <label className="field">
              <span>Align</span>
              <select className="input sm" value={style.align} onChange={(e) => setStyle({ align: e.target.value as TextStyle['align'] })}>
                <option>left</option>
                <option>center</option>
                <option>right</option>
              </select>
            </label>
          </div>
          <Slider label="X" min={0} max={1} step={0.01} value={style.x} onChange={(v) => setStyle({ x: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Y" min={0} max={1} step={0.01} value={style.y} onChange={(v) => setStyle({ y: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <div className="grid2">
            <label className="field">
              <span>In</span>
              <select className="input sm" value={clip.animIn ?? 'none'} onChange={(e) => (track?.kind === 'caption' ? getState().dispatch('style_captions', { style, animIn: e.target.value }) : upd({ animIn: e.target.value }))}>
                {ANIMS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Out</span>
              <select className="input sm" value={clip.animOut ?? 'none'} onChange={(e) => upd({ animOut: e.target.value })}>
                {ANIMS.filter((a) => a !== 'typewriter').map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
      {visual && !isText && (
        <div className="group" data-guide="inspector.transform">
          <div className="group-title">Transform</div>
          <Slider label="Scale" min={0.1} max={3} step={0.01} value={clip.transform.scale} onChange={(v) => upd({ transform: { ...clip.transform, scale: v } })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <div className="grid2">
            <Num label="X" value={clip.transform.x} onChange={(v) => upd({ transform: { ...clip.transform, x: v } })} />
            <Num label="Y" value={clip.transform.y} onChange={(v) => upd({ transform: { ...clip.transform, y: v } })} />
          </div>
          <Slider label="Opacity" min={0} max={1} step={0.01} value={clip.transform.opacity} onChange={(v) => upd({ transform: { ...clip.transform, opacity: v } })} fmt={(v) => `${Math.round(v * 100)}%`} />
        </div>
      )}
      <div className="group" data-guide="inspector.audio">
        <div className="group-title">{audible ? 'Audio & fades' : 'Fades'}</div>
        {audible && <Slider label="Volume" min={0} max={2} step={0.01} value={clip.volume} onChange={(v) => upd({ volume: v })} fmt={(v) => `${v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-∞'} dB`} />}
        <div className="grid2">
          <Num label="Fade in" value={clip.fadeIn} step={0.1} min={0} onChange={(v) => upd({ fadeIn: v })} />
          <Num label="Fade out" value={clip.fadeOut} step={0.1} min={0} onChange={(v) => upd({ fadeOut: v })} />
        </div>
      </div>
      <div className="row">
        <button className="btn sm" onClick={() => getState().dispatch('split', { time: getState().playhead, clipIds: [clip.id] })}>
          Split at playhead
        </button>
        <button className="btn sm danger" onClick={() => getState().dispatch('delete_clips', { clipIds: [clip.id], ripple: getState().project.magnetic })}>
          Delete
        </button>
      </div>
    </div>
  )
}

function ProjectInspector() {
  const project = useStore((s) => s.project)
  const st = project.settings
  const set = (patch: Record<string, unknown>) => void getState().dispatch('set_project_settings', patch)
  const res = RESOLUTIONS.find((r) => r.w === st.width && r.h === st.height)
  return (
    <div className="inspector-body" data-guide="inspector.project">
      <div className="section-title">Project</div>
      <label className="field">
        <span>Name</span>
        <input
          className="input sm"
          value={project.name}
          onChange={(e) => {
            const p = structuredClone(getState().project)
            p.name = e.target.value
            getState().setProject(p, 'Rename')
          }}
        />
      </label>
      <label className="field">
        <span>Resolution</span>
        <select
          className="input sm"
          value={res ? res.label : 'custom'}
          onChange={(e) => {
            const r = RESOLUTIONS.find((x) => x.label === e.target.value)
            if (r) set({ width: r.w, height: r.h })
          }}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.label}>{r.label}</option>
          ))}
          {!res && <option value="custom">{`${st.width}×${st.height}`}</option>}
        </select>
      </label>
      <label className="field">
        <span>Frame rate</span>
        <select className="input sm" value={st.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
          {[23.976, 24, 25, 29.97, 30, 50, 60].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Background</span>
        <input type="color" value={st.background} onChange={(e) => set({ background: e.target.value })} />
      </label>
      <label className="field">
        <span>Magnetic</span>
        <input type="checkbox" checked={project.magnetic} onChange={(e) => getState().dispatch('set_magnetic', { enabled: e.target.checked })} />
      </label>
      <p className="muted small">Select a clip to edit its properties. Tip: press ? for shortcuts, or ask Cutline “how do I…”.</p>
    </div>
  )
}

export function Inspector() {
  const clip = useStore((s) => (s.selection.length === 1 ? s.project.clips.find((c) => c.id === s.selection[0]) : undefined))
  const count = useStore((s) => s.selection.length)
  return (
    <div className="panel inspector" data-guide="inspector">
      <div className="panel-title">Inspector</div>
      {clip ? <ClipInspector clip={clip} /> : count > 1 ? <div className="inspector-body muted">{count} clips selected</div> : <ProjectInspector />}
    </div>
  )
}
