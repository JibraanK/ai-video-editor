import { useEffect, useMemo, useRef, useState } from 'react'
import { clipEnd, clipsAt, formatTimecode, projectDuration, snap, snapPoints } from '@shared/timeline'
import type { Clip, MediaItem, Track } from '@shared/types'
import { getState, useStore } from '../store'
import { publishPresence } from '../lib/collab'
import { thumbUrl } from '../lib/media'
import { autoCut, importPaths, suggestCuts } from '../lib/actions'
import { CursorArrow } from './Cursors'
import { Bookmark, Eye, EyeOff, Lock, LockOpen, Magnet, Maximize2, Minus, MousePointer2, Plus, Scissors, Slice, SplitSquareHorizontal, Trash2, WandSparkles, X, ZoomIn, ZoomOut } from 'lucide-react'

const I = { size: 13, strokeWidth: 1.75 }
const B = { size: 11, strokeWidth: 2 }

const HEADER_W = 136
const RULER_H = 24
export const trackHeight = (t: Track) => (t.kind === 'video' ? 46 : t.kind === 'audio' ? 38 : 26)

type Drag =
  | { kind: 'move'; ids: string[]; anchor: Clip; startX: number; startY: number; dt: number; trackId: string }
  | { kind: 'trim-l' | 'trim-r'; clip: Clip; startX: number; dt: number }
  | { kind: 'scrub' }

function Waveform({ clip, media, width, height }: { clip: Clip; media: MediaItem; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wf = useStore((s) => s.waveforms[media.id])
  const isGuest = useStore((s) => s.collab.status === 'connected' && !s.collab.isHost)
  useEffect(() => {
    if (wf || isGuest || !media.hasAudio) return
    useStore.setState((s) => ({ waveforms: { ...s.waveforms, [media.id]: { peaks: [], peaksPerSecond: 1 } } }))
    window.api.waveform(media.path).then((w) => useStore.setState((s) => ({ waveforms: { ...s.waveforms, [media.id]: w } })), () => {})
  }, [media.id, wf, isGuest, media.hasAudio, media.path])
  useEffect(() => {
    const c = ref.current
    if (!c || !wf?.peaks.length) return
    const w = Math.max(1, Math.min(4000, Math.floor(width)))
    c.width = w
    c.height = height
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, w, height)
    ctx.fillStyle = 'rgba(184, 206, 192, 0.72)'
    for (let x = 0; x < w; x++) {
      const t = clip.in + (x / w) * clip.duration
      const v = wf.peaks[Math.floor(t * wf.peaksPerSecond)] ?? 0
      const h = Math.max(1, v * height * 0.95)
      ctx.fillRect(x, (height - h) / 2, 1, h)
    }
  }, [wf, width, height, clip.in, clip.duration])
  return <canvas ref={ref} className="waveform" style={{ width, height }} />
}

export function Timeline() {
  const project = useStore((s) => s.project)
  const zoom = useStore((s) => s.zoom)
  const playhead = useStore((s) => s.playhead)
  const selection = useStore((s) => s.selection)
  const tool = useStore((s) => s.tool)
  const busy = useStore((s) => s.busy)
  const peers = useStore((s) => s.collab.peers)
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropHint, setDropHint] = useState<{ trackId: string; time: number } | null>(null)

  const duration = projectDuration(project)
  const width = Math.max(2000, (duration + 30) * zoom)
  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media])
  const rows = useMemo(() => {
    let y = 0
    return project.tracks.map((t) => {
      const r = { track: t, y, h: trackHeight(t) }
      y += r.h
      return r
    })
  }, [project.tracks])
  const totalH = rows.reduce((s, r) => s + r.h, 0)

  const timeAt = (clientX: number) => {
    const el = scroller.current!
    return Math.max(0, (clientX - el.getBoundingClientRect().left - HEADER_W + el.scrollLeft) / zoom)
  }
  const rowAt = (clientY: number) => {
    const el = scroller.current!
    const y = clientY - el.getBoundingClientRect().top - RULER_H + el.scrollTop
    return rows.find((r) => y >= r.y && y < r.y + r.h) ?? null
  }
  const snapT = (t: number, exclude: string[]) => snap(t, snapPoints(getState().project, new Set(exclude), getState().playhead), 8 / zoom)

  // Auto-scroll to keep the playhead visible during playback.
  useEffect(() => {
    const el = scroller.current
    if (!el || !getState().playing) return
    const x = playhead * zoom
    if (x > el.scrollLeft + el.clientWidth - HEADER_W - 40) el.scrollLeft = x - 80
  }, [playhead, zoom])

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      if (drag.kind === 'scrub') return getState().setPlayhead(timeAt(e.clientX))
      const raw = (e.clientX - drag.startX) / zoom
      if (drag.kind === 'move') {
        const start = snapT(Math.max(0, drag.anchor.start + raw), drag.ids)
        const endSnap = snapT(start + drag.anchor.duration, drag.ids) - drag.anchor.duration
        const s = Math.abs(endSnap - start) > 1e-6 && Math.abs(endSnap - (drag.anchor.start + raw)) < Math.abs(start - (drag.anchor.start + raw)) ? endSnap : start
        const row = rowAt(e.clientY)
        const track = row && row.track.kind === getState().project.tracks.find((t) => t.id === drag.anchor.trackId)?.kind ? row.track.id : drag.trackId
        setDrag({ ...drag, dt: s - drag.anchor.start, trackId: drag.ids.length === 1 ? track : drag.anchor.trackId })
      } else {
        const edge = drag.kind === 'trim-l' ? drag.clip.start + raw : clipEnd(drag.clip) + raw
        setDrag({ ...drag, dt: snapT(edge, [drag.clip.id]) - (drag.kind === 'trim-l' ? drag.clip.start : clipEnd(drag.clip)) })
      }
    }
    const up = async () => {
      const d = drag
      setDrag(null)
      const s = getState()
      try {
        if (d.kind === 'move' && (Math.abs(d.dt) > 1e-4 || d.trackId !== d.anchor.trackId)) {
          const clips = d.ids.map((id) => s.project.clips.find((c) => c.id === id)!).sort((a, b) => (d.dt > 0 ? b.start - a.start : a.start - b.start))
          for (const c of clips) await s.dispatch('move_clip', { clipId: c.id, start: Math.max(0, c.start + d.dt), trackId: d.ids.length === 1 ? d.trackId : undefined })
        } else if (d.kind === 'trim-l' && Math.abs(d.dt) > 1e-4) await s.dispatch('trim_clip', { clipId: d.clip.id, start: d.clip.start + d.dt })
        else if (d.kind === 'trim-r' && Math.abs(d.dt) > 1e-4) await s.dispatch('trim_clip', { clipId: d.clip.id, end: clipEnd(d.clip) + d.dt })
      } catch (e) {
        s.toast((e as Error).message, 'error')
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => window.removeEventListener('pointermove', move)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, zoom])

  const onClipDown = (e: React.PointerEvent, c: Clip, part: 'body' | 'l' | 'r') => {
    e.stopPropagation()
    const s = getState()
    const track = project.tracks.find((t) => t.id === c.trackId)
    if (tool === 'razor') {
      void s.dispatch('split', { time: snapT(timeAt(e.clientX), []), clipIds: [c.id] }).catch((err) => s.toast(err.message, 'error'))
      return
    }
    const sel = e.shiftKey || e.metaKey || e.ctrlKey ? (selection.includes(c.id) ? selection.filter((x) => x !== c.id) : [...selection, c.id]) : selection.includes(c.id) ? selection : [c.id]
    s.select(sel)
    publishPresence({ selection: sel })
    if (track?.locked) return
    if (part === 'body') setDrag({ kind: 'move', ids: sel.includes(c.id) ? sel : [c.id], anchor: c, startX: e.clientX, startY: e.clientY, dt: 0, trackId: c.trackId })
    else setDrag({ kind: part === 'l' ? 'trim-l' : 'trim-r', clip: c, startX: e.clientX, dt: 0 })
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropHint(null)
    const s = getState()
    const row = rowAt(e.clientY)
    const time = snapT(timeAt(e.clientX), [])
    try {
      const mediaId = e.dataTransfer.getData('application/x-cutline-media')
      const ids = mediaId ? [mediaId] : (await importPaths([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)))).map((m) => m.id)
      let t = time
      for (const id of ids) {
        const m = getState().project.media.find((x) => x.id === id)
        if (!m) continue
        const ok = row && (row.track.kind === 'video' ? m.kind !== 'audio' : row.track.kind === 'audio' ? m.hasAudio : false)
        await s.dispatch('add_clip', { mediaId: id, trackId: ok ? row!.track.id : undefined, start: t, mode: 'auto' })
        t += m.kind === 'image' ? 5 : m.duration
      }
    } catch (err) {
      s.toast((err as Error).message, 'error')
    }
  }

  const splitAtPlayhead = () => {
    const s = getState()
    const ids = s.selection.length ? s.selection : clipsAt(s.project, s.playhead).map((c) => c.id)
    if (ids.length) void s.dispatch('split', { time: s.playhead, clipIds: ids }).catch((err) => s.toast(err.message, 'error'))
  }
  const nudgeGain = (db: number) => {
    const s = getState()
    const f = Math.pow(10, db / 20)
    for (const id of s.selection) {
      const c = s.project.clips.find((x) => x.id === id)
      if (c && c.mediaId) void s.dispatch('update_clip', { clipId: id, volume: Math.min(4, Math.max(0, c.volume * f)) }).catch((err) => s.toast(err.message, 'error'))
    }
  }
  const fit = () => {
    const el = scroller.current
    if (!el) return
    getState().set({ zoom: Math.min(400, Math.max(5, (el.clientWidth - HEADER_W - 48) / Math.max(1, duration))) })
    el.scrollLeft = 0
  }

  const update = (trackId: string, patch: Partial<Track>) => void getState().dispatch('update_track', { trackId, ...patch })
  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * zoom >= 70) ?? 600
  const fps = project.settings.fps
  const suggestions = project.suggestions

  return (
    <div className="timeline" data-guide="timeline">
      <div className="timeline-toolbar">
        <div className="pill-row">
          <button className={`pill${project.magnetic ? ' on' : ''}`} data-guide="topbar.magnetic" title="Magnetic timeline (N)" aria-pressed={project.magnetic} onClick={() => getState().dispatch('set_magnetic', { enabled: !project.magnetic })}>
            <Magnet {...I} /> Magnetic
          </button>
          <button className={`pill${tool === 'select' ? ' on' : ''}`} data-guide="topbar.tool-select" title="Select (V)" aria-pressed={tool === 'select'} onClick={() => getState().set({ tool: 'select' })}>
            <MousePointer2 {...I} /> Select
          </button>
          <button className={`pill${tool === 'razor' ? ' on' : ''}`} data-guide="topbar.tool-razor" title="Blade (B)" aria-pressed={tool === 'razor'} onClick={() => getState().set({ tool: 'razor' })}>
            <Slice {...I} /> Blade
          </button>
        </div>
        <div className="pill-row">
          <button className="pill" data-guide="timeline.split" title="Split at playhead (S)" onClick={splitAtPlayhead}>
            <SplitSquareHorizontal {...I} /> Split
          </button>
          <button className="pill" data-guide="timeline.delete" title="Delete (Del)" disabled={!selection.length} onClick={() => getState().dispatch('delete_clips', { clipIds: selection, ripple: project.magnetic })}>
            <Trash2 {...I} /> Delete
          </button>
          <button className="pill" title="Add marker at playhead (M)" onClick={() => getState().dispatch('add_marker', { time: playhead })}>
            <Bookmark {...I} /> Marker
          </button>
        </div>
        <div className="pill-row" data-guide="timeline.gain">
          <button className="pill" title="Selected clips −1 dB" disabled={!selection.length} onClick={() => nudgeGain(-1)}>
            <Minus {...I} /> dB
          </button>
          <button className="pill" title="Selected clips +1 dB" disabled={!selection.length} onClick={() => nudgeGain(1)}>
            <Plus {...I} /> dB
          </button>
        </div>
        <div className="pill-row">
          <button className="pill" data-guide="topbar.suggest" onClick={suggestCuts} disabled={!!busy}>
            <WandSparkles {...I} /> Suggest cuts
          </button>
          <button className="pill" data-guide="topbar.autocut" onClick={autoCut} disabled={!!busy}>
            <Scissors {...I} /> Auto cut
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="suggest-bar" data-guide="timeline.suggestions">
            <span>
              {suggestions.length} suggested cut{suggestions.length > 1 ? 's' : ''} · {suggestions.reduce((s, x) => s + (x.end - x.start), 0).toFixed(1)}s
            </span>
            <button className="pill accent on" onClick={() => getState().dispatch('apply_suggestions', {})}>
              Apply all
            </button>
            <button className="pill" onClick={() => getState().dispatch('clear_suggestions', {})}>
              Dismiss
            </button>
          </div>
        )}
        <div className="spacer" />
        <div className="pill-row" data-guide="timeline.zoom">
          <button className="pill icon" title="Zoom out (−)" aria-label="Zoom out" onClick={() => getState().set({ zoom: Math.max(5, zoom / 1.25) })}>
            <ZoomOut {...I} />
          </button>
          <button className="pill icon" title="Zoom in (+)" aria-label="Zoom in" onClick={() => getState().set({ zoom: Math.min(400, zoom * 1.25) })}>
            <ZoomIn {...I} />
          </button>
          <button className="pill" title="Fit timeline to view" onClick={fit}>
            <Maximize2 {...I} /> Fit
          </button>
        </div>
      </div>
      <div
        className="timeline-scroll"
        ref={scroller}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return
          getState().set({ zoom: Math.min(400, Math.max(5, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) })
        }}
        onPointerMove={(e) => {
          const row = rowAt(e.clientY)
          const el = scroller.current!
          const y = e.clientY - el.getBoundingClientRect().top - RULER_H + el.scrollTop
          publishPresence({ cursor: { area: 'timeline', time: timeAt(e.clientX), trackId: row?.track.id ?? null, ny: row ? (y - row.y) / row.h : 0 } })
        }}
        onPointerLeave={() => publishPresence({ cursor: null })}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('.track-header')) return
          getState().select([])
          publishPresence({ selection: [] })
        }}
        onDragOver={(e) => {
          e.preventDefault()
          const row = rowAt(e.clientY)
          setDropHint(row ? { trackId: row.track.id, time: timeAt(e.clientX) } : null)
        }}
        onDragLeave={() => setDropHint(null)}
        onDrop={onDrop}
      >
        <div className="timeline-inner" style={{ width: width + HEADER_W, height: totalH + RULER_H }}>
          <div
            className="ruler"
            data-guide="timeline.ruler"
            style={{ left: HEADER_W, width }}
            onPointerDown={(e) => {
              e.stopPropagation()
              getState().set({ playing: false })
              getState().setPlayhead(timeAt(e.clientX))
              setDrag({ kind: 'scrub' })
            }}
          >
            {Array.from({ length: Math.ceil(width / zoom / tickStep) + 1 }, (_, i) => (
              <div key={i} className="tick" style={{ left: i * tickStep * zoom }}>
                <span>{formatTimecode(i * tickStep, fps).slice(0, 8)}</span>
              </div>
            ))}
            {suggestions.map((sg) => (
              <div key={sg.id} className="ruler-suggest" style={{ left: sg.start * zoom, width: Math.max(2, (sg.end - sg.start) * zoom) }} title={sg.label} />
            ))}
            {project.markers.map((m) => (
              <div key={m.id} className="marker" style={{ left: m.time * zoom, background: m.color }} title={m.label} />
            ))}
          </div>
          <div className="ruler-corner" style={{ width: HEADER_W }}>
            <button className="add-track" data-guide="timeline.add-track" title="Add video track" onClick={() => getState().dispatch('add_track', { kind: 'video' })}>
              +V
            </button>
            <button className="add-track" title="Add audio track" onClick={() => getState().dispatch('add_track', { kind: 'audio' })}>
              +A
            </button>
            <button className="add-track" title="Add text track" onClick={() => getState().dispatch('add_track', { kind: 'text' })}>
              +T
            </button>
          </div>
          {rows.map(({ track, y, h }) => (
            <div key={track.id} className={`track-row kind-${track.kind}${dropHint?.trackId === track.id ? ' drop' : ''}`} style={{ top: y + RULER_H, height: h, width: width + HEADER_W }}>
              <div className="track-header" style={{ width: HEADER_W }}>
                <input className="track-name" value={track.name} spellCheck={false} aria-label="Track name" onChange={(e) => update(track.id, { name: e.target.value })} />
                <div className="track-btns">
                  <button className="tbtn extra" title="Delete track" aria-label="Delete track" onClick={() => getState().dispatch('remove_track', { trackId: track.id })}>
                    <X {...B} />
                  </button>
                  <button className={`tbtn${track.locked ? ' on' : ' extra'}`} title={track.locked ? 'Unlock' : 'Lock'} aria-pressed={!!track.locked} onClick={() => update(track.id, { locked: !track.locked })}>
                    {track.locked ? <Lock {...B} /> : <LockOpen {...B} />}
                  </button>
                  {track.kind !== 'audio' && (
                    <button className={`tbtn${track.hidden ? ' on' : ''}`} title={track.hidden ? 'Show' : 'Hide'} aria-pressed={!!track.hidden} onClick={() => update(track.id, { hidden: !track.hidden })}>
                      {track.hidden ? <EyeOff {...B} /> : <Eye {...B} />}
                    </button>
                  )}
                  {(track.kind === 'audio' || track.kind === 'video') && (
                    <>
                      <button className={`tbtn mute${track.muted ? ' on' : ''}`} title="Mute" aria-pressed={!!track.muted} onClick={() => update(track.id, { muted: !track.muted })}>
                        M
                      </button>
                      <button className={`tbtn solo${track.solo ? ' on' : ''}`} title="Solo" aria-pressed={!!track.solo} onClick={() => update(track.id, { solo: !track.solo })}>
                        S
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div className="clips-layer" style={{ left: HEADER_W, top: RULER_H, width, height: totalH }}>
            {project.clips.map((c) => {
              const row = rows.find((r) => r.track.id === c.trackId)
              if (!row) return null
              let start = c.start
              let dur = c.duration
              let r = row
              if (drag?.kind === 'move' && drag.ids.includes(c.id)) {
                start += drag.dt
                r = rows.find((x) => x.track.id === drag.trackId && drag.ids.length === 1) ?? row
              } else if (drag?.kind === 'trim-l' && drag.clip.id === c.id) {
                start += drag.dt
                dur -= drag.dt
              } else if (drag?.kind === 'trim-r' && drag.clip.id === c.id) dur += drag.dt
              const m = c.mediaId ? mediaById.get(c.mediaId) : undefined
              const w = Math.max(2, dur * zoom)
              const peerSel = Object.values(peers).find((p) => p.presence.selection?.includes(c.id))
              const thumb = m && m.kind !== 'audio' ? thumbUrl(m) : undefined
              return (
                <div
                  key={c.id}
                  className={`clip kind-${row.track.kind}${selection.includes(c.id) ? ' selected' : ''}${tool === 'razor' ? ' razor' : ''}${row.track.locked ? ' locked' : ''}`}
                  style={{ left: start * zoom, top: r.y + 2, width: w, height: r.h - 4, outlineColor: peerSel?.user.color, outlineStyle: peerSel ? 'solid' : undefined }}
                  onPointerDown={(e) => onClipDown(e, c, 'body')}
                  title={c.name ?? m?.name ?? c.text}
                >
                  {thumb && row.track.kind === 'video' && <div className="clip-thumb" style={{ backgroundImage: `url("${thumb}")` }} />}
                  {m && m.hasAudio && row.track.kind === 'audio' && <Waveform clip={c} media={m} width={w} height={r.h - 14} />}
                  <span className="clip-label">{c.text ?? c.name ?? m?.name ?? 'Clip'}</span>
                  <div className="trim l" onPointerDown={(e) => onClipDown(e, c, 'l')} />
                  <div className="trim r" onPointerDown={(e) => onClipDown(e, c, 'r')} />
                </div>
              )
            })}
            {suggestions.map((sg) => (
              <div
                key={sg.id}
                className={`suggest-range reason-${sg.reason}`}
                style={{ left: sg.start * zoom, width: Math.max(2, (sg.end - sg.start) * zoom), height: totalH }}
                title={`${sg.label} — click to apply`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  void getState().dispatch('apply_suggestions', { ids: [sg.id] })
                }}
              />
            ))}
            {dropHint && <div className="drop-line" style={{ left: dropHint.time * zoom, height: totalH }} />}
            {Object.values(peers).map(({ user, presence }) =>
              presence.playhead !== undefined ? <div key={`ph-${user.id}`} className="peer-playhead" style={{ left: presence.playhead * zoom, height: totalH, background: user.color }} /> : null
            )}
            <div className="playhead" style={{ left: playhead * zoom, height: totalH + RULER_H, top: -RULER_H }} />
            {Object.values(peers).map(({ user, presence }) => {
              const c = presence.cursor
              if (!c || c.area !== 'timeline' || !('time' in c)) return null
              const row = rows.find((r) => r.track.id === c.trackId)
              const y = row ? row.y + c.ny * row.h : 0
              return (
                <div key={user.id} className="remote-cursor" style={{ left: c.time * zoom, top: y }}>
                  <CursorArrow color={user.color} name={user.name} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
