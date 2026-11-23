import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useGuide } from '../lib/guide'
import { getState, onCommand, useStore } from '../store'

/** Ghost cursor + spotlight walkthrough for "show me how" guides and the interactive tutorial. */
export function GuideOverlay() {
  const { active, steps, index, title, next, back, stop } = useGuide()
  const step = steps[index]
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [done, setDone] = useState(false)
  const waiting = !!step?.until

  useEffect(() => {
    if (!active || !step) return
    const t = step.target
    if (t.startsWith('pool.')) getState().set({ pool: true })
    else if (t.startsWith('inspector')) getState().set({ side: 'inspector' })
    else if (t === 'mixer') getState().set({ side: 'mixer' })
    else if (t.startsWith('agent.')) getState().set({ side: 'ask' })
    if (step.target.startsWith('export.') || step.target === 'page.export') getState().set({ page: step.target === 'page.export' ? getState().page : 'export' })
    else if (!step.target.startsWith('page.') && getState().page !== 'edit' && !document.querySelector(`[data-guide="${step.target}"]`)) getState().set({ page: 'edit' })
  }, [active, step])

  // Interactive steps: watch the editor and advance once the user has done the thing.
  const seen = useRef(new Set<string>())
  useEffect(() => {
    setDone(false)
    seen.current = new Set()
    if (!active || !step?.until) return
    const until = step.until
    let timer = 0
    const check = () => {
      if (timer || !until({ s: getState(), seen: seen.current })) return
      setDone(true)
      timer = window.setTimeout(() => useGuide.getState().index === index && next(), 700)
    }
    const offCmd = onCommand((name) => {
      seen.current.add(name)
      check()
    })
    const offStore = useStore.subscribe(check)
    check()
    return () => {
      offCmd()
      offStore()
      clearTimeout(timer)
    }
  }, [active, step, index, next])

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
      // Interactive steps leave the keyboard to the editor (Space, S, arrows…).
      else if (waiting) return
      else if (e.key === 'Enter' || e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [active, waiting, next, back, stop])

  if (!active || !step) return null
  const pad = 6
  const r = rect ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0)
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const side = r.width > 0 && r.width < window.innerWidth * 0.3 && r.x + r.width + 368 < window.innerWidth && cx < window.innerWidth * 0.3
  const below = r.y + r.height + 200 < window.innerHeight
  const tipLeft = side ? r.x + r.width + 16 : Math.min(Math.max(12, cx - 170), window.innerWidth - 352)
  const tipTop = side ? Math.min(Math.max(12, r.y), window.innerHeight - 220) : below ? r.y + r.height + 16 : Math.max(12, r.y - 196)
  const last = index + 1 === steps.length
  return (
    <div className={`guide-layer${waiting ? ' interactive' : ''}`}>
      <div className={`guide-spot${done ? ' done' : ''}`} style={{ left: r.x - pad, top: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 }} />
      <div className="ghost-cursor" style={{ transform: `translate(${cx}px, ${cy}px)` }}>
        <svg width="26" height="26" viewBox="0 0 18 18">
          <path d="M2 1 L16 8 L9 10 L6 17 Z" fill="var(--accent)" stroke="var(--accent-ink)" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        <span className="ghost-ping" />
      </div>
      <div className="guide-tip" style={{ left: tipLeft, top: tipTop }} role="dialog" aria-label={title}>
        <div className="guide-head">
          <span className="guide-title">{title}</span>
          <span className="guide-count">
            {index + 1}/{steps.length}
          </span>
        </div>
        {steps.length > 2 && (
          <div className="guide-steps" aria-hidden>
            {steps.map((_, i) => (
              <span key={i} className={i < index || (i === index && done) ? 'past' : i === index ? 'now' : ''} />
            ))}
          </div>
        )}
        <p>{step.text}</p>
        {step.shortcut && <kbd>{step.shortcut}</kbd>}
        {!rect && <p className="muted small">(This control isn't visible right now.)</p>}
        {waiting && (
          <div className={`guide-status${done ? ' done' : ''}`} role="status">
            {done ? 'Nice.' : 'Your turn'}
          </div>
        )}
        <div className="row between">
          <button className="btn sm ghost" onClick={stop}>
            {steps.length > 3 ? 'End' : 'Close'}
          </button>
          <div className="row">
            {index > 0 && !waiting && (
              <button className="btn sm" onClick={back}>
                Back
              </button>
            )}
            {waiting ? (
              <button className="btn sm ghost" onClick={next} disabled={done}>
                Skip step
              </button>
            ) : (
              <button className="btn sm primary" onClick={next}>
                {last ? 'Done' : 'Next'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
