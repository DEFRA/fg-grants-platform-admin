import { toThemeRole } from './workflow-theme.ts'

describe('toThemeRole', () => {
  test.each([
    ['NEUTRAL', 'neutral'],
    ['INFO', 'info'],
    ['NOTICE', 'warning'],
    ['WARN', 'warning'],
    ['ERROR', 'error'],
    ['SUCCESS', 'success']
  ])("draws CW's %s theme as %s", (theme, role) => {
    expect(toThemeRole(theme)).toBe(role)
  })

  test.each(['NONE', 'PURPLE', ''])('draws no colour for %j', (theme) => {
    expect(toThemeRole(theme)).toBeNull()
  })
})
