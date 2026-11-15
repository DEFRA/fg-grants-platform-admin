import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'

const devOps = import.meta.dirname

/** The icons GAS's and CW's catalogues declare for their lists. */
const catalogueIcons = [
  'activity',
  'file-text',
  'folder',
  'scroll-text',
  'workflow'
]

const sources = globSync('**/*.{ts,njk}', {
  cwd: devOps,
  exclude: (file) =>
    file.startsWith('views/components') || /\.test\.ts$/.test(file)
}).map((file) => readFileSync(path.join(devOps, file), 'utf8'))

const quoted = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map(([, name]) => name)

/** An icon by its name: `icon: 'x'`, `iconStart`/`iconEnd`, `xIcon = 'x'`, and the Icon macro's own `Icon({ name: 'x' })`. */
const iconPatterns = [
  /icon(?:Start|End)?\s*[:=]\s*['"]([a-z0-9-]+)['"]/gi,
  /\bIcon\(\{\s*name:\s*['"]([a-z0-9-]+)['"]/g
]

const named = sources.flatMap((source) => [
  ...iconPatterns.flatMap((pattern) => quoted(source, pattern)),
  ...quoted(
    /const itemIcons[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? '',
    /:\s*'([a-z0-9-]+)'/g
  )
])

const readCopy = (file: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(path.join(devOps, 'views/components/core', file), 'utf8')
  )

const icons = readCopy('icons.json')
const aliases = readCopy('icon-aliases.json')

/** A name the icon set draws: its own, or an alias of one it holds. */
const held = (name: string): boolean =>
  Object.hasOwn(icons, name) ||
  (Object.hasOwn(aliases, name) && Object.hasOwn(icons, String(aliases[name])))

describe('the copied icon set', () => {
  test('finds the icons the code and the views name', () => {
    expect(named).toEqual(
      expect.arrayContaining(['radio-tower', 'key-round', 'refresh-cw'])
    )
  })

  test.each([...new Set([...named, ...catalogueIcons])].sort())(
    'holds %s',
    (icon) => {
      expect(held(icon)).toBe(true)
    }
  )
})
