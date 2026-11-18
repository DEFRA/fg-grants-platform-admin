// @vitest-environment happy-dom
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { GrantEntitlements } from '../use-cases/get-grant-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import { grantVersionHeader } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../use-cases/get-grant-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-grant-page.use-case.ts')
  >('../use-cases/get-grant-page.use-case.ts')),
  getGrantPageUseCase: vi.fn()
}))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const entitlements: GrantEntitlements = {
  entitlementTemplates: [
    {
      claimCode: 'CAPITAL',
      name: 'Capital item',
      materialised: false,
      maxEntitlements: 10,
      availableAt: [{ phase: 'POST_AWARD', stage: 'AGREEMENT' }],
      fields: {
        quantity: {
          input: true,
          label: 'Quantity installed',
          unitType: 'decimal',
          decimalPlaces: 0,
          minValue: 1
        }
      }
    }
  ],
  claims: null,
  payment: null,
  statusNames: {}
}

let server: Server

/** The Entitlements tab with the script run, its fields table `contentWidth` wide in a box `boxWidth` wide. */
const open = async (contentWidth: number, boxWidth: number) => {
  const inBox = (element: HTMLElement) => element.matches('.gpa-table-scroll')
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return inBox(this) ? contentWidth : 0
    }
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return inBox(this) ? boxWidth : 0
    }
  )

  const { payload } = await server.inject({
    method: 'GET',
    url: '/dev-ops/grants/woodland-creation/1.2.0?tab=entitlements',
    auth: { strategy: 'session', credentials }
  })

  const template = document.createElement('template')
  template.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(payload)?.[1] ?? ''
  document.body.replaceChildren(template.content)
  await new Promise((resolve) => setTimeout(resolve, 0))

  return document.querySelector<HTMLElement>(
    '[data-testid="entitlements-template"] .gpa-table-scroll'
  )!
}

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
  await import('../views/components/index.ts')
})

beforeEach(() => {
  vi.mocked(getGrantPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header: grantVersionHeader,
      sourceErrors: [],
      sectionErrors: [],
      entitlements
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await server.stop()
})

describe('with the script, a template’s fields table', () => {
  test('that scrolls sideways is a tab stop, still the named table', async () => {
    const table = await open(720, 343)

    expect(table.classList.contains('is-scrolling')).toBe(true)
    expect(table.getAttribute('tabindex')).toBe('0')
    expect(table.getAttribute('role')).toBe('table')
    expect(table.getAttribute('aria-label')).toBe('Capital item fields')
  })

  test('that fits is no tab stop', async () => {
    const table = await open(720, 960)

    expect(table.classList.contains('is-fitting')).toBe(true)
    expect(table.hasAttribute('tabindex')).toBe(false)
  })
})
