import getPath from 'lodash/get.js'
import setPath from 'lodash/set.js'

// The real schema, loaded past this mock, so every key a test does not care
// about keeps the value the app would actually run with.
const { config: actual } =
  await vi.importActual<typeof import('../config.ts')>('../config.ts')

/**
 * `set` only records, and `get` replays those recordings over a fresh copy of
 * the real values. Nothing is stored outside the mock, so the `clearMocks`
 * option in vitest.config.ts wipes a test's changes along with its call
 * history, and each test opens on the genuine defaults.
 */
const set = vi.fn((_key: string, _value: unknown) => undefined)

const properties = () => {
  const values = actual.getProperties()

  for (const [key, value] of set.mock.calls) {
    setPath(values, key, value)
  }

  return values
}

/**
 * A stub rather than an automock: the schema is private to ../config.ts, so a
 * second convict instance cannot be built from it.
 *
 * A value written with `config.set('some.key', value)` is seen by a read of its
 * parent, so setting `session.cache.engine` shows up in a
 * `config.get('session')`.
 */
export const config = {
  get: vi.fn((key?: string) =>
    key === undefined ? properties() : getPath(properties(), key)
  ),
  set
}
