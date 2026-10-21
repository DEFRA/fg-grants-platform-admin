import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import type { GrantAgreement } from '../../../use-cases/get-grant-page.use-case.ts'
import { agreementDefinition } from '../../../use-cases/test-fixtures.ts'
import { toAgreementTab } from '../../../view-models/grant-agreement.view-model.ts'

const addresses = [
  {
    process: 'GENERATE_OFFER',
    service: 'LAND_DATA',
    url: 'https://land-data.example/api/v2/parcels/{sbi}'
  },
  { process: 'FETCH_TERMS', service: 'AGREEMENT_DOCS', url: null }
]

const tabOf = (overrides: Partial<GrantAgreement> = {}) =>
  render('agreement-definition', {
    tab: toAgreementTab({
      definition: agreementDefinition,
      addresses,
      problem: null,
      ...overrides
    }),
    testId: 'agreement'
  })

const part = ($: CheerioAPI, testId: string) =>
  $(`[data-testid="agreement-${testId}"]`)

const flatten = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

const headsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .find('th')
    .toArray()
    .map((head) => $(head).text())

const cellsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .toArray()
    .map((row) =>
      $(row)
        .children('td')
        .toArray()
        .map((cell) => flatten($(cell).text()))
    )

describe('agreement-definition component', () => {
  test('starts with the facts card, labelled Agreement', () => {
    const $ = tabOf()

    expect(part($, 'overview').attr('aria-label')).toBe('Agreement')
    expect(flatten(part($, 'fact-templates').text())).toBe(
      'Templates terms.standard, terms.welsh'
    )
  })

  test('heads the cards in order, each labelled by its heading', () => {
    const $ = tabOf()

    expect(
      ['states', 'pages', 'processes'].map((testId) => {
        const card = part($, testId)

        return $(`#${card.attr('aria-labelledby')}`).text()
      })
    ).toEqual(['States', 'Pages', 'Processes'])
  })

  test('lists each state action as a row, with the state cells on its first row', () => {
    const $ = tabOf()

    expect(headsOf($, 'states')).toEqual([
      'State',
      'Page',
      'Page processes',
      'Action',
      'Moves to',
      'Action page',
      'Checks',
      'Runs'
    ])
    expect(cellsOf($, 'state-row')).toEqual([
      [
        'offered initial',
        'offered',
        '—',
        'accept',
        'accepted',
        'accept',
        '1 required',
        'CREATE_AGREEMENT_PAYMENT'
      ],
      ['', '', '', 'withdraw', 'withdrawn', '—', '—', '—'],
      ['', '', '', 'cancel', 'cancelled', '—', '—', '—'],
      [
        'accepted pins version',
        'accepted',
        'GENERATE_OFFER',
        'terminate',
        'terminated',
        '—',
        '—',
        '—'
      ],
      ['withdrawn', 'withdrawn', '—', 'none', '', '', '', ''],
      ['cancelled', 'none', '—', 'none', '', '', '', ''],
      ['terminated', 'terminated', '—', 'none', '', '', '', '']
    ])
  })

  test('marks the initial and version-pinning states with outline badges', () => {
    const $ = tabOf()

    expect(part($, 'initial').attr('class')).toBe(
      'badge badge-sm badge-outline'
    )
    expect(part($, 'pins-version').attr('class')).toBe(
      'badge badge-sm badge-outline'
    )
    expect(
      part($, 'initial').closest('tr').find('td').first().text()
    ).toContain('offered')
  })

  test('lists each page with its layout, sections and component types', () => {
    const $ = tabOf()

    expect(headsOf($, 'pages')).toEqual([
      'Page',
      'Title',
      'Layout',
      'Sections',
      'Components'
    ])
    expect(cellsOf($, 'page-row')).toEqual([
      [
        'document',
        'Agreement document',
        'document',
        'parties, actions, payments, terms',
        'heading'
      ],
      [
        'offered',
        'Review your agreement offer',
        '—',
        '—',
        'summary-list, button'
      ],
      ['accept', 'Accept your agreement offer', '—', '—', 'form']
    ])
  })

  test('lists each process with the address it calls, or Not configured, and the service beneath', () => {
    const $ = tabOf()

    expect(headsOf($, 'processes')).toEqual([
      'Process',
      'Type',
      'Calls',
      'Outputs'
    ])
    expect(cellsOf($, 'process-row')).toEqual([
      [
        'GENERATE_OFFER',
        'endpoint',
        'POST https://land-data.example/api/v2/parcels/{sbi}LAND_DATA',
        'offer, totalAmountPence'
      ],
      ['FETCH_TERMS', 'endpoint', 'GET Not configuredAGREEMENT_DOCS', 'terms'],
      ['CREATE_AGREEMENT_PAYMENT', 'handler', '—', '—']
    ])
    expect(
      part($, 'process-service')
        .toArray()
        .map((service) => $(service).is('div'))
    ).toEqual([true, true])
    expect(
      part($, 'process-not-configured')
        .find('[data-testid="do-status-dot"]')
        .attr('class')
    ).toBe('status status-warning')
  })

  test('says when there are no processes, with no table', () => {
    const $ = tabOf({
      definition: { ...agreementDefinition, processDefinitions: undefined }
    })

    expect(flatten(part($, 'no-processes').text())).toBe('No processes.')
    expect(part($, 'process-row')).toHaveLength(0)
  })

  test('scrolls each table inside its card on a narrow screen', () => {
    const $ = tabOf()

    expect(
      ['states', 'pages', 'processes'].map((testId) => [
        part($, `${testId}-table`).parent().attr('class'),
        part($, `${testId}-table`).attr('class')
      ])
    ).toEqual([
      ['w-full overflow-x-auto', 'table w-full min-w-[56rem] table-fixed'],
      ['w-full overflow-x-auto', 'table w-full min-w-[40rem] table-fixed'],
      ['w-full overflow-x-auto', 'table w-full min-w-[40rem] table-fixed']
    ])
  })

  test('shows only why GAS cannot load a definition, and no cards', () => {
    const $ = tabOf({
      addresses: [],
      problem: 'Agreement definition code "other" does not match'
    })

    expect(part($, 'problem').attr('role')).toBe('alert')
    expect(flatten(part($, 'problem').text())).toBe(
      'GAS cannot load this agreement definition: Agreement definition code "other" does not match'
    )
    expect(part($, 'overview')).toHaveLength(0)
    expect(part($, 'states')).toHaveLength(0)
  })

  test('treats an empty problem as a problem', () => {
    const $ = tabOf({ addresses: [], problem: '' })

    expect(part($, 'problem')).toHaveLength(1)
    expect(part($, 'states')).toHaveLength(0)
  })
})
