import Boom from '@hapi/boom'
import { load, type CheerioAPI } from 'cheerio'
import type { Request, Server } from '@hapi/hapi'
import type { OidcToken } from '@defra/hapi-auth-oidc'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { expectTablesStyled } from '../test-utils.ts'
import type {
  ExploreAnswer,
  ExploreFailure,
  Explored,
  Vocabulary
} from '../use-cases/explore-calls.ts'
import type { ExplorePageData } from '../use-cases/explore-page.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import type { ExploreOwner } from '../use-cases/held-runs.ts'
import { runExploreUseCase } from '../use-cases/run-explore.use-case.ts'
import type { ExploredList } from '../use-cases/run-explore.use-case.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'
import {
  restoreExploreUseCase,
  viewExploreUseCase
} from '../use-cases/view-explore.use-case.ts'

vi.mock(import('../use-cases/view-explore.use-case.ts'))
vi.mock(import('../use-cases/run-explore.use-case.ts'))
vi.mock(import('../use-cases/shell-catalogue.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b'

const runHref = `/dev-ops/explore?run=${id}`

const applications = (
  overrides: Partial<ExploreAnswer> = {}
): ExploreAnswer => ({
  source: { name: 'applications', noun: 'application' },
  mode: 'rows',
  read: 'exact',
  columns: [
    { key: 'c0', label: 'Reference', kind: 'text', aggregate: false },
    { key: 'c1', label: 'Grant', kind: 'text', aggregate: false },
    { key: 'c2', label: 'Status', kind: 'text', aggregate: false },
    { key: 'c3', label: 'Created', kind: 'date', aggregate: false }
  ],
  rows: [
    {
      open: { kind: 'application', code: 'woodland', ref: 'wmp-aa1-bb2' },
      cells: {
        c0: 'wmp-aa1-bb2',
        c1: 'woodland',
        c2: 'IN_REVIEW',
        c3: '2026-10-13T14:53:00.000Z'
      }
    }
  ],
  count: { n: 1, capped: false },
  groups: false,
  unwound: false,
  partial: false,
  window: null,
  unseen: [],
  ...overrides
})

const vocabulary: Vocabulary = {
  sources: [
    {
      name: 'applications',
      label: 'Applications, in the Grant Application Service',
      time: 'createdAt',
      paths: [
        { path: 'clientRef', type: 'text', indexed: true },
        { path: 'phases.answers.area', type: 'number', indexed: false },
        { path: 'createdAt', type: 'date', indexed: true },
        {
          path: 'phases.answers.agentDeclaration',
          type: 'boolean',
          indexed: false
        },
        { path: 'metadata', indexed: false },
        {
          path: 'currentStatus',
          type: 'text',
          indexed: false,
          values: [
            { value: 'IN_REVIEW', label: 'In review' },
            { value: 'APPROVED', label: 'Approved' }
          ]
        }
      ]
    }
  ]
}

const windowed = (
  window: ExploreAnswer['window'],
  rows: ExploreAnswer['rows'] = applications().rows
) => applications({ read: 'windowed', count: null, rows, window })

const typed =
  "db.applications.find(\n  { grant: 'woodland' },\n  { ref: 1, grant: 1, status: 1, created: 1 }\n)"

const read = (answer: ExploreAnswer): Explored<ExploreAnswer> => ({
  outcome: 'read',
  answer
})

const failed = (failure: ExploreFailure): Explored<ExploreAnswer> => ({
  outcome: 'failed',
  failure
})

const editorPage = (
  overrides: Partial<ExplorePageData> = {}
): ExplorePageData => ({
  q: 'db.applications.find()',
  run: null,
  result: null,
  previous: null,
  notice: null,
  recent: [],
  vocabulary,
  ...overrides
})

const runPage = (
  result: Explored<ExploreAnswer>,
  overrides: Partial<ExplorePageData> = {}
): ExplorePageData =>
  editorPage({ q: typed, run: { id, page: 1 }, result, ...overrides })

/** What the GET's use case answers with, as a page. */
const showing = (page: ExplorePageData) => {
  vi.mocked(viewExploreUseCase).mockResolvedValue({ kind: 'page', page })
}

/** What the POST's use case answers with, as a page. */
const answering = (page: ExplorePageData) => {
  vi.mocked(runExploreUseCase).mockResolvedValue({ kind: 'page', page })
}

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

const withTimes = (cookie: string) =>
  [cookie, 'dev-ops-times=utc'].filter(Boolean).join('; ')

const view = async (url = '/dev-ops/explore', cookie = '') => {
  const { payload, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials },
    headers: { cookie: withTimes(cookie) }
  })

  const $ = load(payload)
  expectTablesStyled($, headers['content-security-policy'])

  return {
    $,
    payload,
    statusCode,
    headers,
    location: headers.location,
    cookie: cookieOf(headers['set-cookie']) || cookie
  }
}

const post = async (
  payload: Record<string, string>,
  cookie = '',
  url = '/dev-ops/explore',
  headers?: Record<string, string>
) => {
  const response = await server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials },
    headers: {
      cookie: withTimes(cookie),
      'sec-fetch-site': 'same-origin',
      ...headers
    }
  })

  return {
    $: load(response.payload),
    payload: response.payload,
    statusCode: response.statusCode,
    headers: response.headers,
    location: response.headers.location,
    cookie: cookieOf(response.headers['set-cookie']) || cookie
  }
}

/** Shows a run of the answer, as the GET's use case reads it. */
const ran = async (
  answer: ExploreAnswer,
  overrides: Partial<ExplorePageData> = {}
) => {
  showing(runPage(read(answer), overrides))

  return view(runHref)
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

/** The words a part shows, one element's text kept apart from the next. */
const textOf = ($: CheerioAPI, testId: string) =>
  flat(load((by($, testId).html() ?? '').replace(/></g, '> <')).text())

const rowsOf = ($: CheerioAPI) =>
  by($, 'explore-row')
    .toArray()
    .map((row) =>
      $(row)
        .find('td')
        .toArray()
        .map((cell) => flat($(cell).text()))
        .filter(Boolean)
    )

const wayInOf = (call = 0) =>
  vi.mocked(runExploreUseCase).mock.calls[call][0].wayIn

const ownersOf = () => [
  ...vi.mocked(viewExploreUseCase).mock.calls.map(([{ owner }]) => owner),
  ...vi.mocked(runExploreUseCase).mock.calls.map(([{ owner }]) => owner)
]

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(shellCatalogue).mockReturnValue(fullCatalogue)
  showing(editorPage())
  vi.mocked(runExploreUseCase).mockResolvedValue({ kind: 'held', id })
})

afterAll(async () => {
  await server.stop()
})

describe('Explore, first opened', () => {
  test('shows the editor holding the query the use case gives, with no run', async () => {
    const { $, statusCode } = await view()

    expect(statusCode).toBe(statusCodes.ok)
    expect(viewExploreUseCase).toHaveBeenCalledExactlyOnceWith({
      owner: expect.objectContaining({ user: credentials.user.id }),
      run: null,
      page: 1
    })
    expect(textOf($, 'explore-title')).toBe('Explore')
    expect($('title').text()).toBe('Explore – Grants Platform')
    expect($('#q').val()).toBe('db.applications.find()')
    expect(by($, 'explore-results')).toHaveLength(0)
  })
})

describe('the editor', () => {
  const vocabularyOf = ($: CheerioAPI) =>
    JSON.parse($('gpa-query-editor').attr('data-vocabulary') ?? 'null')

  test('is the query editor in a form posting to Explore, with Run its submit', async () => {
    const { $ } = await view()
    const form = by($, 'explore-form')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe('/dev-ops/explore')
    expect(form.find('gpa-query-editor textarea#q').attr('name')).toBe('q')
    expect($('#q').attr('aria-label')).toBe('Query')
    expect($('#q').attr('aria-describedby')).toBeUndefined()
    expect(form.find(by($, 'explore-run')).attr('type')).toBe('submit')
  })

  test('suggests the paths of the sources the use case gives, closed paths with their stored values and labels, open to any other path, and never anything', async () => {
    const { $ } = await view()

    expect(vocabularyOf($)).toEqual({
      sources: [
        {
          name: 'applications',
          detail: 'Applications, in the Grant Application Service',
          fields: [
            { name: 'clientRef', detail: 'Text, indexed' },
            { name: 'phases.answers.area', detail: 'Number', type: 'number' },
            { name: 'createdAt', detail: 'Date, indexed', type: 'date' },
            {
              name: 'phases.answers.agentDeclaration',
              detail: 'True or false',
              type: 'flag'
            },
            { name: 'metadata', detail: 'Stored value' },
            {
              name: 'currentStatus',
              detail: 'Text',
              values: [
                { value: 'IN_REVIEW', label: 'In review' },
                { value: 'APPROVED', label: 'Approved' }
              ]
            }
          ]
        }
      ],
      anything: false,
      open: true
    })
  })

  test('asks for no values, so nothing typed is ever sent while typing', async () => {
    const { $ } = await view()

    expect($('gpa-query-editor').attr('data-values-action')).toBeUndefined()
    expect($('gpa-query-editor').attr('data-values-url')).toBeUndefined()
  })

  test('still opens when GAS can’t give the vocabulary, suggesting nothing', async () => {
    showing(editorPage({ vocabulary: null }))

    const { $, statusCode } = await view()

    expect(statusCode).toBe(statusCodes.ok)
    expect(vocabularyOf($)).toEqual({
      sources: [],
      anything: false,
      open: true
    })
  })

  test('has the run keys and Clear under it, a button that submits nothing', async () => {
    const { $ } = await view()
    const tools = $('gpa-query-editor .gpa-qe-foot')
    const buttons = tools.find('button').toArray()

    expect(
      tools
        .find('.gpa-qe-hint')
        .children()
        .toArray()
        .map((part) => flat($(part).text()))
    ).toEqual(['⌘Enter', 'or', 'CtrlEnter'])
    expect(flat(tools.find('.gpa-qe-hint').text())).toMatch(/ to run$/)
    expect(buttons.map((button) => flat($(button).text()))).toEqual(['Clear'])
    expect(buttons.map((button) => $(button).attr('type'))).toEqual(['button'])
  })

  test('takes the shell’s Times opener and refuses any other address', async () => {
    expect((await view('/dev-ops/explore?times=open')).statusCode).toBe(
      statusCodes.ok
    )
    expect((await view('/dev-ops/explore?q=db')).statusCode).toBe(
      statusCodes.badRequest
    )
  })
})

describe('Explore in the sidebar', () => {
  test('is under Overview, with the telescope, current on its page', async () => {
    const { $ } = await view()
    const links = by($, 'shell-nav')
      .find('.gpa-sidebar-section')
      .first()
      .find('a')

    expect(links.toArray().map((link) => flat($(link).text()))).toEqual([
      'Overview',
      'Explore'
    ])
    expect(links.eq(1).attr('href')).toBe('/dev-ops/explore')
    expect(links.eq(1).find('svg').attr('data-icon')).toBe('telescope')
    expect(links.eq(1).attr('aria-current')).toBe('page')
  })

  test('is current on the page for an Explore address it can’t read', async () => {
    const { $, statusCode } = await view('/dev-ops/explore?run=nope&page=-1')

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(flat(by($, 'status-bad-request').find('h1').text())).toBe(
      'This link doesn’t work'
    )
    expect(by($, 'shell-nav').find('[aria-current="page"]').attr('href')).toBe(
      '/dev-ops/explore'
    )
  })
})

const runId = /^\/dev-ops\/explore\?run=[0-9a-f-]{36}$/

describe('running a typed query', () => {
  test('sends the query as posted, and redirects to the run it holds, with no query in the address', async () => {
    const posted = await post({ q: typed })

    expect(runExploreUseCase).toHaveBeenCalledExactlyOnceWith({
      owner: expect.objectContaining({ user: credentials.user.id }),
      wayIn: { kind: 'typed', q: typed }
    })
    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(runHref)
    expect(posted.location).toMatch(runId)
  })

  test('leaves a form’s CRLF line breaks to the use case, which lines GAS’s places up with the editor’s text', async () => {
    await post({ q: typed.replaceAll('\n', '\r\n') })

    expect(wayInOf()).toEqual({
      kind: 'typed',
      q: typed.replaceAll('\n', '\r\n')
    })
  })

  test('shows the held query when its run is shown, with the text back in the editor', async () => {
    const { $, statusCode } = await ran(applications())

    expect(viewExploreUseCase).toHaveBeenCalledExactlyOnceWith({
      owner: expect.objectContaining({ user: credentials.user.id }),
      run: id,
      page: 1
    })
    expect(statusCode).toBe(statusCodes.ok)
    expect($('#q').val()).toBe(typed)
    expect(rowsOf($)).toEqual([
      ['wmp-aa1-bb2', 'woodland', 'IN_REVIEW', '13 Oct 2026 14:53']
    ])
  })

  test('shows the count and Download CSV above the table: a post of the run alone', async () => {
    const { $ } = await ran(applications())
    const form = $(`#${by($, 'explore-csv').attr('form')}`)

    expect(textOf($, 'explore-count')).toBe('1 application')
    expect(by($, 'explore-count').attr('role')).toBe('status')
    expect(by($, 'explore-count').attr('id')).toBe('explore-count')
    expect(by($, 'explore-count').attr('data-load-more-count')).toBe('')
    expect(by($, 'explore-csv').attr('type')).toBe('submit')
    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe('/dev-ops/explore.csv')
    expect(
      form
        .find('input')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    ).toEqual([['run', id]])
  })

  test.each([
    [
      ['phases.answers.buisness'],
      'Explore hasn’t seen this path in any record’s definition: phases.answers.buisness'
    ],
    [
      ['metadata.x', 'phases.answers.y'],
      'Explore hasn’t seen these paths in any record’s definition: metadata.x, phases.answers.y'
    ]
  ])(
    'says above the table which paths no definition names: %j',
    async (unseen, text) => {
      const { $ } = await ran(applications({ unseen }))

      expect(textOf($, 'explore-unseen')).toBe(text)
    }
  )

  test('says nothing of paths when every one is named by a definition', async () => {
    const { $ } = await ran(applications())

    expect(by($, 'explore-unseen')).toHaveLength(0)
  })

  test('opens each row’s record, coming back to the run and landing on the row', async () => {
    const { $ } = await ran(applications())

    expect(by($, 'explore-row').attr('id')).toBe('row-1-1')
    expect(by($, 'explore-row').find('a').attr('href')).toBe(
      `/dev-ops/applications/woodland/wmp-aa1-bb2?back=${encodeURIComponent(`${runHref}#row-1-1`)}`
    )
  })

  test('shows no cell in mono, opens the record from anywhere in the row, and leaves widths to the table', async () => {
    const { $ } = await ran(applications())
    const table = by($, 'explore-table')

    expect(by($, 'explore-row').find('td.gpa-cell-mono')).toHaveLength(0)
    expect($('gpa-data-table').is('[data-sticky]')).toBe(true)
    expect(table.find('table').attr('data-gpa-cols')).toBe(
      [
        'minmax(max-content, 1fr)',
        'minmax(120px, 1fr)',
        'minmax(120px, 1fr)',
        'minmax(120px, 1fr)',
        'var(--size-column-chevron)'
      ].join(' ')
    )
  })

  test('says a query GAS refuses at the field, where it is, and holds nothing', async () => {
    const error = {
      message: 'applications has no field colour',
      at: 25,
      end: 31
    }
    const q = 'db.applications.find({ colour: 1 })'

    answering(editorPage({ q, result: failed({ kind: 'invalid', error }) }))

    const { $, statusCode, location } = await post({ q })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(location).toBeUndefined()
    expect($('#q').val()).toBe(q)
    expect($('#q').attr('aria-invalid')).toBe('true')
    expect(
      JSON.parse($('gpa-query-editor').attr('data-error') ?? '{}')
    ).toEqual(error)
    expect(flat($('#q-msg').text())).toBe('applications has no field colour')
    expect($('#q').attr('aria-describedby')).toBe('q-msg')
    expect(by($, 'explore-recent')).toHaveLength(0)
  })

  test('says a query over 4,000 characters at the field, from where it goes over', async () => {
    const q = `db.applications.find({ business: '${'x'.repeat(4000)}' })`
    const error = {
      message: 'Shorten the query to 4,000 characters or fewer.',
      at: 4000,
      end: q.length
    }

    answering(editorPage({ q, result: failed({ kind: 'invalid', error }) }))

    const { $, statusCode } = await post({ q })

    expect(wayInOf()).toEqual({ kind: 'typed', q })
    expect(statusCode).toBe(statusCodes.badRequest)
    expect(
      JSON.parse($('gpa-query-editor').attr('data-error') ?? '{}')
    ).toEqual(error)
  })
})

const partIds = [
  'explore-title',
  'explore-queries',
  'explore-alert',
  'explore-editor',
  'explore-unseen',
  'explore-table'
]

/** What the table's frame holds above its rows: the toolbar, by what it holds, then the header. */
const frameOf = ($: CheerioAPI) =>
  by($, 'explore-table')
    .children('.gpa-table-toolbar, table')
    .toArray()
    .map((part) =>
      $(part).is('table') ? 'header' : $(part).children().attr('data-testid')
    )

/** The page's parts top to bottom, the results bar's, the table's frame, and what is made to stick. */
const layoutOf = ($: CheerioAPI) => {
  const page = $('.gpa-page')
  return {
    order: page
      .find('[data-testid]')
      .toArray()
      .map((part) => $(part).attr('data-testid')!)
      .filter((part) => partIds.includes(part)),
    bar: by($, 'explore-bar')
      .children('[data-testid]')
      .toArray()
      .map((part) => $(part).attr('data-testid')),
    frame: frameOf($),
    stickyTop: $('.gpa-listpage, .gpa-listpage-top').length,
    tableHeads: page.find('.gpa-thead').length
  }
}

const resultsLayout = {
  order: [
    'explore-title',
    'explore-queries',
    'explore-editor',
    'explore-table'
  ],
  bar: ['explore-count', 'explore-csv'],
  frame: ['explore-bar', 'header'],
  stickyTop: 0,
  tableHeads: 1
}

describe('the page’s layout', () => {
  test('is the title and Queries, then the editor, before a run', async () => {
    const { $ } = await view()

    expect(layoutOf($)).toEqual({
      order: ['explore-title', 'explore-queries', 'explore-editor'],
      bar: [],
      frame: [],
      stickyTop: 0,
      tableHeads: 0
    })
  })

  test('puts the count and Download CSV in the table’s toolbar, which sticks with its header, the count at the start', async () => {
    const { $ } = await ran(applications())

    expect(layoutOf($)).toEqual(resultsLayout)
    expect(by($, 'explore-bar').hasClass('gpa-justify-between')).toBe(true)
    expect($('.gpa-justify-end')).toHaveLength(0)
  })

  test('says the unseen paths over the table’s frame, not in the toolbar that sticks', async () => {
    const { $ } = await ran(applications({ unseen: ['answers.colour'] }))

    expect(layoutOf($)).toEqual({
      ...resultsLayout,
      order: [
        'explore-title',
        'explore-queries',
        'explore-editor',
        'explore-unseen',
        'explore-table'
      ]
    })
  })

  test('puts Download CSV alone at the end of the toolbar for a count, whose cell says it', async () => {
    const { $ } = await ran(
      applications({
        mode: 'count',
        columns: [
          { key: 'c0', label: 'count', kind: 'number', aggregate: true }
        ],
        rows: [{ open: null, cells: { c0: 12 } }]
      })
    )

    expect(layoutOf($)).toEqual({ ...resultsLayout, bar: ['explore-csv'] })
    expect(by($, 'explore-bar').hasClass('gpa-justify-end')).toBe(true)
  })

  test('puts the count of nothing over the empty table', async () => {
    const { $ } = await ran(
      applications({ rows: [], count: { n: 0, capped: false } })
    )

    expect(layoutOf($)).toEqual(resultsLayout)
  })

  test.each([
    [
      'refused',
      {
        kind: 'refused',
        service: 'GAS',
        message: 'Too many records to count.'
      } as const
    ],
    ['an error', { kind: 'errored', service: 'GAS' } as const]
  ])(
    'puts the message under the title when the run is %s, with the editor under it',
    async (_, failure) => {
      showing(runPage(failed(failure)))

      const { $ } = await view(runHref)

      expect(layoutOf($)).toEqual({
        order: [
          'explore-title',
          'explore-queries',
          'explore-alert',
          'explore-editor'
        ],
        bar: [],
        frame: [],
        stickyTop: 0,
        tableHeads: 0
      })
    }
  )

  test('keeps the results bar over the table when a window ended early', async () => {
    const { $ } = await ran(
      applications({
        read: 'windowed',
        count: null,
        partial: true,
        window: {
          to: '2026-10-05T08:30:00.000Z',
          end: false,
          positions: 'early',
          skipped: 1
        }
      })
    )

    expect(textOf($, 'explore-count')).toBe('1 application found so far')
    expect(layoutOf($)).toEqual(resultsLayout)
  })

  test.each([
    ['in place', { 'x-requested-with': 'gpa-load-more' }],
    ['without script', undefined]
  ])(
    'keeps what has been found so far over the table on Keep looking’s answer %s',
    async (_, headers) => {
      answering(
        runPage(
          read(
            windowed({
              to: '2026-10-01T00:00:00.000Z',
              end: false,
              positions: 'after-second'
            })
          ),
          {
            run: { id, page: 2 },
            previous: {
              positions: 'after-first',
              end: false,
              found: 1,
              source: { name: 'applications', noun: 'application' }
            }
          }
        )
      )

      const { $ } = await post(
        { run: id, page: '2' },
        '',
        '/dev-ops/explore',
        headers
      )

      expect(textOf($, 'explore-count')).toBe('2 applications found so far')
      expect(
        by($, 'explore-footer').closest('[data-count-id]').attr('data-count-id')
      ).toBe('explore-count')
      expect(layoutOf($)).toEqual(resultsLayout)
    }
  )
})

describe('the count line', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, () => applications().rows[0])

  test.each([
    ['one', applications(), '1 application'],
    [
      'the total',
      applications({ rows: rows(4), count: { n: 4, capped: false } }),
      '4 applications'
    ],
    [
      'the first of more',
      applications({ rows: rows(50), count: { n: 276, capped: false } }),
      '276 applications, the first 50'
    ],
    [
      'a capped count',
      applications({ rows: rows(50), count: { n: 10000, capped: true } }),
      '10,000+ applications, the first 50'
    ],
    [
      'a LIMIT over the cap, as the first of the rows it shows',
      applications({
        rows: rows(50),
        count: { n: 6000, capped: false }
      }),
      '6,000 applications, the first 50'
    ],
    [
      'a LIMIT over the cap that shows every row, as all of them',
      applications({
        rows: rows(20),
        count: { n: 20, capped: false }
      }),
      '20 applications'
    ],
    [
      'unwound rows',
      applications({
        rows: rows(50),
        unwound: true,
        count: { n: 812, capped: false }
      }),
      '812 rows, the first 50'
    ],
    [
      'groups',
      applications({
        rows: rows(4),
        mode: 'groups',
        groups: true,
        count: { n: 4, capped: false }
      }),
      '4 groups'
    ],
    [
      'groups cut by LIMIT',
      applications({
        rows: rows(50),
        mode: 'groups',
        groups: true,
        count: { n: 13285, capped: false, groups: 159 }
      }),
      '159 groups, the first 50'
    ],
    [
      'one group',
      applications({
        rows: rows(1),
        mode: 'groups',
        groups: true,
        count: { n: 3, capped: false, groups: 1 }
      }),
      '1 group'
    ],
    [
      'every group of a LIMIT over the cap, as all of them',
      applications({
        rows: rows(20),
        mode: 'groups',
        groups: true,
        count: { n: 9000, capped: false, groups: 20 }
      }),
      '20 groups'
    ],
    [
      'distinct values',
      applications({
        mode: 'distinct',
        rows: rows(2),
        groups: true,
        count: { n: 40, capped: false, groups: 2 }
      }),
      '2 values'
    ],
    [
      'distinct values cut by LIMIT',
      applications({
        mode: 'distinct',
        rows: rows(50),
        groups: true,
        count: { n: 900, capped: false, groups: 77 }
      }),
      '77 values, the first 50'
    ],
    [
      'a full read',
      applications({
        read: 'full',
        rows: rows(2),
        count: { n: 2, capped: false }
      }),
      '2 applications'
    ],
    [
      'a window',
      windowed({
        to: '2026-10-01T00:00:00.000Z',
        end: false,
        positions: 'p'
      }),
      '1 application found so far'
    ]
  ])('says %s', async (_, answer, count) => {
    const { $ } = await ran(answer)

    expect(textOf($, 'explore-count')).toBe(count)
  })

  test('is left out for a count, whose one cell says it, capped as GAS writes it', async () => {
    const { $ } = await ran(
      applications({
        mode: 'count',
        columns: [
          { key: 'c0', label: 'Count', kind: 'number', aggregate: true }
        ],
        rows: [{ open: null, cells: { c0: '10,000+' } }],
        count: { n: 10000, capped: true }
      })
    )

    expect(by($, 'explore-count')).toHaveLength(0)
    expect(by($, 'explore-csv')).toHaveLength(1)
    expect(rowsOf($)).toEqual([['10,000+']])
    expect(by($, 'explore-row').find('td').first().hasClass('gpa-right')).toBe(
      true
    )
    expect(by($, 'explore-row').find('a')).toHaveLength(0)
  })
})

describe('the table’s cells', () => {
  const columns: ExploreAnswer['columns'] = [
    { key: 'c0', label: 'Reference', kind: 'text', aggregate: false },
    { key: 'c1', label: 'Land parcel', kind: 'text', aggregate: false },
    { key: 'c2', label: 'Total area (ha)', kind: 'number', aggregate: true },
    { key: 'c3', label: 'Starts', kind: 'date', aggregate: false },
    { key: 'c4', label: 'Business name', kind: 'text', aggregate: false },
    { key: 'c5', label: 'Latest created', kind: 'date', aggregate: true }
  ]

  test('show numbers with separators, lists cut at three, a day as a day, and nothing as a dash', async () => {
    const { $ } = await ran(
      applications({
        columns,
        rows: [
          {
            open: null,
            cells: {
              c0: 'wmp-aa1-bb2',
              c1: ['SX1', 'SX2', 'SX3', 'SX4', 'SX5'],
              c2: 1860.5,
              c3: '2026-11-30',
              c4: null,
              c5: '2026-10-13T14:53:00.000Z'
            }
          }
        ]
      })
    )
    const cells = by($, 'explore-row').find('td')

    expect(rowsOf($)).toEqual([
      [
        'wmp-aa1-bb2',
        'SX1, SX2, SX3 +2',
        '1,860.5',
        '30 Nov 2026',
        '—',
        '13 Oct 2026 14:53'
      ]
    ])
    expect(cells.eq(2).hasClass('gpa-right')).toBe(true)
    expect(cells.eq(5).hasClass('gpa-right')).toBe(true)
    expect(cells.eq(3).hasClass('gpa-right')).toBe(false)
    expect(cells.eq(4).find('.gpa-fact-empty').attr('aria-label')).toBe(
      'Not set'
    )
  })

  test('show a list inside a list in brackets, and an empty list as []', async () => {
    const { $ } = await ran(
      applications({
        columns: [
          { key: 'c0', label: 'Parcels', kind: 'text', aggregate: false },
          { key: 'c1', label: 'Tags', kind: 'text', aggregate: false }
        ],
        rows: [
          { open: null, cells: { c0: [['P1', 'P2'], ['P3'], null], c1: [] } }
        ]
      })
    )

    expect(rowsOf($)).toEqual([['[P1, P2], [P3], null', '[]']])
  })

  test('show an object as GAS writes it, in mono, cut past 80 characters with the whole in its title', async () => {
    const short = "{ reference: 'WMP-2431', hectares: 18.5 }"
    const long =
      "{ reference: 'WMP-2431', hectares: 18.5, parcels: [ { sheet: 'SU4471', id: '2210' }, { sheet: 'SU4472', id: '2211' } ] }"
    const { $ } = await ran(
      applications({
        columns: [
          { key: 'c0', label: 'Plan', kind: 'text', aggregate: false },
          { key: 'c1', label: 'Plan in full', kind: 'text', aggregate: false },
          { key: 'c2', label: 'Applicant', kind: 'text', aggregate: false }
        ],
        rows: [
          {
            open: null,
            cells: { c0: { text: short }, c1: { text: long }, c2: 'Sam Rowe' }
          }
        ]
      })
    )
    const codes = by($, 'explore-row').find('code.gpa-code-inline')

    expect(rowsOf($)).toEqual([[short, `${long.slice(0, 80)}…`, 'Sam Rowe']])
    expect(codes).toHaveLength(2)
    expect(codes.eq(0).attr('title')).toBeUndefined()
    expect(codes.eq(1).attr('title')).toBe(long)
  })

  test('cut an object by characters, never splitting one', async () => {
    const long = `{ note: '${'a'.repeat(70)}🌳🌳🌳🌳🌳🌳🌳' }`
    const { $ } = await ran(
      applications({
        columns: [{ key: 'c0', label: 'Plan', kind: 'text', aggregate: false }],
        rows: [{ open: null, cells: { c0: { text: long } } }]
      })
    )

    expect(rowsOf($)).toEqual([[`{ note: '${'a'.repeat(70)}🌳…`]])
  })

  test('show a list of one object as that object, and objects in a longer list inline in it', async () => {
    const { $ } = await ran(
      applications({
        columns: [
          { key: 'c0', label: 'Parcels', kind: 'text', aggregate: false },
          { key: 'c1', label: 'Parcel', kind: 'text', aggregate: false }
        ],
        rows: [
          {
            open: null,
            cells: {
              c0: [{ text: "{ id: '2210' }" }, { text: "{ id: '2211' }" }],
              c1: [{ text: "{ id: '2212' }" }]
            }
          }
        ]
      })
    )

    expect(rowsOf($)).toEqual([
      ["{ id: '2210' }, { id: '2211' }", "{ id: '2212' }"]
    ])
    expect(by($, 'explore-row').find('td').eq(0).find('code')).toHaveLength(0)
    expect(by($, 'explore-row').find('td').eq(1).find('code')).toHaveLength(1)
  })

  test('show a day as a day in any column, and leave an instant in a text column as it is', async () => {
    const { $ } = await ran(
      applications({
        columns: [
          { key: 'c0', label: 'Due', kind: 'text', aggregate: false },
          { key: 'c1', label: 'Note', kind: 'text', aggregate: false }
        ],
        rows: [
          {
            open: null,
            cells: { c0: '2026-11-30', c1: '2026-10-13T14:53:00.000Z' }
          }
        ]
      })
    )

    expect(rowsOf($)).toEqual([['30 Nov 2026', '2026-10-13T14:53:00.000Z']])
    expect(by($, 'explore-row').find('time').attr('datetime')).toBe(
      '2026-11-30T00:00:00Z'
    )
  })

  test('show stored text shaped like a day the calendar hasn’t as the text it is', async () => {
    const { $, statusCode } = await ran(
      applications({
        columns: [
          { key: 'c0', label: 'Due', kind: 'text', aggregate: false },
          { key: 'c1', label: 'Starts', kind: 'date', aggregate: false }
        ],
        rows: [{ open: null, cells: { c0: '2026-13-01', c1: '2026-02-30' } }]
      })
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(rowsOf($)).toEqual([['2026-13-01', '2026-02-30']])
    expect(by($, 'explore-row').find('time')).toHaveLength(0)
  })

  test('open nothing for a group, or a row with no record, and draw neither as a link', async () => {
    const { $ } = await ran(applications({ mode: 'groups', groups: true }))

    expect(by($, 'explore-row').find('a')).toHaveLength(0)
    expect(by($, 'explore-row').hasClass('is-link')).toBe(false)
  })

  test('draw as a link only the rows that open a record', async () => {
    const { $ } = await ran(
      applications({
        rows: [
          applications().rows[0],
          { open: null, cells: { c0: 'no-record' } }
        ]
      })
    )
    const rows = by($, 'explore-row')

    expect(rows.eq(0).hasClass('is-link')).toBe(true)
    expect(rows.eq(0).find('a')).toHaveLength(1)
    expect(rows.eq(1).hasClass('is-link')).toBe(false)
    expect(rows.eq(1).find('a')).toHaveLength(0)
  })

  test.each([
    [
      { kind: 'case', code: 'frps-private-beta', ref: 'CASE-1' } as const,
      '/dev-ops/cases/frps-private-beta/CASE-1'
    ],
    [
      { kind: 'grant', code: 'woodland', version: '1.2.0' } as const,
      '/dev-ops/grants/woodland/1.2.0'
    ],
    [
      {
        kind: 'workflow',
        code: 'frps-private-beta',
        version: '2.0.0'
      } as const,
      '/dev-ops/workflows/frps-private-beta/2.0.0'
    ],
    [
      {
        kind: 'event',
        service: 'CW',
        box: 'inbox',
        id: '66f000000000000000000001'
      } as const,
      '/dev-ops/events/cw/inbox/66f000000000000000000001'
    ],
    [
      {
        kind: 'event',
        service: 'GAS',
        box: 'outbox',
        id: '66f000000000000000000002'
      } as const,
      '/dev-ops/events/gas/outbox/66f000000000000000000002'
    ]
  ])('open the record a row names: %o', async (open, href) => {
    const { $ } = await ran(
      applications({ rows: [{ open, cells: { c0: 'x' } }] })
    )

    expect(by($, 'explore-row').find('a').attr('href')).toMatch(
      new RegExp(`^${href}\\?back=`)
    )
  })
})

const fieldsOf = ($: CheerioAPI, form: ReturnType<CheerioAPI>) => ({
  method: form.attr('method'),
  action: form.attr('action'),
  fields: Object.fromEntries(
    form
      .find('input')
      .toArray()
      .map((input) => [$(input).attr('name'), $(input).attr('value')])
  )
})

/** The form the empty state's Keep looking submits, by its `form` attribute. */
const emptyKeepLookingOf = ($: CheerioAPI) =>
  fieldsOf($, $(`#${by($, 'explore-keep-looking').attr('form')}`))

/** The run, page and anything else a footer's Keep looking form posts. */
const keepLookingOf = ($: CheerioAPI) =>
  fieldsOf($, by($, 'explore-footer').find('form'))

describe('a windowed run', () => {
  const firstWindow = windowed({
    to: '2026-10-01T00:00:00.000Z',
    end: false,
    positions: 'after-first'
  })

  test('says how far back it searched, with Keep looking: a post of the run and its next window, never the query', async () => {
    const { $ } = await ran(firstWindow)

    expect(textOf($, 'explore-footer')).toBe(
      'Searched back to 1 Oct 2026 00:00. Keep looking'
    )
    expect(keepLookingOf($)).toEqual({
      method: 'post',
      action: '/dev-ops/explore',
      fields: { run: id, page: '2' }
    })
    expect(by($, 'explore-footer').find('[type="submit"]')).toHaveLength(1)
  })

  test('answers Keep looking without script with a redirect to the window’s own address, so a reload reads it again by GET', async () => {
    vi.mocked(runExploreUseCase).mockResolvedValue({
      kind: 'held',
      id,
      page: 2
    })

    const next = await post({ run: id, page: '2' })

    expect(wayInOf()).toEqual({
      kind: 'window',
      run: id,
      page: 2,
      inPlace: false
    })
    expect(next.statusCode).toBe(statusCodes.seeOther)
    expect(next.location).toBe(`${runHref}&page=2`)
  })

  test('answers Keep looking in place with the window itself, as the loader goes to any page that redirects', async () => {
    answering(
      runPage(read(windowed({ to: null, end: true, positions: null })), {
        run: { id, page: 2 }
      })
    )

    const next = await post({ run: id, page: '2' }, '', '/dev-ops/explore', {
      'x-requested-with': 'gpa-load-more'
    })

    expect(wayInOf()).toEqual({
      kind: 'window',
      run: id,
      page: 2,
      inPlace: true
    })
    expect(next.statusCode).toBe(statusCodes.ok)
    expect(next.location).toBeUndefined()
    expect(next.$('#explore-rows').find('tr')).toHaveLength(1)
  })

  test.each([
    [
      'how far back it searched',
      '2026-09-01T00:00:00.000Z',
      'Searched back to 1 Sep 2026 00:00. Keep looking'
    ],
    ['nothing of how far', null, 'Keep looking']
  ])(
    'answers Keep looking in place into a window with no matches with a footer saying %s, with Keep looking for the loader to go further back',
    async (_, to, text) => {
      answering(
        runPage(read(windowed({ to, end: false, positions: 'q' }, [])), {
          run: { id, page: 2 },
          previous: {
            positions: 'p',
            end: false,
            found: 1,
            source: { name: 'applications', noun: 'application' }
          }
        })
      )

      const { $, statusCode } = await post(
        { run: id, page: '2' },
        '',
        '/dev-ops/explore',
        { 'x-requested-with': 'gpa-load-more' }
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(rowsOf($)).toHaveLength(0)
      expect(by($, 'explore-empty')).toHaveLength(0)
      expect(textOf($, 'explore-footer')).toBe(text)
      expect(keepLookingOf($).fields).toEqual({ run: id, page: '3' })
      expect($('gpa-load-more')).toHaveLength(1)
    }
  )

  test('answers Keep looking in place on a run no longer held with a conflict naming the run’s page, so the loader goes there', async () => {
    vi.mocked(runExploreUseCase).mockResolvedValue({ kind: 'gone', id })

    const next = await post({ run: id, page: '2' }, '', '/dev-ops/explore', {
      'x-requested-with': 'gpa-load-more'
    })

    expect(next.statusCode).toBe(statusCodes.conflict)
    expect(next.location).toBe(runHref)
    expect(next.payload).toBe('')
  })

  test('shows the next window at its address, counting what the run has found', async () => {
    showing(
      runPage(
        read(
          windowed(
            { to: '2026-09-01T00:00:00.000Z', end: true, positions: null },
            [applications().rows[0], applications().rows[0]]
          )
        ),
        {
          run: { id, page: 2 },
          previous: {
            positions: 'after-first',
            end: false,
            found: 1,
            source: { name: 'applications', noun: 'application' }
          }
        }
      )
    )

    const next = await view(`${runHref}&page=2`)

    expect(next.statusCode).toBe(statusCodes.ok)
    expect(rowsOf(next.$)).toHaveLength(2)
    expect(next.$('#explore-rows').find('tr')).toHaveLength(2)
    expect(textOf(next.$, 'explore-count')).toBe('3 applications found so far')
    expect(next.$('#explore-count').attr('data-load-more-count')).toBe('')
    expect(textOf(next.$, 'explore-footer')).toBe('Searched everything.')
  })

  test.each([
    ['Keep looking', () => post({ run: id, page: '3' })],
    ['the address', () => view(`${runHref}&page=3`)]
  ])(
    'goes back to the first window for one the use case can’t start, from %s',
    async (_, request) => {
      vi.mocked(viewExploreUseCase).mockResolvedValue({ kind: 'restart', id })
      vi.mocked(runExploreUseCase).mockResolvedValue({ kind: 'restart', id })

      const { statusCode, location } = await request()

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(location).toBe(runHref)
    }
  )

  test.each([
    [
      'how far back it got',
      { to: '2026-10-01T00:00:00.000Z', end: false, positions: 'p' },
      'Searched back to 1 Oct 2026 00:00. Explore reads no further: narrow the query to look further back.'
    ],
    [
      'nothing of how far',
      { to: null, end: false, positions: 'p' },
      'Explore reads no further: narrow the query to look further back.'
    ]
  ])(
    'stops at the last window a run can read, saying %s, with no Keep looking',
    async (_, window, text) => {
      showing(runPage(read(windowed(window)), { run: { id, page: 1000 } }))

      const { $ } = await view(`${runHref}&page=1000`)

      expect(textOf($, 'explore-footer')).toBe(text)
      expect(by($, 'explore-footer').find('form')).toHaveLength(0)
      expect($('gpa-load-more')).toHaveLength(0)
    }
  )

  test('says the last window a run can read matched nothing, with no Keep looking', async () => {
    showing(
      runPage(read(windowed({ to: null, end: false, positions: 'p' }, [])), {
        run: { id, page: 1000 }
      })
    )

    const { $ } = await view(`${runHref}&page=1000`)

    expect(textOf($, 'explore-table')).toContain(
      'Explore reads no further: narrow the query to look further back.'
    )
    expect(textOf($, 'explore-table')).not.toContain('Keep looking')
  })

  test('still offers Keep looking on the window before the last', async () => {
    showing(
      runPage(
        read(
          windowed({
            to: '2026-10-01T00:00:00.000Z',
            end: false,
            positions: 'p'
          })
        ),
        { run: { id, page: 999 } }
      )
    )

    const { $ } = await view(`${runHref}&page=999`)

    expect(keepLookingOf($).fields).toEqual({ run: id, page: '1000' })
  })

  test('asks the use case for the window an address names', async () => {
    await view(`${runHref}&page=3`)

    expect(viewExploreUseCase).toHaveBeenCalledExactlyOnceWith({
      owner: expect.objectContaining({ user: credentials.user.id }),
      run: id,
      page: 3
    })
  })

  test('says a window ended early, with how far back it got and how many records were too large to search', async () => {
    const { $ } = await ran(
      applications({
        read: 'windowed',
        count: null,
        partial: true,
        window: {
          to: '2026-10-05T08:30:00.000Z',
          end: false,
          positions: 'early',
          skipped: 1
        }
      })
    )

    expect(textOf($, 'explore-footer')).toBe(
      'Searched back to 5 Oct 2026 08:30. 1 record too large to search. Keep looking'
    )
  })

  test('counts several records too large to search', async () => {
    const { $ } = await ran(
      windowed({
        to: '2026-10-05T08:30:00.000Z',
        end: false,
        positions: 'early',
        skipped: 3
      })
    )

    expect(textOf($, 'explore-footer')).toBe(
      'Searched back to 5 Oct 2026 08:30. 3 records too large to search. Keep looking'
    )
  })

  test('offers Keep looking on its own when a window read nothing to say how far back it got', async () => {
    const { $ } = await ran(
      windowed({ to: null, end: false, positions: 'none-yet' }, [])
    )

    expect(by($, 'explore-footer')).toHaveLength(0)
    expect(textOf($, 'explore-empty')).toBe(
      'Nothing matches Nothing in the records read so far. Keep looking to go further back. Keep looking'
    )
    expect(emptyKeepLookingOf($).fields).toEqual({ run: id, page: '2' })
  })

  test('says the records too large to search in the empty state when a window read nothing to say how far back it got', async () => {
    const { $ } = await ran(
      windowed({ to: null, end: false, positions: 'none-yet', skipped: 2 }, [])
    )

    expect(textOf($, 'explore-empty')).toContain(
      'Keep looking to go further back. 2 records too large to search.'
    )
  })

  test('says nothing matches yet, with Keep looking a plain post of the run and its next window that no loader appends to', async () => {
    const { $ } = await ran(
      windowed(
        { to: '2026-10-01T00:00:00.000Z', end: false, positions: 'p' },
        []
      )
    )

    expect(textOf($, 'explore-empty')).toBe(
      'Nothing matches Nothing in the records read so far. Keep looking to go further back. Keep looking'
    )
    expect(emptyKeepLookingOf($)).toEqual({
      method: 'post',
      action: '/dev-ops/explore',
      fields: { run: id, page: '2' }
    })
    expect(textOf($, 'explore-footer')).toBe(
      'Searched back to 1 Oct 2026 00:00.'
    )
    expect(by($, 'explore-footer').find('form')).toHaveLength(0)
    expect($('gpa-load-more')).toHaveLength(0)
  })

  test('draws matches found after a window that had none without saying nothing matches', async () => {
    showing(
      runPage(
        read(
          windowed(
            { to: '2026-09-01T00:00:00.000Z', end: false, positions: 'q' },
            [applications().rows[0]]
          )
        ),
        {
          run: { id, page: 2 },
          previous: {
            positions: 'p',
            end: false,
            found: 0,
            source: { name: 'applications', noun: 'application' }
          }
        }
      )
    )

    const { $ } = await view(`${runHref}&page=2`)

    expect(rowsOf($)).toHaveLength(1)
    expect(by($, 'explore-empty')).toHaveLength(0)
    expect(textOf($, 'explore-table')).not.toContain('Nothing matches')
    expect(keepLookingOf($).fields).toEqual({ run: id, page: '3' })
  })

  test('says nothing has these values once every window read none, with no Keep looking', async () => {
    showing(
      runPage(read(windowed({ to: null, end: true, positions: null }, [])), {
        run: { id, page: 2 }
      })
    )

    const { $ } = await view(`${runHref}&page=2`)

    expect(textOf($, 'explore-empty')).toBe(
      'Nothing matches No applications have these values.'
    )
    expect(by($, 'explore-keep-looking')).toHaveLength(0)
    expect(textOf($, 'explore-footer')).toBe('Searched everything.')
  })

  test('says a later window that couldn’t be read in the footer, with Try again', async () => {
    showing(
      runPage(
        failed({
          kind: 'no-answer',
          service: 'GAS',
          failure: { kind: 'no-answer' }
        }),
        {
          run: { id, page: 2 },
          previous: {
            positions: 'after-first',
            end: false,
            found: 1,
            source: { name: 'applications', noun: 'application' }
          }
        }
      )
    )

    const next = await view(`${runHref}&page=2`)

    expect(by(next.$, 'explore-alert')).toHaveLength(0)
    expect(textOf(next.$, 'explore-footer')).toBe(
      'Couldn’t load more applications. Try again'
    )
    expect(by(next.$, 'explore-footer').find('a').attr('href')).toBe(
      `${runHref}&page=2`
    )
  })
})

describe('the count’s focus', () => {
  const focused = ($: CheerioAPI) => {
    const count = by($, 'explore-count')

    return (
      count.is('[data-focus-on-arrival]') && count.attr('tabindex') === '-1'
    )
  }

  const other = '7a1c2e3d-4b5f-4a6b-8c7d-9e0f1a2b3c4d'

  beforeEach(() => {
    showing(runPage(read(applications())))
  })

  test.each([
    ['Run', { q: typed }],
    ['a Queries menu item', { pick: 'frps-cases-by-status' }],
    ['Open in Explore', { from: 'applications', list: '' }],
    [
      'Find others',
      {
        find: 'cases-by-sbi',
        record: '/dev-ops/cases/frps-private-beta/CASE-1'
      }
    ]
  ])('is put on the count of the page %s lands on', async (_, payload) => {
    const posted = await post(payload)

    expect(posted.location).toBe(runHref)
    expect(focused((await view(posted.location, posted.cookie)).$)).toBe(true)
  })

  test('is not put on the count again when that page is reloaded', async () => {
    const posted = await post({ q: typed })
    const landed = await view(runHref, posted.cookie)

    expect(focused((await view(runHref, landed.cookie)).$)).toBe(false)
  })

  test('is not put on the count of a run’s address opened without a Run', async () => {
    expect(focused((await view(runHref)).$)).toBe(false)
  })

  test('is not put on the count of another run than the one a Run held', async () => {
    const posted = await post({ q: typed })

    showing(runPage(read(applications()), { run: { id: other, page: 1 } }))

    expect(
      focused((await view(`/dev-ops/explore?run=${other}`, posted.cookie)).$)
    ).toBe(false)
  })

  test('is not put on the count of a later window, in place or without script', async () => {
    const page2 = runPage(
      read(windowed({ to: null, end: true, positions: null })),
      { run: { id, page: 2 } }
    )
    const posted = await post({ q: typed })

    answering(page2)
    const inPlace = await post(
      { run: id, page: '2' },
      posted.cookie,
      '/dev-ops/explore',
      { 'x-requested-with': 'gpa-load-more' }
    )

    vi.mocked(runExploreUseCase).mockResolvedValue({
      kind: 'held',
      id,
      page: 2
    })
    showing(page2)
    const withoutScript = await post({ run: id, page: '2' }, posted.cookie)
    const next = await view(withoutScript.location, withoutScript.cookie)

    expect(focused(inPlace.$)).toBe(false)
    expect(focused(next.$)).toBe(false)
  })

  test('is not put on the count of every window drawn again', async () => {
    const posted = await post({ q: typed })

    vi.mocked(restoreExploreUseCase).mockResolvedValue({
      kind: 'page',
      page: runPage(read(applications()), {
        run: { id, page: 2, through: 2 }
      })
    })

    expect(focused((await view(`${runHref}&through=2`, posted.cookie)).$)).toBe(
      false
    )
  })
})

describe('drawing every window again', () => {
  const restoring = (page: ExplorePageData) => {
    vi.mocked(restoreExploreUseCase).mockResolvedValue({ kind: 'page', page })
  }

  const restoreOf = ($: CheerioAPI) =>
    by($, 'explore-footer').attr('data-restore-href') ??
    by($, 'explore-footer')
      .find('[data-restore-href]')
      .attr('data-restore-href')

  test.each([
    [
      'the first',
      { run: { id, page: 1 } },
      { to: '2026-10-01T00:00:00.000Z', end: false, positions: 'p' },
      runHref
    ],
    [
      'a later one',
      { run: { id, page: 3 } },
      { to: '2026-10-01T00:00:00.000Z', end: false, positions: 'p' },
      `${runHref}&through=3`
    ],
    [
      'one with no time',
      { run: { id, page: 2 } },
      { to: null, end: false, positions: 'p' },
      `${runHref}&through=2`
    ],
    [
      'the last',
      { run: { id, page: 2 } },
      { to: null, end: true, positions: null },
      `${runHref}&through=2`
    ]
  ])(
    'puts on %s window’s footer the address that draws every window through it, of the run’s id and the window alone',
    async (_, overrides, window, href) => {
      showing(runPage(read(windowed(window)), overrides))

      const { $ } = await view(runHref)

      expect(restoreOf($)).toBe(href)
      expect(new URL(href, 'http://x').searchParams.toString()).toMatch(
        /^run=[0-9a-f-]+(&through=\d+)?$/
      )
    }
  )

  test.each([
    ['the 50th', 50, `${runHref}&through=50`],
    ['the 51st', 51, `${runHref}&page=51`],
    ['the last a run may read', 1000, `${runHref}&page=1000`]
  ])(
    'puts on %s window’s footer the address its rows carry: every window through it up to 50, its own past them',
    async (_, page, href) => {
      showing(
        runPage(read(windowed({ to: null, end: false, positions: 'p' })), {
          run: { id, page }
        })
      )

      expect(restoreOf((await view(`${runHref}&page=${page}`)).$)).toBe(href)
    }
  )

  test('puts the same address on a window past the 50th put in place with rows and one without', async () => {
    const inPlace = async (answer: ExploreAnswer) => {
      answering(runPage(read(answer), { run: { id, page: 51 } }))

      return (
        await post({ run: id, page: '51' }, '', '/dev-ops/explore', {
          'x-requested-with': 'gpa-load-more'
        })
      ).$
    }
    const window = { to: null, end: false, positions: 'p' }
    const withRows = await inPlace(threeRows())
    const without = await inPlace(windowed(window, []))
    /** As the loader reads it: the first address in the table that holds the footer. */
    const loaderAddress = ($: CheerioAPI) =>
      $('.gpa-table')
        .has('gpa-load-more, .gpa-listfoot')
        .find('[data-restore-href]')
        .first()
        .attr('data-restore-href')

    expect(loaderAddress(withRows)).toBe(`${runHref}&page=51`)
    expect(restoreOf(withRows)).toBe(`${runHref}&page=51`)
    expect(loaderAddress(without)).toBe(`${runHref}&page=51`)
  })

  test('comes back from a row of the 50th window through every window to it', async () => {
    showing(runPage(read(threeRows()), { run: { id, page: 50 } }))

    const { $ } = await view(`${runHref}&page=50`)

    expect(backOf($, 0)).toBe(`${runHref}&through=50#row-50-1`)
  })

  test('comes back from a row past the 50th window to its own window, which draws the row it lands on', async () => {
    showing(runPage(read(threeRows()), { run: { id, page: 60 } }))

    const { $ } = await view(`${runHref}&page=60`)

    expect(backOf($, 0)).toBe(`${runHref}&page=60#row-60-1`)
    expect(by($, 'explore-row').first().attr('id')).toBe('row-60-1')
  })

  test('asks for every window through the one named, however many: the use case reads at most 50', async () => {
    restoring(
      runPage(read(threeRows()), { run: { id, page: 50, through: 50 } })
    )

    await view(`${runHref}&through=60`)

    expect(restoreExploreUseCase).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ run: id, through: 60 })
    )
  })

  test('keeps the rows read before a window that couldn’t be read, and offers Try again of every window', async () => {
    restoring(
      runPage(read(threeRows()), {
        run: {
          id,
          page: 1,
          through: 3,
          windowRows: [3],
          stopped: { statusCode: 504, code: 'TIMED_OUT' }
        }
      })
    )

    const { $ } = await view(`${runHref}&through=3`)
    const footer = by($, 'explore-footer')

    expect(rowsOf($)).toHaveLength(3)
    expect(flat(footer.text())).toContain('Couldn’t load more applications.')
    expect(footer.find('a').attr('href')).toBe(`${runHref}&through=3`)
    expect(footer.find('form')).toHaveLength(0)
  })

  test('puts the address on the footer of Keep looking’s answer in place, for the loader to show', async () => {
    answering(
      runPage(
        read(
          windowed({
            to: '2026-10-01T00:00:00.000Z',
            end: false,
            positions: 'p'
          })
        ),
        { run: { id, page: 2 } }
      )
    )

    const { $ } = await post({ run: id, page: '2' }, '', '/dev-ops/explore', {
      'x-requested-with': 'gpa-load-more'
    })

    expect(restoreOf($)).toBe(`${runHref}&through=2`)
  })

  test('draws every window through the one named, with or without script, each row coming back to it', async () => {
    restoring(
      runPage(
        read(
          windowed(
            { to: '2026-09-01T00:00:00.000Z', end: false, positions: 'p' },
            [
              applications().rows[0],
              applications().rows[0],
              applications().rows[0]
            ]
          )
        ),
        { run: { id, page: 3, through: 3 } }
      )
    )

    const { $, statusCode } = await view(`${runHref}&through=3`)

    expect(restoreExploreUseCase).toHaveBeenCalledExactlyOnceWith({
      owner: expect.objectContaining({ user: credentials.user.id }),
      run: id,
      through: 3
    })
    expect(viewExploreUseCase).not.toHaveBeenCalled()
    expect(statusCode).toBe(statusCodes.ok)
    expect(rowsOf($)).toHaveLength(3)
    expect(textOf($, 'explore-count')).toBe('3 applications found so far')
    expect(keepLookingOf($).fields).toEqual({ run: id, page: '4' })
    expect(restoreOf($)).toBe(`${runHref}&through=3`)
  })

  const rowIds = ($: CheerioAPI) =>
    by($, 'explore-row')
      .toArray()
      .map((row) => $(row).attr('id'))

  const backOf = ($: CheerioAPI, n: number) =>
    new URL(
      String(by($, 'explore-row').eq(n).find('a').attr('href')),
      'http://x'
    ).searchParams.get('back')

  const threeRows = () =>
    windowed({ to: '2026-09-01T00:00:00.000Z', end: false, positions: 'p' }, [
      applications().rows[0],
      applications().rows[0],
      applications().rows[0]
    ])

  test('places each row drawn again in its own window, coming back through that window and landing on the row', async () => {
    restoring(
      runPage(read(threeRows()), {
        run: { id, page: 2, through: 2, windowRows: [2, 1] }
      })
    )

    const { $ } = await view(`${runHref}&through=2`)

    expect(rowIds($)).toEqual(['row-1-1', 'row-1-2', 'row-2-1'])
    expect([0, 1, 2].map((n) => backOf($, n))).toEqual([
      `${runHref}#row-1-1`,
      `${runHref}#row-1-2`,
      `${runHref}&through=2#row-2-1`
    ])
  })

  test('comes back from a row of Keep looking’s answer in place through every window to it, landing on the row', async () => {
    answering(runPage(read(threeRows()), { run: { id, page: 2 } }))

    const { $ } = await post({ run: id, page: '2' }, '', '/dev-ops/explore', {
      'x-requested-with': 'gpa-load-more'
    })

    expect(rowIds($)).toEqual(['row-2-1', 'row-2-2', 'row-2-3'])
    expect(backOf($, 2)).toBe(`${runHref}&through=2#row-2-3`)
  })

  test('comes back from a row of the next window, opened on its own page past what a restore draws, to that page', async () => {
    showing(runPage(read(threeRows()), { run: { id, page: 5, restorable: 3 } }))

    const { $ } = await view(`${runHref}&page=5`)

    expect(rowIds($)).toEqual(['row-5-1', 'row-5-2', 'row-5-3'])
    expect(backOf($, 0)).toBe(`${runHref}&page=5#row-5-1`)
    expect(by($, 'explore-footer').attr('data-restore-href')).toBe(
      `${runHref}&page=5`
    )
  })

  const restoreOfRow = ($: CheerioAPI, n: number) =>
    by($, 'explore-row').eq(n).attr('data-restore-href')

  test.each([
    [1, runHref, undefined],
    [50, `${runHref}&through=50`, undefined],
    [51, `${runHref}&page=51`, `${runHref}&page=51`]
  ])(
    'a row of window %i goes back to its window; it has an address of its own only past the most a restore draws',
    async (page, href, own) => {
      showing(runPage(read(threeRows()), { run: { id, page } }))

      const { $ } = await view(`${runHref}&page=${page}`)

      expect(restoreOfRow($, 2)).toBe(own)
      expect(backOf($, 2)).toBe(`${href}#row-${page}-3`)
    }
  )

  test('a first window row has no address of its own once window 51 is put in after it, so the loader’s address holds it', async () => {
    showing(runPage(read(threeRows())))
    const first = await view(runHref)

    answering(runPage(read(threeRows()), { run: { id, page: 51 } }))
    const later = await post(
      { run: id, page: '51' },
      first.cookie,
      '/dev-ops/explore',
      {
        'x-requested-with': 'gpa-load-more'
      }
    )

    first.$('#explore-rows').append(later.$('#explore-rows').children())

    expect(restoreOfRow(first.$, 0)).toBeUndefined()
    expect(restoreOfRow(first.$, 3)).toBe(`${runHref}&page=51`)
    expect(restoreOf(later.$)).toBe(`${runHref}&page=51`)
  })

  test('comes back from a row of a later window without script through every window to it, landing on the row', async () => {
    vi.mocked(runExploreUseCase).mockResolvedValue({
      kind: 'held',
      id,
      page: 2
    })
    showing(runPage(read(threeRows()), { run: { id, page: 2 } }))

    const posted = await post({ run: id, page: '2' })
    const { $ } = await view(String(posted.location), posted.cookie)

    expect(posted.location).toBe(`${runHref}&page=2`)
    expect(rowIds($)).toEqual(['row-2-1', 'row-2-2', 'row-2-3'])
    expect(backOf($, 0)).toBe(`${runHref}&through=2#row-2-1`)
  })

  test('a row’s Back to the window a Run landed on doesn’t put focus on the count', async () => {
    showing(runPage(read(threeRows())))

    const posted = await post({ q: typed })
    const landed = await view(runHref, posted.cookie)
    const back = String(backOf(landed.$, 1))

    expect(back).toBe(`${runHref}#row-1-2`)
    expect(
      by((await view(back.split('#')[0], landed.cookie)).$, 'explore-count').is(
        '[data-focus-on-arrival]'
      )
    ).toBe(false)
  })

  test('offers Try again of every window when one of them couldn’t be read', async () => {
    restoring(
      runPage(failed({ kind: 'errored', service: 'GAS' }), {
        run: { id, page: 2, through: 3 },
        previous: {
          positions: 'p',
          end: false,
          found: 1,
          source: { name: 'applications', noun: 'application' }
        }
      })
    )

    const { $ } = await view(`${runHref}&through=3`)

    expect(by($, 'explore-footer').find('a').attr('href')).toBe(
      `${runHref}&through=3`
    )
  })

  test('sends a restore cut before the window it asked for to that window’s own page, the row in its address kept', async () => {
    vi.mocked(restoreExploreUseCase).mockResolvedValue({
      kind: 'apart',
      id,
      page: 5
    })

    const { statusCode, location } = await view(`${runHref}&through=5`)

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(location).toBe(`${runHref}&page=5`)
    expect(location).not.toContain('#')
  })

  test('goes back to the first window for windows not yet reached', async () => {
    vi.mocked(restoreExploreUseCase).mockResolvedValue({ kind: 'restart', id })

    const { statusCode, location } = await view(`${runHref}&through=5`)

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(location).toBe(runHref)
  })

  test.each([
    ['the first window', `${runHref}&through=1`],
    ['a window past the last', `${runHref}&through=1001`],
    ['a window that isn’t a number', `${runHref}&through=many`],
    ['a window and a page', `${runHref}&through=2&page=2`],
    ['no run', '/dev-ops/explore?through=2']
  ])('refuses an address naming %s', async (_, url) => {
    expect((await view(url)).statusCode).toBe(statusCodes.badRequest)
    expect(restoreExploreUseCase).not.toHaveBeenCalled()
  })
})

describe('an exact run with nothing', () => {
  test('says nothing matches these values', async () => {
    const { $ } = await ran(
      applications({ rows: [], count: { n: 0, capped: false } })
    )

    expect(textOf($, 'explore-count')).toBe('0 applications')
    expect(textOf($, 'explore-table')).toContain('Nothing matches')
    expect(textOf($, 'explore-table')).toContain(
      'No applications have these values.'
    )
    expect(by($, 'explore-footer')).toHaveLength(0)
  })
})

const actionLabels: Record<string, string> = {
  retry: 'Try again',
  start: 'Start again'
}

describe('a run that fails', () => {
  test.each([
    [
      'GAS doesn’t answer',
      { kind: 'no-answer', service: 'GAS', failure: { kind: 'no-answer' } },
      statusCodes.serviceUnavailable,
      'The Grant Application Service didn’t answer in time. Nothing has changed: try again.',
      'retry'
    ],
    [
      'GAS can’t be reached',
      { kind: 'no-answer', service: 'GAS', failure: { kind: 'not-connected' } },
      statusCodes.serviceUnavailable,
      'GAS couldn’t be reached. Nothing has changed: try again.',
      'retry'
    ],
    [
      'GAS answers with an error',
      { kind: 'errored', service: 'GAS' },
      statusCodes.serviceUnavailable,
      'The Grant Application Service answered with an error. Nothing has changed: try again.',
      'retry'
    ],
    [
      'GAS can’t run queries at all for now',
      { kind: 'unavailable', service: 'GAS' },
      statusCodes.serviceUnavailable,
      'The Grant Application Service can’t run queries at the moment. Nothing was read. Try again later.',
      'retry'
    ],
    [
      'Caseworking doesn’t answer',
      { kind: 'no-answer', service: 'CW', failure: { kind: 'timed-out' } },
      statusCodes.serviceUnavailable,
      'Caseworking didn’t answer in time. Nothing has changed: try again.',
      'retry'
    ],
    [
      'GAS can’t reach Caseworking',
      { kind: 'no-answer', service: 'CW', failure: { kind: 'cw-not-reached' } },
      statusCodes.serviceUnavailable,
      'CW couldn’t be reached. Nothing has changed: try again.',
      'retry'
    ],
    [
      'Caseworking answers with an error',
      { kind: 'errored', service: 'CW' },
      statusCodes.serviceUnavailable,
      'Caseworking answered with an error. Nothing has changed: try again.',
      'retry'
    ],
    [
      'Caseworking refuses it',
      { kind: 'refused', service: 'CW', message: 'Too many cases to count.' },
      statusCodes.badRequest,
      'Caseworking refused this query. Too many cases to count.',
      'start'
    ],
    [
      'it takes Caseworking too long',
      { kind: 'too-slow', service: 'CW', message: null },
      statusCodes.serviceUnavailable,
      'Caseworking refused this query. It took too long. Narrow it with an indexed path.',
      'start'
    ],
    [
      'GAS has too many records of a kind to read in full',
      {
        kind: 'refused',
        service: 'GAS',
        message:
          'The Grant Application Service has too many agreements to read in full'
      },
      statusCodes.badRequest,
      'The Grant Application Service refused this query. The Grant Application Service has too many agreements to read in full',
      'start'
    ],
    [
      'GAS refuses it',
      { kind: 'refused', service: 'GAS', message: null },
      statusCodes.badRequest,
      'The Grant Application Service refused this query.',
      'start'
    ],
    [
      'it takes too long, saying why',
      {
        kind: 'too-slow',
        service: 'GAS',
        message:
          'The Grant Application Service took too long. Narrow it with clientRef, code or createdAt.'
      },
      statusCodes.serviceUnavailable,
      'The Grant Application Service refused this query. The Grant Application Service took too long. Narrow it with clientRef, code or createdAt.',
      'start'
    ],
    [
      'another query of this person’s is running',
      { kind: 'busy', service: 'GAS' },
      statusCodes.tooManyRequests,
      'You already have a query running. Wait for it to finish, then try again.',
      'retry'
    ],
    [
      'GAS is running as many queries as it can',
      { kind: 'full', service: 'GAS' },
      statusCodes.tooManyRequests,
      'The Grant Application Service is running as many queries as it can. Try again in a moment.',
      'retry'
    ],
    [
      'Caseworking is running as many queries as it can',
      { kind: 'full', service: 'CW' },
      statusCodes.tooManyRequests,
      'Caseworking is running as many queries as it can. Try again in a moment.',
      'retry'
    ]
  ] as [string, ExploreFailure, number, string, string][])(
    'says so when %s',
    async (_, failure, code, text, action) => {
      showing(runPage(failed(failure)))

      const { $, statusCode } = await view(runHref)

      expect(statusCode).toBe(code)
      expect(textOf($, 'explore-alert')).toBe(`${text} ${actionLabels[action]}`)
      expect(by($, 'explore-results')).toHaveLength(0)
      expect($('#q').val()).toBe(typed)
      expect(by($, 'explore-retry').attr('href')).toBe(
        action === 'retry' ? runHref : undefined
      )
      expect(by($, 'explore-start-again').attr('href')).toBe(
        action === 'start' ? '/dev-ops/explore' : undefined
      )
    }
  )

  test('says it took too long without naming any source’s paths when GAS doesn’t say why', async () => {
    showing(
      runPage(failed({ kind: 'too-slow', service: 'GAS', message: null }), {
        q: 'db.cases.find()'
      })
    )

    const { $ } = await view(runHref)

    expect(textOf($, 'explore-alert')).toBe(
      'The Grant Application Service refused this query. It took too long. Narrow it with an indexed path. Start again'
    )
    expect(textOf($, 'explore-alert')).not.toMatch(/clientRef|code|createdAt/)
  })

  test('says a run the use case no longer holds has expired, with the editor empty', async () => {
    showing(editorPage({ q: '', notice: { kind: 'expired' } }))

    const { $, statusCode } = await view(runHref)

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'explore-alert')).toBe(
      'This query has expired. Run it again.'
    )
    expect($('#q').val()).toBe('')
  })

  test('asks the use case for a run whatever its id looks like, so one that isn’t a run’s says it has expired', async () => {
    showing(editorPage({ q: '', notice: { kind: 'expired' } }))

    const { $, statusCode } = await view('/dev-ops/explore?run=not-a-uuid')

    expect(statusCode).toBe(statusCodes.ok)
    expect(viewExploreUseCase).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ run: 'not-a-uuid', page: 1 })
    )
    expect(textOf($, 'explore-alert')).toBe(
      'This query has expired. Run it again.'
    )
  })

  test('refuses a run id longer than any run’s', async () => {
    const { statusCode } = await view(`/dev-ops/explore?run=${'a'.repeat(65)}`)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(viewExploreUseCase).not.toHaveBeenCalled()
  })

  test.each([
    ['a notice', editorPage({ q: '', notice: { kind: 'expired' } })],
    ['a failed run', runPage(failed({ kind: 'unavailable', service: 'GAS' }))]
  ])(
    'moves focus to the alert that answers the run, for %s',
    async (_, page) => {
      showing(page)

      const { $ } = await view(runHref)

      expect(by($, 'explore-alert').attr('data-focus-on-arrival')).toBe('')
      expect($('[data-focus-on-arrival]')).toHaveLength(1)
    }
  )
})

describe('a run while another query is still running', () => {
  const busy = failed({ kind: 'busy', service: 'GAS' })
  const saying =
    'You already have a query running. Wait for it to finish, then try again.'

  const laterWindow = runPage(busy, {
    run: { id, page: 2 },
    previous: {
      positions: 'after-first',
      end: false,
      found: 1,
      source: { name: 'applications', noun: 'application' }
    }
  })

  test('says so on the page when every window is drawn again, with Try again', async () => {
    vi.mocked(restoreExploreUseCase).mockResolvedValue({
      kind: 'page',
      page: runPage(busy, { run: { id, page: 1, through: 2 } })
    })

    const { $, statusCode } = await view(`${runHref}&through=2`)

    expect(statusCode).toBe(statusCodes.tooManyRequests)
    expect(textOf($, 'explore-alert')).toBe(`${saying} Try again`)
    expect(by($, 'explore-retry').attr('href')).toBe(`${runHref}&through=2`)
    expect(by($, 'status-error')).toHaveLength(0)
  })

  test('says so in the footer of a later window without script, with Try again of that window', async () => {
    showing(laterWindow)

    const { $, statusCode } = await view(`${runHref}&page=2`)

    expect(statusCode).toBe(statusCodes.tooManyRequests)
    expect(by($, 'explore-alert')).toHaveLength(0)
    expect(textOf($, 'explore-footer')).toBe(`${saying} Try again`)
    expect(by($, 'explore-footer').find('a').attr('href')).toBe(
      `${runHref}&page=2`
    )
  })

  test.each([
    ['this person’s other query', { kind: 'busy', service: 'GAS' }, saying],
    [
      'as many queries as GAS can run',
      { kind: 'full', service: 'GAS' },
      'The Grant Application Service is running as many queries as it can. Try again in a moment.'
    ]
  ] as [string, ExploreFailure, string][])(
    'answers Keep looking in place with a footer saying it waits for %s, for the loader to show under the rows it has, with Try again of every window',
    async (_, failure, text) => {
      answering({ ...laterWindow, result: failed(failure) })

      const { $, statusCode } = await post(
        { run: id, page: '2' },
        '',
        '/dev-ops/explore',
        { 'x-requested-with': 'gpa-load-more' }
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(by($, 'explore-alert')).toHaveLength(0)
      expect($('#explore-rows')).toHaveLength(1)
      expect(rowsOf($)).toHaveLength(0)
      expect(textOf($, 'explore-footer')).toBe(`${text} Try again`)
      expect(by($, 'explore-footer').attr('role')).toBe('alert')
      expect(by($, 'explore-footer').find('a').attr('href')).toBe(
        `${runHref}&through=2`
      )
    }
  )

  test('in place past what a restore of the run draws, Try again is that window alone', async () => {
    answering({
      ...laterWindow,
      run: { id, page: 3, restorable: 2 },
      result: busy
    })

    const { $ } = await post({ run: id, page: '3' }, '', '/dev-ops/explore', {
      'x-requested-with': 'gpa-load-more'
    })

    expect(by($, 'explore-footer').find('a').attr('href')).toBe(
      `${runHref}&page=3`
    )
  })

  const full = failed({ kind: 'full', service: 'GAS' })
  const fullSaying =
    'The Grant Application Service is running as many queries as it can. Try again in a moment.'

  test.each([
    ['the last a restore draws', busy, saying, 50, `${runHref}&through=50`],
    ['past the last a restore draws', busy, saying, 60, `${runHref}&page=60`],
    [
      'past the last a restore draws, GAS full,',
      full,
      fullSaying,
      60,
      `${runHref}&page=60`
    ]
  ])(
    'answers Keep looking in place into a window %s with Try again that draws it',
    async (_, result, text, page, href) => {
      answering({ ...laterWindow, result, run: { id, page } })

      const { $, statusCode } = await post(
        { run: id, page: String(page) },
        '',
        '/dev-ops/explore',
        { 'x-requested-with': 'gpa-load-more' }
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(textOf($, 'explore-footer')).toBe(`${text} Try again`)
      expect(by($, 'explore-footer').find('a').attr('href')).toBe(href)
    }
  )

  test('keeps a service that couldn’t answer Keep looking in place an outage, for the loader’s own Try again', async () => {
    answering({
      ...laterWindow,
      result: failed({ kind: 'errored', service: 'GAS' })
    })

    const { statusCode } = await post(
      { run: id, page: '2' },
      '',
      '/dev-ops/explore',
      { 'x-requested-with': 'gpa-load-more' }
    )

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
  })
})

describe('the Queries menu', () => {
  const items = ($: CheerioAPI) =>
    by($, 'explore-queries-menu')
      .find('button')
      .toArray()
      .map((item) => ({
        text: flat($(item).text()),
        name: $(item).attr('name'),
        value: $(item).attr('value'),
        type: $(item).attr('type'),
        form: $(item).attr('form'),
        recent: $(item).attr('data-testid') === 'explore-recent'
      }))

  const recentOf = ($: CheerioAPI) =>
    items($)
      .filter(({ recent }) => recent)
      .map(({ text }) => text)

  /** Each group by the name its heading gives it, with its items' kinds. */
  const groups = ($: CheerioAPI) =>
    by($, 'explore-queries-menu')
      .find('[role="group"]')
      .toArray()
      .map((group) => ({
        name: flat($(`#${$(group).attr('aria-labelledby')}`).text()),
        items: [
          ...new Set(
            $(group)
              .find('button')
              .toArray()
              .map((item) => $(item).attr('data-testid'))
          )
        ]
      }))

  /** The menu's own children: its groups by name, and the dividers between them. */
  const layout = ($: CheerioAPI) =>
    by($, 'explore-queries-menu')
      .children()
      .children()
      .toArray()
      .map((child) =>
        $(child).is('.gpa-divider')
          ? '—'
          : flat($(`#${$(child).attr('aria-labelledby')}`).text())
      )

  test('with no recent query, offers only the examples, each a submit of the editor’s form, with no icons', async () => {
    const { $ } = await view()

    expect(textOf($, 'explore-queries')).toBe('Queries')
    expect(groups($)).toEqual([
      { name: 'Examples', items: ['explore-example'] }
    ])
    expect(layout($)).toEqual(['Examples'])
    expect(
      by($, 'explore-queries-menu').find('.gpa-menuitem svg')
    ).toHaveLength(0)
    expect(items($).map(({ text }) => text)).toEqual([
      'Applications',
      'Grassland applications, last 30 days',
      'A business, in any version',
      'FRPS cases by status, today',
      'Woodland case stages, today',
      'Dead letters by event, last 7 days',
      'Grant versions not stored yet',
      'A record’s events',
      'Agreements by status, with value',
      'Payments by marketing year, with amount'
    ])
    expect(items($)[0]).toEqual({
      text: 'Applications',
      name: 'pick',
      value: 'applications',
      type: 'submit',
      form: 'explore-form',
      recent: false
    })
    expect($('#explore-form').is('form')).toBe(true)
  })

  test('lists Recent first, as the use case orders it, each cut short on one line and picked by its id', async () => {
    showing(
      editorPage({
        recent: [
          { id: 'recent-1', q: typed },
          { id: 'recent-2', q: 'db.cases.find()' }
        ]
      })
    )

    const { $ } = await view()

    expect(groups($)).toEqual([
      { name: 'Your recent queries', items: ['explore-recent'] },
      { name: 'Examples', items: ['explore-example'] }
    ])
    expect(layout($)).toEqual(['Your recent queries', '—', 'Examples'])
    expect(recentOf($)).toEqual([
      "db.applications.find( { grant: 'woodland…",
      'db.cases.find()'
    ])
    expect(by($, 'explore-recent').first().find('.gpa-mono')).toHaveLength(1)
    expect(items($).filter(({ recent }) => recent)).toEqual([
      expect.objectContaining({
        name: 'pick',
        value: 'recent-1',
        type: 'submit',
        form: 'explore-form'
      }),
      expect.objectContaining({ value: 'recent-2' })
    ])
  })

  test('sends a pick to the use case, over the editor’s text that comes with it, and redirects to the run it holds', async () => {
    const posted = await post({ pick: 'frps-cases-by-status', q: typed })

    expect(wayInOf()).toEqual({ kind: 'pick', pick: 'frps-cases-by-status' })
    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(runHref)
  })

  test('says a pick the use case can’t find has expired', async () => {
    answering(editorPage({ q: '', notice: { kind: 'expired' } }))

    const { $, statusCode } = await post({ pick: 'everything', q: typed })

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'explore-alert')).toBe(
      'This query has expired. Run it again.'
    )
  })

  test.each([
    ['two ways at once', { q: typed, from: 'applications' }],
    ['Keep looking and a typed query', { q: typed, run: id, page: '2' }],
    ['Keep looking without its window', { run: id }],
    ['Find others without its record', { find: 'applications-by-business' }],
    ['no way in at all', {}]
  ])('refuses %s', async (_, payload) => {
    const { statusCode } = await post(payload as Record<string, string>)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(runExploreUseCase).not.toHaveBeenCalled()
  })
})

describe('Open in Explore', () => {
  /** The list's look the route gives the use case once it has found the list. */
  const idAt = (path: string) =>
    fullCatalogue.buckets.find((bucket) => bucket.path === path)?.id ?? ''

  /** The list the route gives the use case for the id GAS names: as the shell its answer carried has it. */
  const listOf = async (
    from: string,
    list: string,
    cookie = '',
    named = idAt(from)
  ) => {
    const found: { list: ExploredList | null } = { list: null }

    vi.mocked(runExploreUseCase).mockImplementation(async ({ wayIn }) => {
      found.list = wayIn.kind === 'list' ? wayIn.toList(named) : null

      return { kind: 'held', id }
    })

    const posted = await post({ from, list }, cookie)

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(runHref)

    return found.list
  }

  const lookOf = async (from: string, list: string, cookie = '') =>
    (await listOf(from, list, cookie))?.look ?? null

  const addressOf = async (from: string, list: string) => {
    await listOf(from, list)

    const wayIn = wayInOf()

    return wayIn.kind === 'list' ? wayIn.address : null
  }

  test('asks for the list by its path and its address’s facts as typed, without its range, paging or search keys, and the range as instants', async () => {
    expect(
      await addressOf(
        'grants',
        'status=active&definition=fetched&definition=pending&from=2026-10-01&to=2026-10-31&range=&cursor=c&page=2&through=3&searched=1&clear=all&audit=1'
      )
    ).toEqual({
      path: 'grants',
      params: { status: 'active', definition: ['fetched', 'pending'] },
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z'
    })
  })

  test('takes the list GAS named from the shell its answer carried', async () => {
    expect(await listOf('applications', '')).toMatchObject({
      bucket: fullCatalogue.buckets.find(({ path }) => path === 'applications')
    })
  })

  test('has no list for an id the shell doesn’t have', async () => {
    expect(await listOf('applications', '', '', 'gas.nowhere')).toBeNull()
  })

  const searchedIn = async (path: string, kind: string, value: string) =>
    (
      await post(
        { 'ref-kind': kind, 'ref-value': value },
        '',
        `/dev-ops/${path}`
      )
    ).cookie

  test('reads the list’s filters and range from its address, in the person’s zone, and its search from the session', async () => {
    const cookie = await searchedIn('applications', 'ref', 'wmp-aa1-bb2')

    expect(
      await lookOf(
        'applications',
        'grant=example-grant&from=2026-10-01&to=2026-10-31',
        cookie
      )
    ).toEqual({
      facts: { code: ['example-grant'] },
      window: {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-31T23:59:59.999Z'
      },
      search: 'ref:wmp-aa1-bb2'
    })
  })

  test('reads an error in the address as the list’s search, so the search held is not read with it', async () => {
    const cookie = await searchedIn('events/gas', 'ref', 'abc-123')

    expect(
      await lookOf('events/gas', 'error=Error%3A+Boom', cookie)
    ).toMatchObject({
      facts: { errorKey: 'Error: Boom' },
      search: ''
    })
    expect(await lookOf('events/gas', '', cookie)).toMatchObject({
      search: 'ref:abc-123'
    })
  })

  test('reads a list with nothing on as no facts, no range and no search', async () => {
    expect(await lookOf('applications', '')).toEqual({
      facts: {},
      window: {},
      search: ''
    })
  })

  test('reads a fact with several values as all of them', async () => {
    expect(
      await lookOf(
        'grants',
        'status=active&definition=fetched&definition=pending'
      )
    ).toEqual({
      facts: { status: ['active'], worstFetchStatus: ['fetched', 'pending'] },
      window: {},
      search: ''
    })
  })

  test('reads a quick range as its span back from now, as the list does', async () => {
    vi.useFakeTimers({
      now: new Date('2026-11-16T12:00:00Z'),
      toFake: ['Date']
    })

    try {
      expect(
        (await lookOf('applications', 'from=2026-11-01&range=24h'))?.window
      ).toEqual({ from: '2026-11-15T12:00:00.000Z' })
    } finally {
      vi.useRealTimers()
    }
  })

  test('refuses a list the use case doesn’t open', async () => {
    vi.mocked(runExploreUseCase).mockRejectedValue(Boom.notFound())

    const { statusCode } = await post({ from: 'nowhere', list: '' })

    expect(statusCode).toBe(statusCodes.notFound)
  })
})

describe('Find others', () => {
  test('sends the item and the record’s page to the use case, and redirects to the run it holds', async () => {
    const posted = await post({
      find: 'cases-by-sbi',
      record: '/dev-ops/cases/frps-private-beta/CASE-1'
    })

    expect(wayInOf()).toEqual({
      kind: 'find',
      find: 'cases-by-sbi',
      record: '/dev-ops/cases/frps-private-beta/CASE-1'
    })
    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(runHref)
  })

  test.each([
    [
      'an application with no business name',
      { kind: 'no-value', noun: 'application', by: 'business' } as const,
      'This application has no business name recorded. There are no others to find by it.'
    ],
    [
      'a case with no SBI',
      { kind: 'no-value', noun: 'case', by: 'sbi' } as const,
      'This case has no SBI recorded. There are no others to find by it.'
    ]
  ])('says when it is %s, and runs nothing', async (_, notice, text) => {
    answering(editorPage({ notice }))

    const { $, statusCode } = await post({
      find: 'cases-by-sbi',
      record: '/dev-ops/cases/frps-private-beta/CASE-1'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'explore-alert')).toBe(text)
    expect(by($, 'explore-results')).toHaveLength(0)
    expect($('#q').val()).toBe('db.applications.find()')
  })

  test('says when the record couldn’t be read', async () => {
    answering(
      editorPage({
        result: failed({
          kind: 'no-answer',
          service: 'GAS',
          failure: { kind: 'no-answer' }
        })
      })
    )

    const { $, statusCode } = await post({
      find: 'cases-by-sbi',
      record: '/dev-ops/cases/frps-private-beta/CASE-1'
    })

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(textOf($, 'explore-alert')).toContain(
      'The Grant Application Service didn’t answer in time.'
    )
  })

  test('refuses an item or a record the use case can’t name', async () => {
    vi.mocked(runExploreUseCase).mockRejectedValue(Boom.badRequest())

    const { statusCode } = await post({
      find: 'everything',
      record: '/dev-ops/grants/woodland/1.0.0'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
  })
})

describe('every Explore post to the run route', () => {
  test.each([
    [{ q: typed }],
    [{ pick: 'frps-cases-by-status' }],
    [{ run: id, page: '2' }],
    [{ from: 'applications', list: '' }],
    [
      {
        find: 'cases-by-sbi',
        record: '/dev-ops/cases/frps-private-beta/CASE-1'
      }
    ]
  ])('%o is refused from another site, and asks nothing', async (payload) => {
    for (const headers of [
      {},
      { 'sec-fetch-site': 'same-site' },
      { origin: 'https://other.cdp-int.defra.cloud' }
    ]) {
      const { statusCode } = await server.inject({
        method: 'POST',
        url: '/dev-ops/explore',
        payload,
        auth: { strategy: 'session', credentials },
        headers
      })

      expect(statusCode).toBe(statusCodes.forbidden)
    }

    expect(runExploreUseCase).not.toHaveBeenCalled()
  })
})

describe('every Explore page response', () => {
  test('is kept by no cache', async () => {
    const responses = [
      await view(),
      await post({ q: typed }),
      await ran(applications()),
      await post({ run: id, page: '2' }),
      await post({}),
      await server.inject({
        method: 'POST',
        url: '/dev-ops/explore',
        payload: { q: typed },
        auth: { strategy: 'session', credentials }
      })
    ]

    expect(responses.map(({ headers }) => headers['cache-control'])).toEqual(
      responses.map(() => 'no-store')
    )
  })
})

describe('whose runs', () => {
  test('are this session’s and this user’s, the same on every request of the session', async () => {
    const posted = await post({ q: typed })

    await view(runHref, posted.cookie)
    await post({ run: id, page: '2' }, posted.cookie)

    const [first, ...rest] = ownersOf()

    expect(first.user).toBe(credentials.user.id)
    expect(first.session).toEqual(expect.any(String))
    expect(rest).toEqual([first, first])
  })

  test('keep one user’s from another on the same session', async () => {
    const credentialsOf = (user: string) => ({
      ...credentials,
      user: { ...credentials.user, id: user }
    })
    const asA = await server.inject({
      method: 'POST',
      url: '/dev-ops/explore',
      payload: { q: typed },
      auth: { strategy: 'session', credentials: credentialsOf('oid-a') },
      headers: { 'sec-fetch-site': 'same-origin' }
    })

    await server.inject({
      method: 'GET',
      url: runHref,
      auth: { strategy: 'session', credentials: credentialsOf('oid-b') },
      headers: { cookie: withTimes(cookieOf(asA.headers['set-cookie'])) }
    })

    const [a, b] = ownersOf().reverse()

    expect(a).toEqual({ session: b.session, user: 'oid-a' })
    expect(b.user).toBe('oid-b')
  })
})

describe('signing out', () => {
  /** The browser's cookies after a response: each one it sets replaces the one of that name. */
  const merged = (cookie: string, setCookie: string | string[] | undefined) =>
    Object.entries(
      Object.fromEntries(
        [cookie, cookieOf(setCookie)]
          .flatMap((part) => part.split('; '))
          .filter(Boolean)
          .map((pair) => pair.split(/=(.*)/s).slice(0, 2))
      )
    )
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')

  /** Signs in through the app's own callback, as the user with this id, keeping whatever cookie the browser holds. */
  const signIn = async (oid: string, cookie = '') => {
    server.plugins['hapi-auth-oidc'].oidc.callback = async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      claims: { oid, name: 'Ada Lovelace', roles: credentials.scope }
    })
    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async (
      _request: Request,
      token: OidcToken
    ) => ({ token, refreshed: false })

    const { headers } = await server.inject({
      method: 'POST',
      url: '/auth/callback',
      headers: { cookie }
    })

    return merged(cookie, headers['set-cookie'])
  }

  const signedIn = async (
    method: 'GET' | 'POST',
    url: string,
    cookie: string,
    payload?: Record<string, string>
  ) => {
    const { headers } = await server.inject({
      method,
      url,
      payload,
      headers: { cookie: withTimes(cookie), 'sec-fetch-site': 'same-origin' }
    })

    return merged(cookie, headers['set-cookie'])
  }

  test.each([
    ['the same user', 'oid-a'],
    ['someone else', 'oid-b']
  ])(
    'leaves whoever signs in next on that browser a session of their own: %s',
    async (_, next) => {
      const first = await signIn('oid-a')
      const ran = await signedIn('POST', '/dev-ops/explore', first, {
        q: typed
      })

      await signedIn('GET', '/dev-ops/explore', ran)

      const out = await signedIn('GET', '/auth/logout', ran)
      const again = await signIn(next, out)

      await signedIn('GET', runHref, again)

      const owners: ExploreOwner[] = ownersOf()
      const before = owners.filter(({ user }) => user === 'oid-a').at(0)!
      const after = vi.mocked(viewExploreUseCase).mock.calls.at(-1)![0].owner

      expect(owners).toHaveLength(3)
      expect(after.user).toBe(next)
      expect(after.session).not.toBe(before.session)
    }
  )
})

describe('the editor’s values', () => {
  test('are only those the vocabulary carries: no route answers what is typed, and no list takes it', async () => {
    const { statusCode, location } = await post(
      { source: 'applications', field: 'currentStatus', q: 'rev' },
      '',
      '/dev-ops/explore/values'
    )

    expect(statusCode).toBe(statusCodes.notFound)
    expect(location).toBeUndefined()
    expect(runExploreUseCase).not.toHaveBeenCalled()
    expect(viewExploreUseCase).not.toHaveBeenCalled()
  })
})
