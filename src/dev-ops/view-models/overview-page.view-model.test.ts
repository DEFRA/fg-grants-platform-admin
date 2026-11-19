import type { Catalogue } from '../use-cases/shell-catalogue.ts'
import type {
  Overview,
  OverviewResult,
  OverviewSourceError
} from '../use-cases/get-overview.use-case.ts'
import {
  allClear,
  cwConfigFailed,
  cwTokensExpiring,
  cwTopErrors,
  failed,
  gasConfigFailed,
  gasTokensExpiring,
  gasTopErrors,
  needsAttention,
  read,
  toDeadLetters
} from '../use-cases/overview-fixtures.ts'
import {
  toOverviewPage,
  toOverviewStatusCode,
  toPartAlert
} from './overview-page.view-model.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'
import { toTimes } from './times.ts'
import { toStoredDot } from './version-files.ts'

const utc = toTimes('utc')

const page = (
  overview: Overview,
  times = utc,
  catalogue: Catalogue | null = fullCatalogue
) => toOverviewPage({ outcome: 'read', overview }, { times, catalogue })

const sections = (
  overview: Overview,
  times = utc,
  catalogue: Catalogue | null = fullCatalogue
) => {
  const drawn = page(overview, times, catalogue).sections

  if (drawn === null) {
    throw new Error('no sections')
  }

  return drawn
}

const values = (overview: Overview) =>
  sections(overview).figures.map(({ value }) => value)

const timedOut: OverviewSourceError = { hop: 'CW-BE', reason: 'TIMED_OUT' }

describe('the figures', () => {
  test('count each service’s dead letters, the config that failed and the tokens expiring', () => {
    const { figures } = sections(needsAttention)

    expect(figures.map(({ label }) => label)).toEqual([
      'GAS dead letters, last 24 hours',
      'CW dead letters, last 24 hours',
      'Config versions that failed',
      'Access tokens expiring'
    ])
    expect(values(needsAttention)).toEqual(['66', '12', '2', '2'])
    expect(figures[3]!.hint).toBe('within 30 days, or expired')
  })

  test('say the window GAS counts expiring tokens over, as it sends it', () => {
    const overview: Overview = {
      ...needsAttention,
      tokensExpiring: {
        gas: read({ ...gasTokensExpiring, withinDays: 14 }),
        cw: read({ ...cwTokensExpiring, withinDays: 14 })
      }
    }

    expect(sections(overview).figures[3]!.hint).toBe(
      'within 14 days, or expired'
    )
  })

  test('say each service’s window when they differ, and none when no tokens were read', () => {
    const differ: Overview = {
      ...needsAttention,
      tokensExpiring: {
        ...needsAttention.tokensExpiring,
        cw: read({ ...cwTokensExpiring, withinDays: 1 })
      }
    }
    const unread: Overview = {
      ...needsAttention,
      tokensExpiring: { gas: failed(timedOut), cw: failed(timedOut) }
    }

    expect(sections(differ).figures[3]!.hint).toBe(
      'within 30 days for GAS and 1 day for CW, or expired'
    )
    expect(sections(unread).figures[3]!.hint).toBeNull()
  })

  test('draw each dead-letter figure’s two-hourly counts as its trend, saying what the line is', () => {
    const [gas, cw, config] = sections(needsAttention).figures

    expect(gas!.trend).toEqual([3, 1, 0, 2, 0, 0, 1, 0, 4, 18, 26, 11])
    expect(cw!.trend).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 1, 3, 5, 2])
    expect(gas!.trendLabel).toBe('Dead letters every two hours, last 24 hours')
    expect(config!.trend).toBeNull()
  })

  test('are all 0 with no trend when all is clear', () => {
    const { figures } = sections(allClear)

    expect(values(allClear)).toEqual(['0', '0', '0', '0'])
    expect(figures.map(({ trend }) => trend)).toEqual([null, null, null, null])
  })

  test('say a count the service stopped at its cap with a plus', () => {
    const overview: Overview = {
      ...needsAttention,
      deadLetters: {
        ...needsAttention.deadLetters,
        gas: read({
          ...toDeadLetters([10_000, ...Array(11).fill(0)]),
          capped: true
        })
      }
    }

    expect(values(overview)[0]).toBe('10,000+')
  })

  test('write the config count with a plus when a service sent only its first failed versions', () => {
    const cut = (gas: boolean, cw: boolean): Overview => ({
      ...needsAttention,
      configFailed: {
        gas: read({ ...gasConfigFailed, more: gas }),
        cw: read({ ...cwConfigFailed, more: cw })
      }
    })

    expect(values(cut(true, false))[2]).toBe('2+')
    expect(values(cut(false, true))[2]).toBe('2+')
    expect(values(cut(false, false))[2]).toBe('2')
  })

  test('leave a figure whose part couldn’t be read empty, never 0', () => {
    const overview: Overview = {
      ...needsAttention,
      deadLetters: { ...needsAttention.deadLetters, cw: failed(timedOut) },
      configFailed: { ...needsAttention.configFailed, gas: failed(timedOut) },
      tokensExpiring: { ...needsAttention.tokensExpiring, cw: failed(timedOut) }
    }

    expect(values(overview)).toEqual(['66', null, null, null])
    expect(sections(overview).figures[1]!.trend).toBeNull()
  })
})

describe('Top errors', () => {
  test('rank both services’ groups together, most first, and show five', () => {
    const { rows } = sections(needsAttention).topErrors

    expect(rows!.map(({ service, count }) => `${service} ${count}`)).toEqual([
      'GAS 214',
      'GAS 96',
      'GAS 41',
      'GAS 23',
      'CW 18'
    ])
  })

  test('name each group by its error, without the `Error: ` GAS keys it with, and its event, with when it was last seen on the Times clock', () => {
    const [first] = sections(needsAttention).topErrors.rows!
    const uk = sections(needsAttention, toTimes('uk')).topErrors.rows![0]!

    expect(first).toMatchObject({
      error: 'Application with clientRef <v> not found',
      event: 'AgreementStatusUpdated',
      lastSeen: {
        datetime: '2026-10-13T14:53:00Z',
        text: '13 Oct 2026 14:53'
      }
    })
    expect(uk.lastSeen!.text).toBe('13 Oct 2026 15:53')
  })

  test('open each group’s dead letters on the list’s own filters, with no time range: they are the current ones', () => {
    const [first] = sections(needsAttention).topErrors.rows!
    const href = new URL(first!.href!, 'http://app')

    expect(href.pathname).toBe('/dev-ops/events/gas')
    expect(Object.fromEntries(href.searchParams)).toEqual({
      queue: 'inbox',
      status: 'DEAD_LETTER',
      error: 'Error: Application with clientRef <v> not found',
      event: 'AgreementStatusUpdated',
      clear: 'all'
    })
  })

  test('name each group’s queue', () => {
    const rows = sections(needsAttention).topErrors.rows!

    expect(rows.map(({ queue }) => queue)).toEqual([
      'Inbox',
      'Outbox',
      'Outbox',
      'Outbox',
      'Inbox'
    ])
  })

  test('a group GAS lists no list for: drawn with no link and no queue', () => {
    const [row] = sections({
      ...allClear,
      topErrors: {
        gas: read({
          entries: [{ ...gasTopErrors.entries[1]!, list: null }],
          more: false,
          complete: true
        }),
        cw: read({ entries: [], more: false, complete: true })
      }
    }).topErrors.rows!

    expect(row).toMatchObject({
      href: null,
      queue: null,
      count: expect.any(String)
    })
  })

  test('name no queue when GAS’s answer carried no lists to read it from', () => {
    const rows = sections(needsAttention, utc, null).topErrors.rows!

    expect(rows.map(({ queue }) => queue)).toEqual([
      null,
      null,
      null,
      null,
      null
    ])
  })

  test('keep the dead letters that recorded no error as their own group, opening exactly those', () => {
    const row = sections(needsAttention).topErrors.rows![3]!

    expect(row.error).toBeNull()
    expect(new URL(row.href!, 'http://app').searchParams.get('error')).toBe(
      'No error recorded'
    )
  })

  test('is an empty list when nothing has failed for good', () => {
    expect(sections(allClear).topErrors).toMatchObject({
      rows: [],
      alerts: [],
      partial: null,
      empty: {
        title: 'No dead letters',
        text: 'Nothing is waiting as a dead letter in either service.'
      }
    })
  })

  test.each([
    ['gas', 'No CW dead letters', 'Nothing is waiting as a dead letter in CW.'],
    ['cw', 'No GAS dead letters', 'Nothing is waiting as a dead letter in GAS.']
  ] as const)(
    'says only what was read when %s’s errors couldn’t be',
    (unread, title, text) => {
      const overview: Overview = {
        ...allClear,
        topErrors: { ...allClear.topErrors, [unread]: failed(timedOut) }
      }

      expect(sections(overview).topErrors).toMatchObject({
        rows: [],
        empty: { title, text }
      })
    }
  )

  test('reach a service whose dead letters are all in its inbox, from its row', () => {
    const [inboxOnly] = gasTopErrors.entries
    const overview: Overview = {
      ...allClear,
      topErrors: {
        gas: read({ entries: [inboxOnly!], more: false, complete: true }),
        cw: read({ entries: [], more: false, complete: true })
      }
    }
    const { rows } = sections(overview).topErrors

    expect(
      rows!.map(({ href }) => new URL(href!, 'http://app').pathname)
    ).toEqual(['/dev-ops/events/gas'])
  })

  test('writes a capped group’s count with a plus', () => {
    const overview: Overview = {
      ...needsAttention,
      topErrors: {
        ...needsAttention.topErrors,
        gas: read({
          ...gasTopErrors,
          entries: [
            { ...gasTopErrors.entries[0]!, count: 100_000, capped: true }
          ]
        })
      }
    }

    expect(sections(overview).topErrors.rows![0]!.count).toBe('100,000+')
  })

  test('says when a service met more kinds of error than it counts', () => {
    const overview: Overview = {
      ...needsAttention,
      topErrors: {
        gas: read({ ...gasTopErrors, complete: false }),
        cw: read({ ...cwTopErrors, complete: false })
      }
    }

    expect(sections(overview).topErrors.partial).toBe(
      'GAS and CW met more kinds of error than they count, so this ranking may miss some.'
    )
  })

  test('keeps the service that answered when the other couldn’t be read, and says which', () => {
    const overview: Overview = {
      ...needsAttention,
      topErrors: { ...needsAttention.topErrors, cw: failed(timedOut) }
    }
    const { rows, alerts } = sections(overview).topErrors

    expect(rows!.map(({ service }) => service)).toEqual([
      'GAS',
      'GAS',
      'GAS',
      'GAS',
      'GAS'
    ])
    expect(alerts).toEqual([
      {
        tone: 'danger',
        title: 'CW’s errors couldn’t be loaded.',
        text: 'CW didn’t answer in time. The rest of the page is unaffected.'
      }
    ])
  })

  test('draws no table when neither service could be read', () => {
    const error: OverviewSourceError = { hop: 'GAS', reason: 'ERRORED' }
    const overview: Overview = {
      ...needsAttention,
      topErrors: { gas: failed(error), cw: failed(timedOut) }
    }
    const { rows, alerts, empty } = sections(overview).topErrors

    expect(rows).toBeNull()
    expect(empty).toBeNull()
    expect(alerts.map(({ title }) => title)).toEqual([
      'GAS’s errors couldn’t be loaded.',
      'CW’s errors couldn’t be loaded.'
    ])
  })
})

describe('the dead letters’ alerts beside the figures', () => {
  test('has no alerts when all is clear', () => {
    expect(sections(allClear).deadLetterAlerts).toEqual([])
  })

  test('says when one service is unread', () => {
    const overview: Overview = {
      ...needsAttention,
      deadLetters: {
        ...needsAttention.deadLetters,
        gas: failed({ hop: 'GAS', reason: 'UNREACHABLE' })
      }
    }

    expect(sections(overview).deadLetterAlerts).toEqual([
      {
        tone: 'danger',
        title: 'GAS’s dead letters couldn’t be loaded.',
        text: 'GAS couldn’t be reached. The rest of the page is unaffected.'
      }
    ])
  })
})

describe('Config that failed', () => {
  test('lists both services’ failed versions by name@version, each opening its version page', () => {
    const { rows } = sections(needsAttention).configFailed

    expect(rows).toEqual([
      {
        version: 'frps-private-beta@1.11.0',
        service: 'GAS',
        type: 'Grant',
        definition: { text: 'Failed', tone: 'danger' },
        received: expect.objectContaining({ text: '13 Oct 2026 09:12' }),
        href: '/dev-ops/grants/frps-private-beta/1.11.0'
      },
      {
        version: 'woodland@2.1.0',
        service: 'CW',
        type: 'Workflow',
        definition: { text: 'Fetch error', tone: 'warning' },
        received: null,
        href: '/dev-ops/workflows/woodland/2.1.0'
      }
    ])
  })

  test('draws each definition as the version pages draw its file', () => {
    const { rows } = sections(needsAttention).configFailed

    expect(rows!.map(({ definition }) => definition)).toEqual([
      toStoredDot({ stored: false, fetchStatus: 'permanent_error' }),
      toStoredDot({ stored: false, fetchStatus: 'transient_error' })
    ])
  })

  test('is an empty list when every active version is usable', () => {
    expect(sections(allClear).configFailed).toEqual({
      alerts: [],
      rows: [],
      empty: {
        title: 'Every active version is usable',
        text: 'No active grant or workflow definition has failed.'
      },
      more: []
    })
  })

  test.each([
    [
      'gas',
      'Every active workflow version is usable',
      'No active workflow definition has failed.'
    ],
    [
      'cw',
      'Every active grant version is usable',
      'No active grant definition has failed.'
    ]
  ] as const)(
    'says only what was read when %s’s versions couldn’t be',
    (unread, title, text) => {
      const overview: Overview = {
        ...allClear,
        configFailed: { ...allClear.configFailed, [unread]: failed(timedOut) }
      }

      expect(sections(overview).configFailed).toMatchObject({
        rows: [],
        empty: { title, text }
      })
    }
  )

  test('has no table to draw when neither service’s versions were read', () => {
    const overview: Overview = {
      ...allClear,
      configFailed: { gas: failed(timedOut), cw: failed(timedOut) }
    }

    expect(sections(overview).configFailed).toMatchObject({
      rows: null,
      empty: null
    })
  })

  const cutOverview = (gas: boolean, cw: boolean): Overview => ({
    ...needsAttention,
    configFailed: {
      gas: read({ ...gasConfigFailed, more: gas }),
      cw: read({ ...cwConfigFailed, more: cw })
    }
  })

  const grantsNote = {
    text: 'GAS sent only the first 1 failed grant version.',
    link: { text: 'Find the rest in Grants', href: '/dev-ops/grants' },
    testId: 'overview-config-more-gas'
  }

  const workflowsNote = {
    text: 'CW sent only the first 1 failed workflow version.',
    link: { text: 'Find the rest in Workflows', href: '/dev-ops/workflows' },
    testId: 'overview-config-more-cw'
  }

  test.each([
    ['GAS', true, false, [grantsNote]],
    ['CW', false, true, [workflowsNote]],
    ['both services', true, true, [grantsNote, workflowsNote]]
  ])(
    'says when %s sent only the first versions, linking the list to find the rest in',
    (_, gas, cw, notes) => {
      expect(sections(cutOverview(gas, cw)).configFailed.more).toEqual(notes)
    }
  )

  test('counts what a service sent, as the figures do', () => {
    const many = Array.from({ length: 1000 }, (_, index) => ({
      ...gasConfigFailed.versions[0]!,
      version: `1.0.${index}`
    }))
    const overview: Overview = {
      ...needsAttention,
      configFailed: {
        ...needsAttention.configFailed,
        gas: read({ versions: many, more: true })
      }
    }

    expect(sections(overview).configFailed.more[0]!.text).toBe(
      'GAS sent only the first 1,000 failed grant versions.'
    )
    expect(values(overview)[2]).toBe('1,001+')
  })

  test('keeps the grants when CW’s workflows couldn’t be read', () => {
    const overview: Overview = {
      ...needsAttention,
      configFailed: {
        ...needsAttention.configFailed,
        cw: failed({ hop: 'CW-BE', reason: 'UNREACHABLE' })
      }
    }
    const { rows, alerts } = sections(overview).configFailed

    expect(rows!.map(({ type }) => type)).toEqual(['Grant'])
    expect(alerts[0]).toEqual({
      tone: 'danger',
      title: 'CW’s workflow versions couldn’t be loaded.',
      text: 'CW couldn’t be reached. The rest of the page is unaffected.'
    })
  })
})

describe('Access tokens expiring', () => {
  test('lists both services’ tokens with their state and the UK day each expires, whatever Times says', () => {
    const { rows } = sections(needsAttention, utc).tokensExpiring

    expect(
      rows!.map(({ client, service, status, expires }) => [
        client,
        service,
        status.text,
        expires!.text
      ])
    ).toEqual([
      ['grants-ui', 'GAS', 'Expiring soon', '20 Oct 2026'],
      ['fg-gas-backend', 'CW', 'Expired', '1 Oct 2026']
    ])
  })

  test('draws a token the same whether or not it is in use, which a cached answer can’t say truly', () => {
    const inUse: Overview = {
      ...needsAttention,
      tokensExpiring: {
        ...needsAttention.tokensExpiring,
        gas: read({
          ...gasTokensExpiring,
          tokens: gasTokensExpiring.tokens.map((token) => ({
            ...token,
            inUse: true
          }))
        })
      }
    }

    expect(sections(inUse).tokensExpiring).toEqual(
      sections(needsAttention).tokensExpiring
    )
  })

  test('calls every active token GAS lists Expiring soon, one exactly 30 days out included, as GAS’s window takes it', () => {
    const dayThirty: Overview = {
      ...needsAttention,
      tokensExpiring: {
        ...needsAttention.tokensExpiring,
        gas: read({
          ...gasTokensExpiring,
          tokens: gasTokensExpiring.tokens.map((token) => ({
            ...token,
            expiresAt: '2026-11-12T23:59:59.000Z'
          }))
        })
      }
    }

    expect(sections(dayThirty).tokensExpiring.rows![0]!.status).toEqual({
      text: 'Expiring soon',
      tone: 'warning'
    })
  })

  test('opens each token on its service’s tokens page', () => {
    expect(sections(needsAttention).tokensExpiring.rows![1]!.href).toBe(
      '/dev-ops/clients/cw?token=fg-gas-backend-token'
    )
  })

  test('is an empty list when nothing expires within 30 days', () => {
    expect(sections(allClear).tokensExpiring).toMatchObject({
      rows: [],
      empty: {
        title: 'No tokens expiring or expired',
        text: 'Nothing expires in the next 30 days, and nothing has expired.'
      }
    })
  })

  test('says the window GAS sent in its empty state', () => {
    const overview: Overview = {
      ...allClear,
      tokensExpiring: {
        gas: read({ withinDays: 7, tokens: [] }),
        cw: read({ withinDays: 7, tokens: [] })
      }
    }

    expect(sections(overview).tokensExpiring.empty!.text).toBe(
      'Nothing expires in the next 7 days, and nothing has expired.'
    )
  })

  test.each([
    [
      'gas',
      'No CW tokens expiring or expired',
      'Nothing in CW expires in the next 30 days, and nothing has expired.'
    ],
    [
      'cw',
      'No GAS tokens expiring or expired',
      'Nothing in GAS expires in the next 30 days, and nothing has expired.'
    ]
  ] as const)(
    'says only what was read when %s’s tokens couldn’t be',
    (unread, title, text) => {
      const overview: Overview = {
        ...allClear,
        tokensExpiring: {
          ...allClear.tokensExpiring,
          [unread]: failed(timedOut)
        }
      }

      expect(sections(overview).tokensExpiring).toMatchObject({
        rows: [],
        empty: { title, text }
      })
    }
  )

  test('has no table to draw when neither service’s tokens were read', () => {
    const overview: Overview = {
      ...needsAttention,
      tokensExpiring: { gas: failed(timedOut), cw: failed(timedOut) }
    }

    expect(sections(overview).tokensExpiring).toMatchObject({
      rows: null,
      empty: null
    })
  })
})

describe('toPartAlert', () => {
  test.each([
    ['UNREACHABLE', 'GAS', 'GAS couldn’t be reached.'],
    ['TIMED_OUT', 'GAS', 'GAS didn’t answer in time.'],
    ['ERRORED', 'GAS', 'GAS answered with an error.'],
    ['UNREACHABLE', 'CW-BE', 'CW couldn’t be reached.'],
    ['ERRORED', 'CW-BE', 'CW answered with an error.']
  ] as const)('says %s from %s', (reason, hop, said) => {
    expect(toPartAlert('topErrors', 'cw', { hop, reason }).text).toBe(
      `${said} The rest of the page is unaffected.`
    )
  })
})

describe('the page', () => {
  const unread = (result: OverviewResult) =>
    toOverviewPage(result, { times: utc, catalogue: fullCatalogue })

  test('is the Overview of both services', () => {
    expect(page(needsAttention)).toMatchObject({
      pageTitle: 'Overview',
      meta: ['Grant Application Service and Caseworking'],
      navActive: 'overview',
      alert: null
    })
  })

  test.each([
    [{ kind: 'not-connected' }, 'GAS couldn’t be reached.'],
    [{ kind: 'cw-not-reached' }, 'CW couldn’t be reached.'],
    [
      { kind: 'refused', statusCode: 400, errorCode: null },
      'GAS refused the request.'
    ],
    [{ kind: 'errored' }, 'GAS answered with an error.'],
    [{ kind: 'timed-out' }, 'GAS didn’t answer in time.'],
    [{ kind: 'no-answer' }, 'GAS didn’t answer in time.']
  ] as const)(
    'says it couldn’t be loaded when GAS gives %o, with Try again',
    (failure, said) => {
      const result: OverviewResult = { outcome: 'failed', failure }
      const drawn = unread(result)

      expect(drawn.sections).toBeNull()
      expect(drawn.alert).toMatchObject({
        tone: 'danger',
        title: 'The overview couldn’t be loaded.',
        retryHref: '/dev-ops'
      })
      expect(drawn.alert!.text.startsWith(said)).toBe(true)
      expect(toOverviewStatusCode(result)).toBe(503)
    }
  )

  test('answers 200 when GAS answered, whatever its parts say', () => {
    expect(
      toOverviewStatusCode({ outcome: 'read', overview: needsAttention })
    ).toBe(200)
  })
})
