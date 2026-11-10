import { readFileSync } from 'node:fs'
import path from 'node:path'
import type nunjucks from 'nunjucks'

/**
 * Design system's Nunjucks half. Add `designSystemViews` to an environment's search path
 * and call `addDesignSystem` on it, then a page can
 * `{% import "design-system/macros.njk" as au %}`.
 *
 * The icons are read once here and handed to the macros as a global, so a page
 * draws any Lucide icon by name without a file per icon.
 */
export const designSystemViews = path.resolve(import.meta.dirname)  // <name>/macros.njk, components/ and core/ sit beside this file

const icons: Record<string, [string, Record<string, string>][]> = JSON.parse(
  readFileSync(path.join(designSystemViews, 'core/icons.json'), 'utf8')
)

let counter = 0

/** A fresh id for a part that needs one (a menu a button opens), unique within a render. */
const nextId = (prefix = 'au') => `${prefix}-${(++counter).toString(36)}`

/** Older Lucide names an app may still use, mapped to the current name. */
const aliases: Record<string, string> = JSON.parse(
  readFileSync(path.join(designSystemViews, 'core/icon-aliases.json'), 'utf8')
)

/** The drawing of an icon. A name the set does not hold is a mistake in a template, so it fails the render. */
export const iconNodes = (name: string) => {
  const nodes = icons[iconName(name)]
  if (!nodes) throw new Error(`Unknown icon "${name}"`)
  return nodes
}

/** The Lucide name an icon is drawn by, an older name resolved. */
export const iconName = (name: string) => aliases[name] ?? name

export const addDesignSystem = (environment: nunjucks.Environment) => {
  environment.addGlobal('auIconNodes', iconNodes)
  environment.addGlobal('auIconName', iconName)
  environment.addGlobal('auId', nextId)
  return environment
}
