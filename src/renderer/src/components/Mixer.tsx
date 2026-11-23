import { useMemo } from 'react'
import { getState, useStore } from '../store'

const db = (g: number) => (g > 0 ? `${(20 * Math.log10(g)).toFixed(1)}` : '-∞')

function Strip({ name, gain, muted, solo, onGain, onMute, onSolo, master }: { name: string; gain: number; muted?: boolean; solo?: boolean; onGain: (g: number) => void; onMute?: () => void; onSolo?: () => void; master?: boolean }) {
  return (
    <div className={`strip${master ? ' master' : ''}`}>
      <div className="strip-db">{db(gain)} dB</div>
      <input className="fader" type="range" min={0} max={2} step={0.01} value={gain} onChange={(e) => onGain(Number(e.target.value))} onDoubleClick={() => onGain(1)} title="Double-click to reset" />
      <div className="strip-btns">
        {onMute && (
          <button className={`tbtn${muted ? ' on warn' : ''}`} onClick={onMute}>
            M
          </button>
        )}
        {onSolo && (
          <button className={`tbtn${solo ? ' on solo' : ''}`} onClick={onSolo}>
            S
          </button>
        )}
      </div>
      <div className="strip-name" title={name}>
        {name}
      </div>
    </div>
  )
}

export function Mixer() {
  const allTracks = useStore((s) => s.project.tracks)
  const tracks = useMemo(() => allTracks.filter((t) => t.kind === 'audio' || t.kind === 'video'), [allTracks])
  const master = useStore((s) => s.project.masterGain)
  const upd = (trackId: string, patch: object) => void getState().dispatch('update_track', { trackId, ...patch })
  return (
    <div className="panel mixer" data-guide="mixer">
      <div className="panel-title">Mixer</div>
      <div className="strips">
        {tracks.map((t) => (
          <Strip key={t.id} name={t.name} gain={t.gain} muted={t.muted} solo={t.solo} onGain={(g) => upd(t.id, { gain: g })} onMute={() => upd(t.id, { muted: !t.muted })} onSolo={() => upd(t.id, { solo: !t.solo })} />
        ))}
        <Strip master name="Master" gain={master} onGain={(g) => void getState().dispatch('set_master_gain', { gain: g })} />
      </div>
    </div>
  )
}
