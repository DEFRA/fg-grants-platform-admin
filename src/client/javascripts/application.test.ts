import {
  createAll,
  Button,
  Checkboxes,
  ErrorSummary,
  Radios,
  SkipLink,
  Tabs
} from 'govuk-frontend'
import { initAllowListCounts } from '../../grant-ops/client/allow-list-count.ts'
import { initAllowListErrorFocus } from '../../grant-ops/client/allow-list-error-focus.ts'
import { initAllowListErrorToggle } from '../../grant-ops/client/allow-list-error-toggle.ts'
import { selectDefaultAllowListTab } from '../../grant-ops/client/allow-list-tabs.ts'

vi.mock(import('../../grant-ops/client/allow-list-count.ts'))
vi.mock(import('../../grant-ops/client/allow-list-error-focus.ts'))
vi.mock(import('../../grant-ops/client/allow-list-error-toggle.ts'))
vi.mock(import('../../grant-ops/client/allow-list-tabs.ts'))

vi.mock(import('govuk-frontend'), () => ({
  createAll: vi.fn(),
  Button: class Button {},
  Checkboxes: class Checkboxes {},
  ErrorSummary: class ErrorSummary {},
  Radios: class Radios {},
  SkipLink: class SkipLink {},
  Tabs: class Tabs {}
}))

describe('application', () => {
  test('initialises every govuk-frontend component the pages use', async () => {
    await import('./application.ts')

    expect(createAll).toHaveBeenCalledWith(Button)
    expect(createAll).toHaveBeenCalledWith(Checkboxes)
    expect(createAll).toHaveBeenCalledWith(ErrorSummary)
    expect(createAll).toHaveBeenCalledWith(Radios)
    expect(createAll).toHaveBeenCalledWith(SkipLink)
    expect(createAll).toHaveBeenCalledWith(Tabs)
    expect(createAll).toHaveBeenCalledTimes(6)
    expect(
      vi.mocked(createAll).mock.calls.map(([Component]) => Component)
    ).toEqual([Button, Checkboxes, Radios, SkipLink, Tabs, ErrorSummary])
    expect(selectDefaultAllowListTab).toHaveBeenCalledTimes(2)
    expect(initAllowListCounts).toHaveBeenCalledTimes(1)
    expect(initAllowListErrorFocus).toHaveBeenCalledTimes(1)
    expect(initAllowListErrorToggle).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(initAllowListErrorToggle).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(createAll).mock.invocationCallOrder[5])
  })
})
