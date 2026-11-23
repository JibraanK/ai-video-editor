import { useStore } from '../store'
import { publishPresence } from '../lib/collab'

export function CursorArrow({ color, name }: { color: string; name: string }) {
  return (
    <div className="remote-cursor-inner">
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path d="M2 1 L16 8 L9 10 L6 17 Z" fill={color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <span className="remote-cursor-label" style={{ background: color }}>
        {name}
      </span>
    </div>
  )
}

/** Remote cursors for a panel; positions are normalised to the panel so they line up at any window size. */
export function AreaCursors({ area }: { area: string }) {
  const peers = useStore((s) => s.collab.peers)
  return (
    <>
      {Object.values(peers).map(({ user, presence }) => {
        const c = presence.cursor
        if (!c || c.area !== area || !('nx' in c)) return null
        return (
          <div key={user.id} className="remote-cursor" style={{ left: `${c.nx * 100}%`, top: `${c.ny * 100}%` }}>
            <CursorArrow color={user.color} name={user.name} />
          </div>
        )
      })}
    </>
  )
}

export function areaPointer(area: string) {
  return {
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      publishPresence({ cursor: { area, nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height } })
    },
    onPointerLeave: () => publishPresence({ cursor: null })
  }
}
