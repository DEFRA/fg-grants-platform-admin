import type {
  EntitlementField,
  EntitlementTemplate,
  GrantEntitlements
} from '../use-cases/get-grant-page.use-case.ts'
import { toEntitlementsTab } from './grant-entitlements.ts'
import type { PaymentFileState } from './grant-entitlements.ts'

const paymentHref = '/dev-ops/grants/woodland-creation/1.2.0?tab=payment'

const hrefs = {
  phases: (status: string | null) =>
    status === null ? '/phases' : `/phases?status=${status}`,
  payment: paymentHref
}

const offeredChip = {
  label: 'Offered',
  code: 'POST_AWARD:AGREEMENT:OFFERED',
  any: null,
  href: '/phases?status=POST_AWARD:AGREEMENT:OFFERED'
}

const completeChip = {
  label: 'Claims complete',
  code: 'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE',
  any: null,
  href: '/phases?status=POST_AWARD:AGREEMENT:CLAIMS_COMPLETE'
}

const materialisedAlert = {
  tone: 'warning',
  title: 'Maintenance payment can’t be claimed.',
  text: [
    'It is materialised, which GAS doesn’t derive yet, so its claim rules never apply.'
  ]
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
  payment: PaymentFileState | null = 'stored'
) =>
  toEntitlementsTab({ entitlements: entitlements(overrides), payment }, hrefs)

const cardOf = (
  overrides: Partial<EntitlementTemplate>,
  payment: PaymentFileState | null = 'stored'
) =>
  tabOf({ entitlementTemplates: [template(overrides)] }, payment).templates[0]

const lastClaim = {
  claims: {
    onClaimApproval: { currentPosition: offered, targetPosition: complete }
  }
}

const move = { from: offeredChip, to: completeChip }

const readsAgreement = { sbi: '$.agreement.identifiers.sbi' }

describe('toEntitlementsTab: On submit', () => {
  test.each([
    ['a materialised template with a claim', { materialised: true }],
    [
      'a materialised template with no claim',
      { materialised: true, claim: undefined }
    ],
    ['a template with no claim', { claim: undefined }],
    ['an empty claimableAt', { claim: { ...claim, claimableAt: [] } }],
    ['no claimableAt', { claim: { ...claim, claimableAt: undefined } }]
  ])("can't be claimed for %s", (_name, overrides) => {
    expect(cardOf(overrides)).toMatchObject({
      badge: { text: 'Can’t be claimed', tone: 'danger' },
      cantClaim: true
    })
  })

  test.each(['not-stored', 'failed'] as const)(
    'requests payment when the payment file is %s',
    (payment) => {
      expect(cardOf({}, payment).badge).toEqual({
        text: 'On submit: Requests payment',
        tone: 'neutral'
      })
    }
  )
})

describe('toEntitlementsTab: the on-submit badge', () => {
  test.each([
    [
      'a template that can’t be claimed',
      cardOf({ materialised: true }),
      { text: 'Can’t be claimed', tone: 'danger' },
      true
    ],
    [
      'a claim that waits for approval',
      cardOf({ claim: { ...claim, requiresApproval: true } }),
      { text: 'On submit: Waits for approval', tone: 'neutral' },
      false
    ],
    [
      'a claim that requests payment',
      cardOf({}),
      { text: 'On submit: Requests payment', tone: 'neutral' },
      false
    ],
    [
      'a claim with no payment file to pay with',
      cardOf({}, null),
      { text: 'On submit: No payment file', tone: 'warning' },
      false
    ]
  ])('%s', (_name, card, badge, cantClaim) => {
    expect(card.badge).toEqual(badge)
    expect(card.cantClaim).toBe(cantClaim)
  })
})

describe('toEntitlementsTab: warnings', () => {
  test('warns of each problem on its own template', () => {
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

    expect(tab.templates.map(({ alerts }) => alerts)).toEqual([
      [materialisedAlert],
      [
        {
          tone: 'warning',
          title: 'Claim payments for Maintenance payment fail.',
          text: [
            'Claim payments can only read ',
            { code: '$.claim' },
            ' and ',
            { code: '$.execution' },
            ', but the ',
            { link: 'payment definition', href: paymentHref },
            ' reads ',
            { code: '$.agreement' },
            ', so those fields resolve empty and GAS refuses the payment.'
          ]
        }
      ],
      [
        {
          tone: 'danger',
          title: 'Maintenance payment can’t be claimed.',
          text: [
            'Its claim rules list no “Claimable at” status, so GAS rejects every claim (',
            { code: 'WRONG_POSITION' },
            '). Publish a version that sets ',
            { code: 'claim.claimableAt' },
            '.'
          ]
        }
      ]
    ])
  })

  test('gives none for a clean definition', () => {
    expect(
      tabOf({ payment: { sbi: '$.claim.sbi' } }).templates[0].alerts
    ).toEqual([])
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
    expect(tabOf(overrides).templates[0].alerts).toEqual([])
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
      }).templates[0].alerts
    ).toEqual([materialisedAlert])
  })
})

describe('toEntitlementsTab: position chips', () => {
  test('labels a full position by its status code made readable, without names, and links it to that status on Phases', () => {
    expect(tabOf().templates[0].availableAt).toEqual([offeredChip])
  })

  test("labels a full position by the grant's name for the status when GAS sends names", () => {
    expect(
      tabOf({
        statusNames: {
          'POST_AWARD:AGREEMENT:OFFERED': 'Agreement ready for applicant'
        }
      }).templates[0].availableAt[0]
    ).toEqual({ ...offeredChip, label: 'Agreement ready for applicant' })
  })

  test("says a stage prefix means any status, selecting the stage's first status", () => {
    expect(
      tabOf({
        entitlementTemplates: [
          template({
            availableAt: [{ phase: 'POST_AWARD', stage: 'AGREEMENT' }]
          })
        ]
      }).templates[0].availableAt
    ).toEqual([
      {
        label: 'POST_AWARD:AGREEMENT',
        code: 'POST_AWARD:AGREEMENT',
        any: 'status',
        href: '/phases?status=POST_AWARD:AGREEMENT'
      }
    ])
  })

  test("says a phase prefix means any stage and status, opening the phase's card", () => {
    expect(
      tabOf({
        entitlementTemplates: [template({ availableAt: [{ phase: 'CLAIM' }] })]
      }).templates[0].availableAt
    ).toEqual([
      {
        label: 'CLAIM',
        code: 'CLAIM',
        any: 'stage-and-status',
        href: '/phases#phase-CLAIM'
      }
    ])
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
    expect(tabOf(lastClaim).claims.move).toEqual(move)
  })

  test('gives no move, no roles and no payment link when there is none', () => {
    expect(tabOf({ claims: null }, null).claims).toEqual({
      move: null,
      paymentHref: null,
      roles: null
    })
  })

  test('links the payment definition when the version has one', () => {
    expect(tabOf().claims.paymentHref).toBe(paymentHref)
    expect(tabOf({}, null).claims.paymentHref).toBeNull()
  })

  test('gives roles a list the grant leaves out as empty', () => {
    expect(
      tabOf({ claims: { requiredRoles: { allOf: ['Grants.Claims.Read'] } } })
        .claims.roles
    ).toEqual({ allOf: ['Grants.Claims.Read'], anyOf: [] })
  })

  test.each([
    ['no claim rules', null],
    ['empty claim rules', {}]
  ])(
    'says nothing can be claimed with no templates and %s',
    (_name, claims) => {
      expect(tabOf({ entitlementTemplates: [], claims }).nothing).toBe(true)
    }
  )

  test('has something to show with claim rules or a template', () => {
    expect(tabOf({ entitlementTemplates: [], ...lastClaim }).nothing).toBe(
      false
    )
    expect(tabOf().nothing).toBe(false)
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
      name: 'Maintenance payment',
      description: null,
      materialised: true,
      maxEntitlements: 1,
      availableAt: [offeredChip],
      claim: null,
      badge: { text: 'Can’t be claimed', tone: 'danger' },
      cantClaim: true,
      alerts: [],
      fields: [],
      help: null
    })
  })

  test('shows the claim rules', () => {
    expect(tabOf().templates[0].claim).toEqual({
      claimableAt: [
        {
          label: 'POST_AWARD:AGREEMENT',
          code: 'POST_AWARD:AGREEMENT',
          any: 'status',
          href: '/phases?status=POST_AWARD:AGREEMENT'
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
        source: 'Entered',
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
    ).toMatchObject({ source: 'Fixed', text })
  })

  test('says a jsonata value comes from the agreement, without its prefix', () => {
    expect(
      fieldsOf({
        agreementRef: {
          input: false,
          value: 'jsonata:$.agreement.agreementNumber',
          unitType: 'string'
        }
      })[0]
    ).toMatchObject({
      source: 'From agreement',
      text: '$.agreement.agreementNumber'
    })
  })
})
