import { catalogue } from '../test-fixtures.ts'
import type { Catalogue } from '../shell-catalogue.ts'

/**
 * A stub rather than an automock: every dev-ops page draws its navigation from
 * the catalogue, so a test that renders one needs an answer here whether or
 * not it is about buckets.
 */
export const shellCatalogue = vi.fn((): Catalogue | null => catalogue)

export const readShellUseCase = vi.fn(async (): Promise<void> => undefined)
