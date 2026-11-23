import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_TEMPLATES } from '@shared/templates'
import type { Template } from '@shared/types'

const file = () => join(app.getPath('userData'), 'templates.json')

function readUser(): Template[] {
  try {
    return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : []
  } catch {
    return []
  }
}

export function listTemplates(): Template[] {
  return [...BUILTIN_TEMPLATES, ...readUser()]
}

export function saveTemplate(t: Template): Template {
  const all = readUser().filter((x) => x.id !== t.id)
  all.push(t)
  writeFileSync(file(), JSON.stringify(all, null, 2))
  return t
}

export function deleteTemplate(id: string): void {
  writeFileSync(file(), JSON.stringify(readUser().filter((x) => x.id !== id), null, 2))
}
