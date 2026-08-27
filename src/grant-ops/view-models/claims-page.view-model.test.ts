import type {
  Banner,
  EntitlementTemplate
} from '../use-cases/get-claims.use-case.ts'
import { toClaimsPage, toTypeLabel } from './claims-page.view-model.ts'

const banner: Banner = {
  title: { text: 'Elmwood Land Co', type: 'string' },
  summary: {
    scheme: {
      label: 'Scheme',
      text: 'Woodland Management Plan',
      type: 'string'
    },
    applicationId: {
      label: 'Application ID',
      text: 'WMP-1T9-RXN',
      type: 'string'
    },
    sbi: { label: 'SBI', text: '113598882', type: 'string' }
  }
}

const template = (overrides: Partial<EntitlementTemplate> = {}) =>
  ({
    claimCode: 'ENT_CS_CAPITAL_PA3',
    name: 'PA3 Woodland Management Plan entitlement',
    description: 'The maximum eligible woodland area that can be claimed.',
    materialised: false,
    fields: {
      totalHectares: {
        input: true,
        label: 'Total area of eligible woodland',
        unitType: 'decimal',
        decimalPlaces: 4,
        unit: 'HA'
      }
    },
    maxEntitlements: 1,
    availableAt: { phase: 'PRE_AWARD' },
    ...overrides
  }) as EntitlementTemplate

const page = (
  availableEntitlements: EntitlementTemplate[] = [],
  claimsBanner: Banner = banner
) =>
  toClaimsPage('woodland', 'WMP-1T9-RXN', {
    banner: claimsBanner,
    availableEntitlements,
    claimableEntitlements: [],
    claims: []
  })

describe('toClaimsPage', () => {
  test('titles the header with what the grant configured', () => {
    expect(page().header.title).toBe('Elmwood Land Co')
  })

  // Which fields appear, their labels and their order belong to the grant
  // definition, so this maps them without naming one.
  test('carries the configured summary fields in order', () => {
    expect(page().header.summary).toEqual([
      { label: 'Scheme', text: 'Woodland Management Plan' },
      { label: 'Application ID', text: 'WMP-1T9-RXN' },
      { label: 'SBI', text: '113598882' }
    ])
  })

  test('shows any field a grant adds to its banner', () => {
    const { header } = page([], {
      summary: {
        agreement: { label: 'Agreement', text: 'FPTT147850259', type: 'string' }
      }
    })

    expect(header.summary).toEqual([
      { label: 'Agreement', text: 'FPTT147850259' }
    ])
  })

  test('reads a value that is not text', () => {
    const { header } = page([], {
      summary: { hectares: { label: 'Hectares', text: 40.25, type: 'number' } }
    })

    expect(header.summary).toEqual([{ label: 'Hectares', text: '40.25' }])
  })

  // A grant configuring no title is a config gap rather than a page to refuse,
  // so the summary still renders. A grant configuring no banner at all has no
  // claims page, which the route answers as a 404.
  test('renders the summary when a banner carries no title', () => {
    const { header } = page([], {
      summary: { sbi: { label: 'SBI', text: '113598882', type: 'string' } }
    })

    expect(header.title).toBe('')
    expect(header.summary).toEqual([{ label: 'SBI', text: '113598882' }])
  })

  test('renders the title when a banner carries no summary', () => {
    const { header } = page([], {
      title: { text: 'Elmwood Land Co', type: 'string' }
    })

    expect(header.title).toBe('Elmwood Land Co')
    expect(header.summary).toEqual([])
  })

  test('marks the claims tab as the current one', () => {
    expect(page().tabs).toEqual([
      { text: 'Application data', href: '#', current: false },
      {
        text: 'Claims',
        href: '/grant-ops/grants/woodland/applications/WMP-1T9-RXN/claims',
        current: true
      },
      { text: 'Payments', href: '#', current: false }
    ])
  })

  test('escapes the tab hrefs', () => {
    const [, claims] = toClaimsPage('wood land', 'wood/1001', {
      banner,
      availableEntitlements: [],
      claimableEntitlements: [],
      claims: []
    }).tabs

    expect(claims.href).toBe(
      '/grant-ops/grants/wood%20land/applications/wood%2F1001/claims'
    )
  })

  test('names the claims page itself', () => {
    expect(page().claimsHref).toBe(
      '/grant-ops/grants/woodland/applications/WMP-1T9-RXN/claims'
    )
  })

  test('turns a template into a row', () => {
    expect(page([template()]).entitlements).toEqual([
      {
        claimCode: 'ENT_CS_CAPITAL_PA3',
        name: 'PA3 Woodland Management Plan entitlement',
        type: 'Hectares',
        createdCount: 0,
        maxEntitlements: 1,
        canCreate: true,
        createHref:
          '/grant-ops/grants/woodland/applications/WMP-1T9-RXN/claims/new-entitlement/ENT_CS_CAPITAL_PA3#new-entitlement',
        unavailableReason: undefined
      }
    ])
  })

  test('counts nothing created until the backend reports a count', () => {
    const [row] = page([template({ maxEntitlements: 3 })]).entitlements

    expect(row.createdCount).toBe(0)
    expect(row.maxEntitlements).toBe(3)
    expect(row.canCreate).toBe(true)
  })

  test('reports a count the backend gives', () => {
    const [row] = page([
      template({ createdCount: 2, maxEntitlements: 3 })
    ]).entitlements

    expect(row.createdCount).toBe(2)
    expect(row.canCreate).toBe(true)
  })

  test('withholds creation once the maximum is reached', () => {
    const [row] = page([
      template({ createdCount: 1, maxEntitlements: 1 })
    ]).entitlements

    expect(row.canCreate).toBe(false)
    expect(row.createHref).toBeUndefined()
    expect(row.unavailableReason).toBe('Maximum created')
  })

  test('escapes the create href', () => {
    const [row] = toClaimsPage('wood land', 'wood/1001', {
      banner,
      availableEntitlements: [template({ claimCode: 'ENT/PA3' })],
      claimableEntitlements: [],
      claims: []
    }).entitlements

    expect(row.createHref).toBe(
      '/grant-ops/grants/wood%20land/applications/wood%2F1001/claims/new-entitlement/ENT%2FPA3#new-entitlement'
    )
  })
})

describe('toTypeLabel', () => {
  test('names a known unit', () => {
    expect(toTypeLabel(template())).toBe('Hectares')
  })

  test('prefers the unit of a field the case officer fills in', () => {
    expect(
      toTypeLabel(
        template({
          fields: {
            fixedLength: {
              input: false,
              value: 10,
              unitType: 'decimal',
              unit: 'M'
            },
            area: {
              input: true,
              label: 'Area',
              unitType: 'decimal',
              unit: 'HA'
            }
          }
        })
      )
    ).toBe('Hectares')
  })

  test('falls back to the unit a definition names', () => {
    expect(
      toTypeLabel(
        template({
          fields: {
            trees: {
              input: true,
              label: 'Trees',
              unitType: 'decimal',
              unit: 'TREES'
            }
          }
        })
      )
    ).toBe('TREES')
  })

  test('has no type when no field carries a unit', () => {
    expect(
      toTypeLabel(
        template({
          fields: {
            reference: { input: true, label: 'Reference', unitType: 'string' }
          }
        })
      )
    ).toBeUndefined()
  })

  test('has no type when the template declares no fields', () => {
    expect(toTypeLabel(template({ fields: undefined }))).toBeUndefined()
  })
})
