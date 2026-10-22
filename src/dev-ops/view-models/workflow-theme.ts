import type { BadgeRole } from '../use-cases/get-event.use-case.ts'

const themeRoles = new Map<string, BadgeRole>([
  ['NEUTRAL', 'neutral'],
  ['INFO', 'info'],
  ['NOTICE', 'warning'],
  ['WARN', 'warning'],
  ['ERROR', 'error'],
  ['SUCCESS', 'success']
])

/** A CW theme as a badge role; `NONE`, or any theme CW does not draw, has no colour. */
export const toThemeRole = (theme: string): BadgeRole | null =>
  themeRoles.get(theme) ?? null
