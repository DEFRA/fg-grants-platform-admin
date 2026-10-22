import type {
  EntitlementField,
  EntitlementTemplate,
  GrantEntitlements
} from '../use-cases/get-grant-page.use-case.ts'
import { toEntitlementsTab } from './grant-entitlements.ts'

const paymentHref = '/dev-ops/grants/woodland-creation/1.2.0?tab=payment'

const hrefs = {
  phases: (status: string | null) =>
    status === null ? '/phases' : `/phases?status=${status}`,
  payment: paymentHref
}

const offered = { phase: 'POST_AWARD', stage: 'AGREEMENT', status: 'OFFERED' }
const complete = {
  phase: 'POST_AWARD',
  stage: 'AGREEMENT',
  status: 'CLAIMS_COMPLETE'
}

const claim: NonNullable<EntitlementTemplate['claim']> = {
  claimableAt: [{ phase: 'POST_AWARD', stage: 'AGREEMENT' }],
  limits: { maximumClaims: 10, allowsPartialClaims: false },
  requiresApproval: false,
  requiresEvidence: true
}

const template = (
  overrides: Partial<EntitlementTemplate> = {}
): EntitlementTemplate => ({
  claimCode: 'MAINTENANCE',
  name: 'Maintenance payment',
  materialised: false,
  maxEntitlements: 10,
  availableAt: [offered],
  claim,
  ...overrides
})

const entitlements = (
  overrides: Partial<GrantEntitlements> = {}
): GrantEntitlements => ({
  entitlementTemplates: [template()],
  claims: null,
  payment: null,
  ...overrides
})

const tabOf = (
  overrides: Partial<GrantEntitlements> = {},
  hasPaymentFile = true
) =>
  toEntitlementsTab(
    { entitlements: entitlements(overrides), hasPaymentFile },
    hrefs
  )

const onSubmitOf = (
  overrides: Partial<EntitlementTemplate>,
  rest: Partial<GrantEntitlements> = {},
  hasPaymentFile = true
) =>
  tabOf(
    { entitlementTemplates: [template(overrides)], ...rest },
    hasPaymentFile
  ).templates[0].onSubmit

const lastClaim = {
  claims: {
    onClaimApproval: { currentPosition: offered, targetPosition: complete }
  }
}

const readsAgreement = { sbi: '$.agreement.identifiers.sbi' }

describe('toEntitlementsTab: On submit', () => {
  test.each([
    ['a materialised template with a claim', { materialised: true }],
    ['a template with no claim', { claim: undefined }],
    ['an empty claimableAt', { claim: { ...claim, claimableAt: [] } }],
    ['no claimableAt', { claim: { ...claim, claimableAt: undefined } }]
  ])('is never claimable for %s', (_name, overrides) => {
    expect(onSubmitOf(overrides, lastClaim)).toEqual({
      label: 'Never claimable',
      role: 'neutral',
      movesOnLastClaim: false
    })
  })

  test('waits for approval, with no move even on the last claim', () => {
    expect(
      onSubmitOf({ claim: { ...claim, requiresApproval: true } }, lastClaim)
    ).toEqual({
      label: 'Waits for approval: no payment, no move',
      role: 'info',
      movesOnLastClaim: false
    })
  })

  test('pays now when the version has a payment file', () => {
    expect(onSubmitOf({})).toEqual({
      label: 'Pays now',
      role: 'success',
      movesOnLastClaim: false
    })
  })

  test('has no payment file to pay with when the version has none', () => {
    expect(onSubmitOf({}, {}, false)).toEqual({
      label: 'No payment file',
      role: 'warning',
      movesOnLastClaim: false
    })
  })

  test.each([true, false])(
    'moves on the last claim when the grant says so, payment file %s',
    (hasPaymentFile) => {
      expect(onSubmitOf({}, lastClaim, hasPaymentFile).movesOnLastClaim).toBe(
        true
      )
    }
  )

  test('pays now for a payment file that is not stored, with no warning', () => {
    const tab = tabOf({ payment: null }, true)

    expect(tab.templates[0].onSubmit.label).toBe('Pays now')
    expect(tab.warnings).toEqual([])
  })
})

describe('toEntitlementsTab: warnings', () => {
  test('warns of each problem, by template and then by kind', () => {
    const tab = tabOf({
      entitlementTemplates: [
        template({ claimCode: 'CAPITAL', materialised: true }),
        template({ claimCode: 'MAINTENANCE' }),
        template({
          claimCode: 'SURVEY',
          claim: { ...claim, claimableAt: [] }
        })
      ],
      payment: readsAgreement
    })

    expect(tab.warnings).toEqual([
      { kind: 'materialised-claim', claimCode: 'CAPITAL' },
      {
        kind: 'claim-payment-reads-agreement',
        claimCode: 'MAINTENANCE',
        paymentHref
      },
      { kind: 'no-claimable-at', claimCode: 'SURVEY' }
    ])
  })

  test('gives none for a clean definition', () => {
    expect(tabOf({ payment: { sbi: '$.claim.sbi' } }).warnings).toEqual([])
  })

  test.each([
    ['no stored payment definition', { payment: null }],
    [
      'a template that waits for approval',
      {
        payment: readsAgreement,
        entitlementTemplates: [
          template({ claim: { ...claim, requiresApproval: true } })
        ]
      }
    ],
    [
      'a definition that reads a key named like agreement',
      { payment: { sbi: '$.agreementNumber' } }
    ]
  ])('gives no claim payment warning for %s', (_name, overrides) => {
    expect(tabOf(overrides).warnings).toEqual([])
  })

  test('gives no claimableAt warning to a materialised template', () => {
    expect(
      tabOf({
        entitlementTemplates: [
          template({
            materialised: true,
            claim: { ...claim, claimableAt: undefined }
          })
        ]
      }).warnings
    ).toEqual([{ kind: 'materialised-claim', claimCode: 'MAINTENANCE' }])
  })
})

describe('toEntitlementsTab: position chips', () => {
  test('links a full position to its status on Phases', () => {
    expect(tabOf().templates[0].availableAt).toEqual([
      {
        parts: ['POST_AWARD', 'AGREEMENT', 'OFFERED'],
        prefix: false,
        href: '/phases?status=POST_AWARD:AGREEMENT:OFFERED'
      }
    ])
  })

  test.each([
    [{ phase: 'POST_AWARD', stage: 'AGREEMENT' }, ['POST_AWARD', 'AGREEMENT']],
    [{ phase: 'POST_AWARD' }, ['POST_AWARD']]
  ])('links a prefix to Phases with no status', (position, parts) => {
    expect(
      tabOf({
        entitlementTemplates: [template({ availableAt: [position] })]
      }).templates[0].availableAt
    ).toEqual([{ parts, prefix: true, href: '/phases' }])
  })

  test('gives no chips for an empty or absent claimableAt', () => {
    const [empty, absent] = tabOf({
      entitlementTemplates: [
        template({ claim: { ...claim, claimableAt: [] } }),
        template({ claim: { ...claim, claimableAt: undefined } })
      ]
    }).templates

    expect(empty.claim?.claimableAt).toEqual([])
    expect(absent.claim?.claimableAt).toEqual([])
  })
})

describe('toEntitlementsTab: claims', () => {
  test('gives the move on the last claim as two chips', () => {
    expect(tabOf(lastClaim).claims.move).toEqual({
      from: {
        parts: ['POST_AWARD', 'AGREEMENT', 'OFFERED'],
        prefix: false,
        href: '/phases?status=POST_AWARD:AGREEMENT:OFFERED'
      },
      to: {
        parts: ['POST_AWARD', 'AGREEMENT', 'CLAIMS_COMPLETE'],
        prefix: false,
        href: '/phases?status=POST_AWARD:AGREEMENT:CLAIMS_COMPLETE'
      }
    })
  })

  test('gives no move, no roles and no payment link when there is none', () => {
    expect(tabOf({ claims: null }, false).claims).toEqual({
      move: null,
      paymentHref: null,
      roles: null
    })
  })

  test('links the payment file when the version has one', () => {
    expect(tabOf().claims.paymentHref).toBe(paymentHref)
  })

  test('gives roles a list the grant leaves out as empty', () => {
    expect(
      tabOf({ claims: { requiredRoles: { allOf: ['Grants.Claims.Read'] } } })
        .claims.roles
    ).toEqual({ allOf: ['Grants.Claims.Read'], anyOf: [] })
  })
})

describe('toEntitlementsTab: templates', () => {
  test('shows the values GAS gives, with no description, claim or help', () => {
    expect(
      tabOf({
        entitlementTemplates: [
          template({
            claim: undefined,
            materialised: true,
            maxEntitlements: 1
          })
        ]
      }).templates[0]
    ).toEqual({
      claimCode: 'MAINTENANCE',
      name: 'Maintenance payment',
      description: null,
      materialised: true,
      maxEntitlements: 1,
      availableAt: [expect.objectContaining({ prefix: false })],
      claim: null,
      onSubmit: {
        label: 'Never claimable',
        role: 'neutral',
        movesOnLastClaim: false
      },
      fields: [],
      help: null
    })
  })

  test('shows the claim rules', () => {
    expect(tabOf().templates[0].claim).toEqual({
      claimableAt: [
        {
          parts: ['POST_AWARD', 'AGREEMENT'],
          prefix: true,
          href: '/phases'
        }
      ],
      maximumClaims: 10,
      partial: false,
      approval: false,
      evidence: true
    })
  })

  test('keeps the description and help', () => {
    const help = {
      summary: 'What counts',
      content: [{ text: 'Mown once.' }, { items: ['Cut', 'Graze'] }]
    }

    expect(
      tabOf({
        entitlementTemplates: [template({ description: 'Yearly', help })]
      }).templates[0]
    ).toMatchObject({ description: 'Yearly', help })
  })
})

describe('toEntitlementsTab: fields', () => {
  const fieldsOf = (fields: Record<string, EntitlementField>) =>
    tabOf({ entitlementTemplates: [template({ fields })] }).templates[0].fields

  test('gives a decimal input its bounds, leaving out a null one', () => {
    expect(
      fieldsOf({
        hectares: {
          input: true,
          label: 'Area maintained',
          unitType: 'decimal',
          decimalPlaces: 2,
          unit: 'ha',
          minValue: 0.1,
          maxValue: null
        }
      })
    ).toEqual([
      {
        name: 'hectares',
        input: true,
        text: 'Area maintained',
        unit: 'decimal (ha)',
        bounds: ['min 0.1', '2 dp']
      }
    ])
  })

  test('gives a string its length bounds', () => {
    expect(
      fieldsOf({
        reference: {
          input: true,
          label: 'Reference',
          unitType: 'string',
          minLength: 3,
          maxLength: 12
        }
      })[0]
    ).toMatchObject({
      unit: 'string',
      bounds: ['min length 3', 'max length 12']
    })
  })

  test('gives a string with no bounds none', () => {
    expect(
      fieldsOf({
        note: { input: true, label: 'Note', unitType: 'string' }
      })[0].bounds
    ).toEqual([])
  })

  test.each([
    ['a string', 'Woodland', 'Woodland'],
    ['a number', 120, '120'],
    ['a boolean', false, 'false']
  ])('shows a fixed %s as text', (_name, value, text) => {
    expect(
      fieldsOf({ rate: { input: false, value, unitType: 'string' } })[0]
    ).toMatchObject({ input: false, text })
  })
})
