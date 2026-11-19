import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { plugins } from '../../main.ts'
import { createServer } from '../../server/index.ts'
import { expectTablesStyled } from '../test-utils.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import type {
  Overview,
  OverviewResult
} from '../use-cases/get-overview.use-case.ts'
import { getOverviewUseCase } from '../use-cases/get-overview.use-case.ts'
import {
  allClear,
  failed,
  needsAttention,
  read
} from '../use-cases/overview-fixtures.ts'
import { catalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../use-cases/get-overview.use-case.ts'))

const operator = {
  user: { name: 'Ada Lovelace', email: 'ada.lovelace@example.gov.uk' },
  scope: ['FCP.GrantOperationsAdmin']
}

let server: Server

const visit = async (url = '/dev-ops', cookie?: string) => {
  const response = await server.inject({
    method: 'GET',
    url,
    headers: cookie ? { cookie } : {},
    auth: { strategy: 'session', credentials: operator }
  })

  return {
    $: load(response.payload),
    statusCode: response.statusCode,
    headers: response.headers
  }
}

const answer = (result: OverviewResult) =>
  vi.mocked(getOverviewUseCase).mockResolvedValue(result)

const show = (overview: Overview) => answer({ outcome: 'read', overview })

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const rowCells = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .toArray()
    .map((row) =>
      $(row)
        .find('td')
        .toArray()
        .map((cell) => flatten($(cell).text()))
        .filter(Boolean)
    )

const figureValue = ($: CheerioAPI, testId: string) =>
  flatten(part($, testId).find('.gpa-stat-value').text())

beforeAll(async () => {
  server = await createServer()
  await server.register(plugins)
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(shellCatalogue).mockReturnValue(catalogue)
  show(needsAttention)
})

afterAll(async () => {
  await server.stop()
})

describe('the Overview', () => {
  test('is the page Dev Ops lands on, drawn at its root with no redirect', async () => {
    const { $, statusCode } = await visit('/dev-ops')

    expect(statusCode).toBe(statusCodes.ok)
    expect(flatten(part($, 'overview-title').text())).toBe('Overview')
    expect($('title').text()).toBe('Overview – Grants Platform')
    expect(getOverviewUseCase).toHaveBeenCalledTimes(1)
  })

  test('is the first item in the sidebar, untitled, current on its page, and the brand links to it', async () => {
    const { $ } = await visit()
    const first = part($, 'shell-nav').find('a').first()

    expect(flatten(first.text())).toBe('Overview')
    expect(first.attr('href')).toBe('/dev-ops')
    expect(first.find('svg').attr('data-icon')).toBe('layout-dashboard')
    expect(first.attr('aria-current')).toBe('page')
    expect(
      part($, 'shell-nav')
        .find('.gpa-sidebar-section')
        .first()
        .find('.gpa-sidebar-title')
    ).toHaveLength(0)
    expect(part($, 'shell-brand').attr('href')).toBe('/dev-ops')
  })

  test('is in the sidebar of the other pages too, not current there', async () => {
    const { $ } = await visit('/dev-ops/clients/gas')
    const first = part($, 'shell-nav').find('a').first()

    expect(first.attr('href')).toBe('/dev-ops')
    expect(first.attr('aria-current')).toBeUndefined()
  })

  test('is drawn when its answer carries no shell, with no lists in the sidebar', async () => {
    vi.mocked(shellCatalogue).mockReturnValue(null)

    const { $, statusCode } = await visit()

    expect(statusCode).toBe(statusCodes.ok)
    expect(
      part($, 'shell-nav')
        .find('a')
        .toArray()
        .map((link) => $(link).attr('href'))
    ).toEqual(['/dev-ops', '/dev-ops/clients/gas', '/dev-ops/clients/cw'])
  })

  test('takes the shell’s Times opener and refuses any other address', async () => {
    expect((await visit('/dev-ops?times=open')).statusCode).toBe(statusCodes.ok)
    expect((await visit('/dev-ops?error=x')).statusCode).toBe(
      statusCodes.badRequest
    )
  })
})

describe('needing attention', () => {
  test('heads the page with the four figures, each dead-letter one with its trend', async () => {
    const { $ } = await visit()

    expect(figureValue($, 'overview-figure-dead-letters-gas')).toBe('66')
    expect(figureValue($, 'overview-figure-dead-letters-cw')).toBe('12')
    expect(figureValue($, 'overview-figure-config')).toBe('2')
    expect(figureValue($, 'overview-figure-tokens')).toBe('2')
    expect(
      part($, 'overview-figure-dead-letters-gas').find('.gpa-sparkline, svg')
        .length
    ).toBeGreaterThan(0)
    expect(
      flatten(part($, 'overview-figure-tokens').find('.gpa-stat-hint').text())
    ).toBe('within 30 days, or expired')
  })

  test('lists the five biggest groups of current dead letters across both services, each opening them with no time range', async () => {
    const { $ } = await visit()

    expect(rowCells($, 'overview-top-error-row')).toEqual([
      [
        'Application with clientRef <v> not found',
        'GAS',
        'AgreementStatusUpdated',
        '214',
        '13 Oct 2026 14:53'
      ],
      [
        'Grant <v> version <v> not found',
        'GAS',
        'CreateCase',
        '96',
        '13 Oct 2026 14:41'
      ],
      [
        'Request failed with status code <v>',
        'GAS',
        'CreateCase',
        '41',
        '12 Oct 2026 16:02'
      ],
      ['No error recorded', 'GAS', 'CreateCase', '23', '12 Oct 2026 11:17'],
      [
        'Status <v> is not a status of workflow <v>',
        'CW',
        'UpdateCaseStatus',
        '18',
        '13 Oct 2026 15:04'
      ]
    ])
    expect(
      part($, 'overview-top-error-row').first().find('a').attr('href')
    ).toBe(
      '/dev-ops/events/gas/inbox?status=DEAD_LETTER&error=Error%3A+Application+with+clientRef+%3Cv%3E+not+found&event=AgreementStatusUpdated'
    )
    expect(
      new URL(
        part($, 'overview-top-error-row').eq(3).find('a').attr('href')!,
        'http://app'
      ).searchParams.get('error')
    ).toBe('No error recorded')
  })

  test('links each box’s dead letters under the figures, over exactly the window they were counted in', async () => {
    const { $ } = await visit()
    const links = part($, 'overview-dead-letter-links').find('a')

    expect(links.toArray().map((link) => flatten($(link).text()))).toEqual([
      'GAS outbox: 6 dead letters, last 24 hours',
      'GAS inbox: 60 dead letters, last 24 hours',
      'CW outbox: 1 dead letter, last 24 hours',
      'CW inbox: 11 dead letters, last 24 hours'
    ])
    expect(flatten(part($, 'overview-dead-letters-note').text())).toBe(
      'Counted by when each event was created: when it was dead-lettered isn’t stored.'
    )
    expect(part($, 'overview-dead-letters-cw-inbox').attr('href')).toBe(
      '/dev-ops/events/cw/inbox?status=DEAD_LETTER&from=2026-10-12T15%3A00%3A00.000Z&to=2026-10-13T15%3A00%3A00.000Z'
    )
  })

  test('says Top errors are the current dead letters, never the last 24 hours', async () => {
    const { $ } = await visit()
    const section = part($, 'overview-top-errors')

    expect(flatten(section.find('.gpa-section-desc').text())).toBe(
      'Current dead letters grouped by message, both services, most first.'
    )
    expect(flatten(section.text())).not.toMatch(/24 hours/)
    expect(
      section
        .find('a')
        .toArray()
        .map((link) => $(link).attr('href'))
        .filter((href) => /[?&](from|to|range)=/.test(href ?? ''))
    ).toEqual([])
  })

  test('writes last seen on the Times setting', async () => {
    const { $ } = await visit('/dev-ops', 'dev-ops-times=uk')

    expect(rowCells($, 'overview-top-error-row')[0]![4]).toBe(
      '13 Oct 2026 15:53'
    )
  })

  test('draws no chart, and Top errors has no links of its own in its head', async () => {
    const { $ } = await visit()

    expect($('.gpa-chart')).toHaveLength(0)
    expect(
      part($, 'overview-top-errors').find('.gpa-section-head a')
    ).toHaveLength(0)
  })

  test('orders the page: the figures and their dead letters, Top errors, Config that failed, Access tokens expiring', async () => {
    const { $ } = await visit()

    expect(
      $(
        '[data-testid="overview-figures"], [data-testid="overview-dead-letters"], [data-testid="overview-top-errors"], [data-testid="overview-config"], [data-testid="overview-tokens"]'
      )
        .toArray()
        .map((el) => $(el).attr('data-testid'))
    ).toEqual([
      'overview-figures',
      'overview-dead-letters',
      'overview-top-errors',
      'overview-config',
      'overview-tokens'
    ])
  })

  test('lists the config that failed, each version opening its page', async () => {
    const { $ } = await visit()

    expect(rowCells($, 'overview-config-row')).toEqual([
      [
        'frps-private-beta@1.11.0',
        'GAS',
        'Grant',
        'Failed',
        '13 Oct 2026 09:12'
      ],
      ['woodland@2.1.0', 'CW', 'Workflow', 'Fetch error', '—']
    ])
    expect(part($, 'overview-config-row').first().find('a').attr('href')).toBe(
      '/dev-ops/grants/frps-private-beta/1.11.0'
    )
  })

  test.each([
    [
      'GAS',
      true,
      false,
      [
        [
          'GAS sent only the first 1 failed grant version.',
          'Find the rest in Grants',
          '/dev-ops/grants'
        ]
      ]
    ],
    [
      'CW',
      false,
      true,
      [
        [
          'CW sent only the first 1 failed workflow version.',
          'Find the rest in Workflows',
          '/dev-ops/workflows'
        ]
      ]
    ],
    [
      'both services',
      true,
      true,
      [
        [
          'GAS sent only the first 1 failed grant version.',
          'Find the rest in Grants',
          '/dev-ops/grants'
        ],
        [
          'CW sent only the first 1 failed workflow version.',
          'Find the rest in Workflows',
          '/dev-ops/workflows'
        ]
      ]
    ]
  ])(
    'says when %s sent only the first failed versions, linking its list',
    async (_, gas, cw, said) => {
      const configFailed = needsAttention.configFailed

      show({
        ...needsAttention,
        configFailed: {
          gas: read({ ...configFailed.gas.data!, more: gas }),
          cw: read({ ...configFailed.cw.data!, more: cw })
        }
      })

      const { $ } = await visit()

      expect(
        part($, 'overview-config')
          .find('[data-testid^="overview-config-more-"]')
          .toArray()
          .map((note) => [
            flatten($(note).find('.gpa-text-subtle').text()),
            flatten($(note).find('a').text()),
            $(note).find('a').attr('href')
          ])
      ).toEqual(said)
    }
  )

  test('says nothing more when each service sent every failed version', async () => {
    const { $ } = await visit()

    expect($('[data-testid^="overview-config-more-"]')).toHaveLength(0)
  })

  test('sizes the columns people scan to share the spare width, only the trailing date to its content', async () => {
    const { $ } = await visit()
    const cols = (testId: string) =>
      part($, testId).find('table').attr('data-gpa-cols')

    expect(cols('overview-top-errors-table')).toBe(
      'minmax(180px, 3fr) auto auto auto max-content var(--size-column-chevron)'
    )
    expect(cols('overview-config-table')).toBe(
      'auto auto auto auto var(--size-column-date) var(--size-column-chevron)'
    )
    expect(cols('overview-tokens-table')).toBe(
      'auto auto auto max-content var(--size-column-chevron)'
    )
  })

  test('lists the access tokens expiring, by the UK day, each opening on its tokens page', async () => {
    const { $ } = await visit('/dev-ops', 'dev-ops-times=utc')

    expect(rowCells($, 'overview-token-row')).toEqual([
      ['grants-ui', 'GAS', 'Expiring soon', '20 Oct 2026'],
      ['fg-gas-backend', 'CW', 'Expired', '1 Oct 2026']
    ])
    expect(part($, 'overview-token-row').first().find('a').attr('href')).toBe(
      '/dev-ops/clients/gas?token=grants-ui-token'
    )
  })

  test('sizes every table from its nonce’d style, with no inline style', async () => {
    const { $, headers } = await visit()

    expectTablesStyled($, headers['content-security-policy'])
    expect($('[style]')).toHaveLength(0)
  })
})

describe('all clear', () => {
  test('shows each section’s empty state, saying only what was read', async () => {
    show(allClear)

    const { $ } = await visit()
    const empty = (id: string) =>
      ['.gpa-empty-title', '.gpa-empty-body'].map((selector) =>
        flatten(part($, id).find(selector).first().text())
      )

    expect(figureValue($, 'overview-figure-dead-letters-gas')).toBe('0')
    expect(part($, 'overview-dead-letter-links')).toHaveLength(0)
    expect(flatten(part($, 'overview-dead-letters-note').text())).toBe(
      'Counted by when each event was created: when it was dead-lettered isn’t stored.'
    )
    expect(
      ['overview-top-errors', 'overview-config', 'overview-tokens'].map(empty)
    ).toEqual([
      [
        'No dead letters',
        'Nothing is waiting as a dead letter in either service.'
      ],
      [
        'Every active version is usable',
        'No active grant or workflow definition has failed.'
      ],
      [
        'No tokens expiring or expired',
        'Nothing expires in the next 30 days, and nothing has expired.'
      ]
    ])
  })

  test('says in each empty state what was read', async () => {
    show(allClear)

    const { $ } = await visit()

    expect(
      ['overview-top-errors', 'overview-config', 'overview-tokens'].map((id) =>
        part($, id)
          .find('.gpa-empty-title, .gpa-empty-body')
          .toArray()
          .map((element) => flatten($(element).text()))
      )
    ).toEqual([
      [
        'No dead letters',
        'Nothing is waiting as a dead letter in either service.'
      ],
      [
        'Every active version is usable',
        'No active grant or workflow definition has failed.'
      ],
      [
        'No tokens expiring or expired',
        'Nothing expires in the next 30 days, and nothing has expired.'
      ]
    ])
  })

  test('says the window GAS sent, in the empty state and the figure’s hint', async () => {
    show({
      ...allClear,
      tokensExpiring: {
        gas: read({ withinDays: 14, tokens: [] }),
        cw: read({ withinDays: 14, tokens: [] })
      }
    })

    const { $ } = await visit()

    expect(
      flatten(part($, 'overview-tokens').find('.gpa-empty-body').text())
    ).toBe('Nothing expires in the next 14 days, and nothing has expired.')
    expect(
      flatten(part($, 'overview-figure-tokens').find('.gpa-stat-hint').text())
    ).toBe('within 14 days, or expired')
  })
})

describe('a part that couldn’t be read', () => {
  const timedOut = { hop: 'CW-BE', reason: 'TIMED_OUT' } as const

  test.each([
    [
      'topErrors',
      'overview-top-errors-alert',
      'CW’s errors couldn’t be loaded.'
    ],
    [
      'deadLetters',
      'overview-dead-letters-alert',
      'CW’s dead letters couldn’t be loaded.'
    ],
    [
      'configFailed',
      'overview-config-alert',
      'CW’s workflow versions couldn’t be loaded.'
    ],
    [
      'tokensExpiring',
      'overview-tokens-alert',
      'CW’s access tokens couldn’t be loaded.'
    ]
  ] as const)(
    'says so where %s would be, and leaves the rest of the page',
    async (key, alertId, title) => {
      show({
        ...needsAttention,
        [key]: { ...needsAttention[key], cw: failed(timedOut) }
      })

      const { $, statusCode } = await visit()

      expect(statusCode).toBe(statusCodes.ok)
      expect(part($, alertId)).toHaveLength(1)
      expect(flatten(part($, alertId).text())).toContain(title)
      expect(flatten(part($, alertId).text())).toContain(
        'CW didn’t answer in time. The rest of the page is unaffected.'
      )
      expect(part($, 'overview-top-errors')).toHaveLength(1)
      expect(part($, 'overview-config')).toHaveLength(1)
      expect(part($, 'overview-tokens')).toHaveLength(1)
      expect($('[data-testid$="-alert"]')).toHaveLength(1)
    }
  )

  test('leaves its figure empty', async () => {
    show({
      ...needsAttention,
      deadLetters: { ...needsAttention.deadLetters, cw: failed(timedOut) }
    })

    const { $ } = await visit()

    expect(figureValue($, 'overview-figure-dead-letters-cw')).toBe('—')
  })

  test('draws no table when neither service’s part could be read', async () => {
    show({
      ...needsAttention,
      configFailed: {
        gas: failed({ hop: 'GAS', reason: 'ERRORED' }),
        cw: failed(timedOut)
      }
    })

    const { $ } = await visit()

    expect(part($, 'overview-config-table')).toHaveLength(0)
    expect(part($, 'overview-config-alert')).toHaveLength(2)
  })

  test('says a CW without access tokens with the tokens page’s wording, as a warning', async () => {
    show({
      ...needsAttention,
      tokensExpiring: {
        ...needsAttention.tokensExpiring,
        cw: failed({ hop: 'CW-BE', reason: 'NOT_OFFERED' })
      }
    })

    const { $ } = await visit()
    const alert = part($, 'overview-tokens-alert')

    expect(alert.hasClass('gpa-alert-warning')).toBe(true)
    expect(flatten(alert.text())).toContain(
      'This CW doesn’t offer access tokens.'
    )
    expect(rowCells($, 'overview-token-row')).toHaveLength(1)
  })
})

describe('the whole overview unread', () => {
  test('says so, with Try again, and answers 503', async () => {
    answer({ outcome: 'failed', failure: { kind: 'not-connected' } })

    const { $, statusCode } = await visit()

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(flatten(part($, 'overview-alert').text())).toContain(
      'The overview couldn’t be loaded.'
    )
    expect(flatten(part($, 'overview-alert').text())).toContain(
      'GAS couldn’t be reached.'
    )
    expect(part($, 'overview-retry').attr('href')).toBe('/dev-ops')
    expect(part($, 'overview-figures')).toHaveLength(0)
  })
})
