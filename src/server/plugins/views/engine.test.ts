import { environment } from './engine.ts'

describe('environment', () => {
  test('renders the filters the shared view kit exports', () => {
    expect(
      environment.renderString('{{ amount | formatCurrency }}', {
        amount: '1500'
      })
    ).toBe('£1,500.00')

    expect(
      environment.renderString('{{ date | formatDate("d MMMM yyyy") }}', {
        date: '2026-07-22T09:00:00.000Z'
      })
    ).toBe('22 July 2026')
  })

  test('renders the globals the shared view kit exports', () => {
    expect(environment.renderString('{{ govukRebrand }}', {})).toBe('true')
  })

  test('resolves a govuk-frontend component off the search path', () => {
    const rendered = environment.renderString(
      `{%- from "govuk/components/tag/macro.njk" import govukTag -%}
       {{- govukTag({ text: "Submitted" }) -}}`,
      {}
    )

    expect(rendered).toEqual(expect.stringContaining('Submitted'))
  })

  test('leaves an undefined value blank rather than throwing', () => {
    expect(environment.renderString('[{{ missing }}]', {})).toBe('[]')
  })
})
