import { useEffect, useLayoutEffect, useState } from 'react'
import { useGuide } from '../lib/guide'
import { getState } from '../store'

/** Ghost cursor + spotlight walkthrough for the "show me how" assistant mode. */
export function GuideOverlay() {
  const { active, steps, index, title, next, back, stop } = useGuide()
  const step = steps[index]
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!active || !step) return
    if (step.target.startsWith('export.') || step.target === 'page.export') getState().set({ page: step.target === 'page.export' ? getState().page : 'export' })
    else if (!step.target.startsWith('page.') && getState().page !== 'edit' && !document.querySelector(`[data-guide="${step.target}"]`)) getState().set({ page: 'edit' })
  }, [active, step])

  useLayoutEffect(() => {
    if (!active || !step) return
    let raf = 0
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`)
      const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null
      setRect((prev) => (prev && r && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : r))
      raf = requestAnimationFrame(tick)
    }
    tick()
    const el = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return () => cancelAnimationFrame(raf)
  }, [active, step])

  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
      else if (e.key === 'Enter' || e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [active, next, back, stop])

  if (!active || !step) return null
  const pad = 6
  const r = rect ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0)
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const below = r.y + r.height + 180 < window.innerHeight
  const tipLeft = Math.min(Math.max(12, cx - 160), window.innerWidth - 332)
  const tipTop = below ? r.y + r.height + 16 : Math.max(12, r.y - 168)
  return (
    <div className="guide-layer">
      <div className="guide-spot" style={{ left: r.x - pad, top: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 }} />
      <div className="ghost-cursor" style={{ transform: `translate(${cx}px, ${cy}px)` }}>
        <svg width="26" height="26" viewBox="0 0 18 18">
          <path d="M2 1 L16 8 L9 10 L6 17 Z" fill="#7c5cff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        <span className="ghost-ping" />
      </div>
      <div className="guide-tip" style={{ left: tipLeft, top: tipTop }}>
        <div className="guide-head">
          <span className="guide-title">{title}</span>
          <span className="muted small">
            {index + 1}/{steps.length}
          </span>
        </div>
        <p>{step.text}</p>
        {step.shortcut && <kbd>{step.shortcut}</kbd>}
        {!rect && <p className="muted small">(This control isn't visible right now.)</p>}
        <div className="row between">
          <button className="btn sm ghost" onClick={stop}>
            Close
          </button>
          <div className="row">
            {index > 0 && (
              <button className="btn sm" onClick={back}>
                Back
              </button>
            )}
            <button className="btn sm primary" onClick={next}>
              {index + 1 === steps.length ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
