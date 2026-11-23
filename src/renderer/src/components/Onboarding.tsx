import { Check, ChevronDown, ChevronUp, CircleHelp, GraduationCap, Keyboard, ListChecks, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { importDialog } from '../lib/actions'
import { openQuickstart, QUICKSTART, quickstartCount, showQuickstartGuide, skipOnboarding, startQuickstart, startTutorial, useOnboarding } from '../lib/onboarding'
import { nextMilestone, QUICKSTART_ORDER } from '@shared/quickstart'
import { useGuide } from '../lib/guide'

const I = { size: 14, strokeWidth: 1.75 }

/** First-run screen: pick the hands-on tutorial, the quickstart checklist, or skip. */
export function WelcomeDialog() {
  const open = useOnboarding((s) => s.welcome)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && skipOnboarding()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  return (
    <div className="modal-back welcome-back">
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <span className="brandmark welcome-mark">cutline</span>
        <h1 id="welcome-title">Edit by hand, or just ask.</h1>
        <p className="welcome-lede">A timeline editor with an AI that can make the edits for you. Pick how you want to start.</p>
        <div className="welcome-paths">
          <button className="welcome-path primary" onClick={() => void startTutorial()} autoFocus>
            <GraduationCap size={18} strokeWidth={1.75} />
            <span className="welcome-path-title">Take the tutorial</span>
            <span className="welcome-path-meta">About 3 minutes. Hands-on, with a sample clip we generate for you.</span>
          </button>
          <button className="welcome-path" onClick={() => void startQuickstart()}>
            <Plus size={18} strokeWidth={1.75} />
            <span className="welcome-path-title">Start with my footage</span>
            <span className="welcome-path-meta">Import your clips and follow a five-step checklist to your first export.</span>
          </button>
        </div>
        <div className="row between welcome-foot">
          <span className="muted small">Both live under Help (?) in the top bar.</span>
          <button className="btn sm ghost" onClick={skipOnboarding}>
            Skip, I know my way around
          </button>
        </div>
      </div>
    </div>
  )
}

/** Floating checklist that ticks itself off as the user works. */
export function QuickstartPanel() {
  const { checklist, collapsed, done, set } = useOnboarding()
  const guiding = useGuide((s) => s.active)
  if (!checklist || guiding) return null
  const count = quickstartCount(done)
  const next = nextMilestone(done)
  const total = QUICKSTART_ORDER.length
  if (collapsed)
    return (
      <button className="quickstart-chip" onClick={() => set({ collapsed: false })} aria-label={`Quickstart, ${count} of ${total} done. Expand`}>
        <ListChecks {...I} /> Quickstart <span className="qs-count">{count}/{total}</span> <ChevronUp {...I} />
      </button>
    )
  return (
    <section className="quickstart" aria-label="Quickstart">
      <header className="qs-head">
        <span className="qs-title">Quickstart</span>
        <span className="qs-count">
          {count}/{total}
        </span>
        <span className="spacer" />
        <button className="icon-btn" title="Collapse" onClick={() => set({ collapsed: true })}>
          <ChevronDown {...I} />
        </button>
        <button className="icon-btn" title="Hide quickstart (reopen from Help)" onClick={() => set({ checklist: false })}>
          <X {...I} />
        </button>
      </header>
      <div className="qs-meter" aria-hidden>
        <div style={{ width: `${(count / total) * 100}%` }} />
      </div>
      <ol className="qs-list">
        {QUICKSTART_ORDER.map((id) => {
          const item = QUICKSTART[id]
          const isDone = done.includes(id)
          const isNext = id === next
          return (
            <li key={id} className={`qs-item${isDone ? ' done' : ''}${isNext ? ' next' : ''}`}>
              <span className="qs-box" aria-hidden>
                {isDone && <Check size={11} strokeWidth={3} />}
              </span>
              <div className="qs-text">
                <span className="qs-item-title">
                  {item.title}
                  {isDone && <span className="sr-only"> (done)</span>}
                </span>
                {isNext && <span className="qs-detail">{item.detail}</span>}
              </div>
              {!isDone && (
                <button className="btn sm ghost qs-show" onClick={() => (id === 'import' ? void importDialog() : showQuickstartGuide(id))}>
                  {id === 'import' ? 'Import' : 'Show me'}
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {!next && (
        <div className="qs-done">
          <p>That’s the loop. Everything else is in Ask: describe the edit and Cutline does it.</p>
          <button className="btn sm" onClick={() => set({ checklist: false })}>
            Close quickstart
          </button>
        </div>
      )}
    </section>
  )
}

/** Top-bar help menu: replay onboarding and open the shortcut sheet. */
export function HelpMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const tutorialDone = useOnboarding((s) => s.tutorialDone)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])
  const pick = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  return (
    <div className="help-menu" ref={root}>
      <button className={`icon-btn${open ? ' on' : ''}`} data-guide="topbar.help" title="Help" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <CircleHelp {...I} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={pick(() => void startTutorial())}>
            <GraduationCap {...I} /> {tutorialDone ? 'Replay tutorial' : 'Interactive tutorial'}
          </button>
          <button role="menuitem" onClick={pick(openQuickstart)}>
            <ListChecks {...I} /> Quickstart checklist
          </button>
          <button role="menuitem" onClick={pick(onShortcuts)}>
            <Keyboard {...I} /> Keyboard shortcuts <kbd>?</kbd>
          </button>
        </div>
      )}
    </div>
  )
}

/** Shown over the preview while the timeline is empty. */
export function EmptyStage() {
  return (
    <div className="empty-stage">
      <p className="empty-stage-title">Nothing on the timeline yet</p>
      <p className="muted">Import footage to start cutting, or learn the basics on a sample clip.</p>
      <div className="row">
        <button className="btn primary" onClick={() => void importDialog()}>
          <Plus {...I} /> Import footage
        </button>
        <button className="btn" onClick={() => void startTutorial()}>
          <GraduationCap {...I} /> Tutorial
        </button>
      </div>
    </div>
  )
}
