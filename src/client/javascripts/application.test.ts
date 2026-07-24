import {
  createAll,
  Button,
  Checkboxes,
  ErrorSummary,
  Radios,
  SkipLink
} from 'govuk-frontend'

vi.mock(import('govuk-frontend'), () => ({
  createAll: vi.fn(),
  Button: class Button {},
  Checkboxes: class Checkboxes {},
  ErrorSummary: class ErrorSummary {},
  Radios: class Radios {},
  SkipLink: class SkipLink {}
}))

describe('application', () => {
  test('initialises every govuk-frontend component the pages use', async () => {
    await import('./application.ts')

    expect(createAll).toHaveBeenCalledWith(Button)
    expect(createAll).toHaveBeenCalledWith(Checkboxes)
    expect(createAll).toHaveBeenCalledWith(ErrorSummary)
    expect(createAll).toHaveBeenCalledWith(Radios)
    expect(createAll).toHaveBeenCalledWith(SkipLink)
    expect(createAll).toHaveBeenCalledTimes(5)
  })
})
