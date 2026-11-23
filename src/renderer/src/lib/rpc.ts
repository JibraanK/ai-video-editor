import { applyCommand } from '@shared/commands'
import type { Project } from '@shared/types'
import { getState } from '../store'
import { GUIDE_TARGETS, useGuide, visibleTargets } from './guide'
import { runPlugin, runPluginCode, usePlugins } from './plugins'
import { rasterizeText } from './textRender'

async function uiTool(name: string, a: any): Promise<unknown> {
  switch (name) {
    case 'list_ui_targets': {
      const visible = new Set(visibleTargets())
      return { page: getState().page, targets: Object.entries(GUIDE_TARGETS).map(([id, description]) => ({ id, description, visible: visible.has(id) })) }
    }
    case 'show_guide': {
      const steps = (a.steps ?? []).filter((s: any) => GUIDE_TARGETS[s.target])
      if (!steps.length) throw new Error('No valid targets; call list_ui_targets')
      if (steps.some((s: any) => s.target.startsWith('export.'))) getState().set({ page: 'export' })
      else if (getState().page === 'export' && steps.every((s: any) => !s.target.startsWith('page.'))) getState().set({ page: 'edit' })
      useGuide.getState().start(a.title ?? 'How to', steps)
      return { shown: true, steps: steps.length }
    }
    case 'create_plugin': {
      const p = usePlugins.getState().save({ name: a.name, description: a.description ?? '', code: a.code })
      getState().toast(`New feature added: ${p.name}`)
      return { plugin: p.id, ran: a.runNow ? await runPluginCode(p.code) : undefined }
    }
    case 'run_plugin':
      return runPlugin(a.plugin)
  }
  throw new Error(`Unknown UI tool ${name}`)
}

/** Main process (MCP / agents / service tools) talks to the live editor state through these. */
export function registerRpc(): () => void {
  return window.api.onRpc(async (method, params) => {
    const s = getState()
    switch (method) {
      case 'getProject':
        return s.project
      case 'applyCommand': {
        if (s.remote) return s.dispatch(params.name, params.args)
        const { result } = applyCommand(s.project, params.name, params.args) // validate first so errors surface
        void result
        return s.dispatch(params.name, params.args)
      }
      case 'setProject':
        s.setProject(params.project as Project, params.label)
        return { ok: true }
      case 'addMedia':
        s.addMedia(params.items)
        return { ok: true }
      case 'setTranscript':
        s.setTranscript(params.words)
        return { ok: true }
      case 'renderTextOverlays': {
        await document.fonts.ready
        return (params.clipIds as string[]).map((id) => {
          const clip = s.project.clips.find((c) => c.id === id)!
          return { clipId: id, dataUrl: rasterizeText(clip, params.width, params.height) }
        })
      }
      case 'uiTool':
        return uiTool(params.name, params.args ?? {})
    }
    throw new Error(`Unknown RPC ${method}`)
  })
}
