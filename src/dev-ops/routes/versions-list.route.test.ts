import Boom from '@hapi/boom'
import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import {
  fullCatalogue,
  grantsBucket,
  workflowsBucket
} from '../use-cases/test-fixtures.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import type { Catalogue } from '../use-cases/shell-catalogue.ts'
import type {
  BucketResult,
  BucketRow
} from '../repositories/buckets.repository.ts'
import type { ListAnswer, ListQuery } from '../repositories/lists.repository.ts'
import { queryList } from '../repositories/lists.repository.ts'
import { expectTablesStyled } from '../test-utils.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../repositories/lists.repository.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-10-13T15:20:00.000Z')

const catalogue: Catalogue = fullCatalogue

const versionRow =
  (kind: 'grant' | 'workflow') =>
  (
    code: string,
    version: string | null,
    definition = 'fetched'
  ): BucketRow => ({
    id: `${code}@${version}`,
    time: '2026-10-13T14:04:00.000Z',
    title: code,
    subtitle: null,
    cells: { version, definition, status: 'active' },
    link: version ? { kind, code, version } : null
  })

/** The two version lists, as GAS and CW declare them (grants.bucket.js, the workflows bucket). */
const lists = [
  {
    name: 'Grants',
    path: '/dev-ops/grants',
    id: grantsBucket.id,
    service: 'GAS',
    noun: 'grant versions',
    fact: 'grantCode',
    stored: 'worstFetchStatus',
    param: 'grant',
    chip: 'Grant',
    column: 'Grant',
    serviceName: 'Grant Application Service',
    row: versionRow('grant'),
    href: (code: string, version: string) =>
      `/dev-ops/grants/${code}/${version}`,
    tooltip: true
  },
  {
    name: 'Workflows',
    path: '/dev-ops/workflows',
    id: workflowsBucket.id,
    service: 'CW',
    noun: 'workflow versions',
    fact: 'grantCode',
    stored: 'fetchStatus',
    param: 'workflow',
    chip: 'Workflow',
    column: 'Workflow',
    serviceName: 'Caseworking',
    row: versionRow('workflow'),
    href: (code: string, version: string) =>
      `/dev-ops/workflows/${code}/${version}`,
    tooltip: false
  }
]

type List = (typeof lists)[number]

const exact = (
  list: List,
  overrides: Partial<BucketResult> = {}
): BucketResult => ({
  bucket: list.id,
  plan: {
    kind: 'exact',
    index: [list.fact],
    bound: [],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [
    list.row('woodland-creation', '1.4.2'),
    list.row('woodland-creation', null, 'permanent_error')
  ],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  ...overrides
})

const bounded = (list: List, page: Partial<BucketResult['page']>) =>
  exact(list, {
    plan: { ...exact(list).plan, kind: 'bounded' },
    page: {
      next: null,
      keepLooking: null,
      searchedTo: null,
      complete: false,
      ...page
    }
  })

type Reply = (ask: ListQuery) => Promise<ListAnswer>

/** GAS's answer for the list at the asked path, as `lists/query` answers it. */
const answered =
  (page: BucketResult): Reply =>
  async (ask) => ({
    shell: { catalogue },
    bucket: catalogue.buckets.find((bucket) => bucket.path === ask.path)!.id,
    list: {
      ...page,
      pageRows: [page.rows.length],
      stopped: null,
      refusedSearch: null
    }
  })

/** As @hapi/wreck rejects for GAS's answer, carrying its body. */
const rejected =
  (statusCode: number, body: object = {}): Reply =>
  async () => {
    throw new Boom.Boom(`Response Error: ${statusCode}`, {
      statusCode,
      data: {
        isResponseError: true,
        payload: { statusCode, ...body, shell: { catalogue } }
      }
    })
  }

const given = (reply: Reply) => {
  vi.mocked(queryList).mockImplementationOnce(reply)
}

let server: Server

const view = async (url: string, cookie = '') => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials },
    headers: {
      cookie: [cookie, 'dev-ops-times=utc'].filter(Boolean).join('; ')
    }
  })

  const $ = load(result as unknown as string)
  expectTablesStyled($, headers['content-security-policy'])

  return { $, statusCode }
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const headers = ($: CheerioAPI) =>
  by($, 'list-table')
    .find('th')
    .toArray()
    .map((th) => flat($(th).text()))

const rows = ($: CheerioAPI) =>
  by($, 'list-row')
    .toArray()
    .map((row) =>
      $(row)
        .find('td')
        .toArray()
        .map((td) => flat($(td).clone().find('.gpa-vh').remove().end().text()))
        .slice(0, 4)
    )

const tags = ($: CheerioAPI) =>
  by($, 'list-applied')
    .find('.gpa-tag')
    .toArray()
    .map((tag) => flat($(tag).find('.gpa-tag-label').text()))

const alertOf = ($: CheerioAPI) => ({
  tone: (by($, 'list-alert').attr('class') ?? '').match(/gpa-alert-(\w+)/)?.[1],
  title: flat(by($, 'list-alert').find('.gpa-alert-title').text()),
  body: flat(by($, 'list-alert').find('.gpa-alert-body > div').first().text())
})

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(shellCatalogue).mockReturnValue(catalogue)
  vi.mocked(queryList).mockReset()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe.each(lists)('the $name list', (list) => {
  test('loaded: the service under the title, one version column as code@version, Stored, Status and Received, each row opening its version', async () => {
    given(answered(exact(list)))

    const { $, statusCode } = await view(list.path)

    expect(statusCode).toBe(statusCodes.ok)
    expect(flat(by($, 'list-title').text())).toBe(list.name)
    expect(flat($('.gpa-pageheader-meta').text())).toBe(list.serviceName)
    expect(headers($)).toEqual([list.column, 'Stored', 'Status', 'Received'])
    expect(rows($)).toEqual([
      ['woodland-creation@1.4.2', 'Stored', 'Active', '13 Oct 2026 14:04'],
      ['woodland-creation', 'Failed', 'Active', '13 Oct 2026 14:04']
    ])
    expect(by($, 'list-row').first().find('a').attr('href')).toMatch(
      new RegExp(`^${list.href('woodland-creation', '1.4.2')}(\\?|$)`)
    )
    expect(by($, 'list-row').eq(1).find('.gpa-dot-danger')).toHaveLength(1)
  })

  test('loaded: the time first, then the chips in the prototype’s order, Stored named so, and no search field', async () => {
    given(answered(exact(list)))

    const { $ } = await view(list.path)

    expect(
      $('.gpa-filterbar .gpa-chip-label')
        .toArray()
        .map((label) => flat($(label).text()))
    ).toEqual(['Received:', `${list.chip}:`, 'Stored:', 'Status:'])
    expect(
      by($, `list-chip-${list.stored}`)
        .find('input[type="checkbox"]')
        .toArray()
        .map((box) => `${$(box).attr('name')}=${$(box).attr('value')}`)
    ).toContain('definition=fetched')
    expect(by($, 'list-search')).toHaveLength(0)
  })

  test('the tags follow the chips’ order', async () => {
    given(answered(exact(list)))

    const { $ } = await view(
      `${list.path}?status=active&status=draft&definition=permanent_error&definition=transient_error&${list.param}=woodland-creation&${list.param}=example-grant`
    )
    const chipLabels = $('[data-testid^="list-chip-"] .gpa-chip-label')
      .toArray()
      .map((label) => $(label).text().replace(':', '').trim())

    expect([...new Set(tags($).map((tag) => tag.split(' is ')[0]))]).toEqual(
      chipLabels.filter((label) =>
        tags($).some((tag) => tag.startsWith(`${label} is`))
      )
    )
    expect(tags($)).toHaveLength(6)
  })

  test('one Stored value: the chip says it, as the menu does, with no tag', async () => {
    given(answered(exact(list)))

    const { $ } = await view(`${list.path}?definition=permanent_error`)

    expect(
      by($, `list-chip-${list.stored}`).find('.gpa-chip-value').text()
    ).toBe('Failed')
    expect(tags($)).toEqual([])
  })

  test('two Stored values: 2 selected, a tag each in the menu’s order, and both asked for', async () => {
    given(answered(exact(list)))

    const { $ } = await view(
      `${list.path}?definition=permanent_error&definition=transient_error`
    )

    expect(
      by($, `list-chip-${list.stored}`).find('.gpa-chip-value').text()
    ).toBe('2 selected')
    expect(tags($)).toEqual(['Stored is Fetch error', 'Stored is Failed'])
    expect(vi.mocked(queryList).mock.calls.at(-1)?.[0].params).toEqual({
      definition: ['permanent_error', 'transient_error']
    })
  })

  test(`the Stored hint is in a tooltip only on the list the prototype gives one (${list.tooltip})`, async () => {
    given(answered(exact(list)))

    const { $ } = await view(list.path)

    expect(by($, 'list-row').first().find('gpa-tooltip')).toHaveLength(
      list.tooltip ? 1 : 0
    )
  })

  test('no matches: the prototype’s empty state', async () => {
    given(answered(exact(list, { rows: [] })))

    const { $ } = await view(`${list.path}?${list.param}=woodland-creation`)

    expect(flat($('.gpa-empty-title').text())).toBe(`No ${list.noun} match`)
    expect(flat($('.gpa-empty-body').text())).toBe(
      'Nothing received in this time range has this status and definition state.'
    )
  })

  test('a filter read that stopped early: where it stopped, and the way on', async () => {
    given(
      answered(
        bounded(list, {
          keepLooking: 'k1',
          searchedTo: '2026-10-06T14:00:00.000Z'
        })
      )
    )

    const { $ } = await view(`${list.path}?definition=pending`)

    expect(flat(by($, 'list-footer').find('a').text())).toBe('Keep looking')
  })

  test('a filter the service refused: its reason, and Start again', async () => {
    given(
      rejected(statusCodes.badRequest, {
        message: '"definition" must be one of [fetched, pending]'
      })
    )

    const { $ } = await view(`${list.path}?definition=pending`)

    expect(alertOf($).title).toBe(`${list.service} refused these filters.`)
    expect(by($, 'list-start-again').attr('href')).toBe(list.path)
  })

  test('nothing at all: says what would be here', async () => {
    given(answered(exact(list, { rows: [] })))

    const { $ } = await view(list.path)

    expect(flat($('.gpa-empty-body').text())).toBe(
      `Versions the config broker publishes to ${list.service} appear here.`
    )
  })
})
