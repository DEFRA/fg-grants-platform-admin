import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import type {
  Chip,
  EntitlementsTab
} from '../../../view-models/grant-entitlements.ts'

const testId = 'grant-entitlements'

const flatten = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, name: string) =>
  $(`[data-testid="${testId}-${name}"]`)

const textOf = ($: CheerioAPI, name: string) => flatten(part($, name).text())

const offered: Chip = {
  parts: ['POST_AWARD', 'AGREEMENT', 'OFFERED'],
  prefix: false,
  href: '/phases?status=POST_AWARD:AGREEMENT:OFFERED'
}

const complete: Chip = {
  parts: ['POST_AWARD', 'AGREEMENT', 'CLAIMS_COMPLETE'],
  prefix: false,
  href: '/phases?status=POST_AWARD:AGREEMENT:CLAIMS_COMPLETE'
}

const agreementStage: Chip = {
  parts: ['POST_AWARD', 'AGREEMENT'],
  prefix: true,
  href: '/phases'
}

type TemplateCard = EntitlementsTab['templates'][number]

const template = (overrides: Partial<TemplateCard> = {}): TemplateCard => ({
  claimCode: 'MAINTENANCE',
  name: 'Maintenance payment',
  description: null,
  materialised: false,
  maxEntitlements: 10,
  availableAt: [offered],
  claim: {
    claimableAt: [agreementStage],
    maximumClaims: 10,
    partial: false,
    approval: false,
    evidence: true
  },
  onSubmit: { label: 'Pays now', role: 'success', movesOnLastClaim: false },
  fields: [],
  help: null,
  ...overrides
})

const tab = (overrides: Partial<EntitlementsTab> = {}): EntitlementsTab => ({
  claims: { move: null, paymentHref: null, roles: null },
  warnings: [],
  templates: [template()],
  ...overrides
})

const renderTab = (overrides: Partial<EntitlementsTab> = {}) =>
  render('grant-entitlements', { view: tab(overrides), testId })

const factText = ($: CheerioAPI, id: string) =>
  flatten(part($, `fact-${id}`).find('dd').text())

describe('grantEntitlements: the Claims card', () => {
  test('shows the move on the last claim as two chips with an arrow between', () => {
    const $ = renderTab({
      claims: {
        move: { from: offered, to: complete },
        paymentHref: '/payment',
        roles: { allOf: ['Grants.Claims.Read'], anyOf: [] }
      }
    })
    const move = part($, 'move')

    expect(part($, 'claims').attr('aria-label')).toBe('Claims')
    expect(
      move
        .find('a')
        .toArray()
        .map((chip) => $(chip).attr('href'))
    ).toEqual([offered.href, complete.href])
    expect(move.find('svg')).toHaveLength(1)
    expect(flatten(move.find('dd').text())).toBe(
      'POST_AWARD:AGREEMENT:OFFERED POST_AWARD:AGREEMENT:CLAIMS_COMPLETE'
    )
    expect(part($, 'payment-file').find('a').attr('href')).toBe('/payment')
    expect(flatten(part($, 'payment-file').find('dd').text())).toBe(
      'Payment definition'
    )
    expect(flatten(part($, 'roles').find('dd').text())).toBe(
      'Grants.Claims.Read'
    )
    expect(part($, 'roles').text()).not.toContain('any of')
  })

  test('shows a dash for no move and no payment file, and any operator for no roles', () => {
    const $ = renderTab()

    expect(flatten(part($, 'move').find('dd').text())).toBe('—')
    expect(flatten(part($, 'payment-file').find('dd').text())).toBe('—')
    expect(flatten(part($, 'roles').find('dd').text())).toBe('Any operator')
  })

  test('shows the any of roles on a line of their own', () => {
    const $ = renderTab({
      claims: {
        move: null,
        paymentHref: null,
        roles: { allOf: [], anyOf: ['Grants.Claims.Approve', 'Admin'] }
      }
    })

    const roles = part($, 'roles').find('dd')

    expect(flatten(roles.children('span').text())).toBe('—')
    expect(flatten(roles.find('div').text())).toBe(
      'any of Grants.Claims.Approve, Admin'
    )
  })
})

describe('grantEntitlements: warnings', () => {
  test('says each problem, with the code in mono and a link to the payment definition', () => {
    const $ = renderTab({
      warnings: [
        { kind: 'materialised-claim', claimCode: 'CAPITAL' },
        { kind: 'no-claimable-at', claimCode: 'SURVEY' },
        {
          kind: 'claim-payment-reads-agreement',
          claimCode: 'MAINTENANCE',
          paymentHref: '/payment'
        }
      ]
    })
    const warnings = part($, 'warning')

    expect(warnings.toArray().map((w) => flatten($(w).text()))).toEqual([
      'CAPITAL is materialised, so its claim block is never used.',
      'SURVEY has no claimableAt: every claim is rejected.',
      'MAINTENANCE pays on submit, but the payment definition reads $.agreement; claim payments carry only claim and execution.'
    ])
    expect(warnings.first().find('.font-mono').first().text()).toBe('CAPITAL')
    expect(warnings.last().find('a').attr('href')).toBe('/payment')
    expect(warnings.first().attr('role')).toBe('alert')
  })

  test('shows none for a clean definition', () => {
    expect(part(renderTab(), 'warning')).toHaveLength(0)
  })
})

describe('grantEntitlements: a template card', () => {
  test('titles the card with its claim code and name', () => {
    const $ = renderTab()

    expect(textOf($, 'template-title')).toBe('MAINTENANCE Maintenance payment')
    expect(part($, 'description')).toHaveLength(0)
  })

  test('shows the description when there is one', () => {
    const $ = renderTab({
      templates: [template({ description: 'Paid yearly.' })]
    })

    expect(textOf($, 'description')).toBe('Paid yearly.')
  })

  test('shows the Creation and Claiming rules', () => {
    const $ = renderTab()

    expect(factText($, 'materialised')).toBe('No')
    expect(factText($, 'max-entitlements')).toBe('10')
    expect(factText($, 'available-at')).toBe('POST_AWARD:AGREEMENT:OFFERED')
    expect(factText($, 'claimable-at')).toBe('POST_AWARD:AGREEMENT:*')
    expect(factText($, 'max-claims')).toBe('10 per entitlement')
    expect(factText($, 'partial')).toBe('No')
    expect(factText($, 'approval')).toBe('No')
    expect(factText($, 'evidence')).toBe('Yes')
    expect(factText($, 'on-submit')).toBe('Pays now')
  })

  test('shows a dash for every Claiming rule but On submit when there is no claim', () => {
    const $ = renderTab({
      templates: [
        template({
          materialised: true,
          claim: null,
          onSubmit: {
            label: 'Never claimable',
            role: 'neutral',
            movesOnLastClaim: false
          }
        })
      ]
    })

    expect(factText($, 'materialised')).toBe('Yes')
    expect(
      ['claimable-at', 'max-claims', 'partial', 'approval', 'evidence'].map(
        (id) => factText($, id)
      )
    ).toEqual(['—', '—', '—', '—', '—'])
    expect(factText($, 'on-submit')).toBe('Never claimable')
  })

  test('shows a dash for an empty claimableAt', () => {
    const $ = renderTab({
      templates: [
        template({
          claim: { ...template().claim!, claimableAt: [] }
        })
      ]
    })

    expect(factText($, 'claimable-at')).toBe('—')
  })

  test.each([
    ['neutral', 'status bg-base-content/80'],
    ['info', 'status status-info'],
    ['success', 'status status-success'],
    ['warning', 'status status-warning']
  ] as const)(
    'draws On submit with a %s dot that lets the text wrap',
    (role, dot) => {
      const $ = renderTab({
        templates: [
          template({
            onSubmit: { label: 'Pays now', role, movesOnLastClaim: false }
          })
        ]
      })
      const onSubmit = part($, 'on-submit')

      expect(onSubmit.attr('class')).toContain('items-baseline')
      expect(onSubmit.attr('class')).not.toContain('whitespace-nowrap')
      expect(onSubmit.children().first().attr('class')).toContain(dot)
    }
  )

  test('says it moves on the last claim, quietly', () => {
    const $ = renderTab({
      templates: [
        template({
          onSubmit: {
            label: 'Pays now',
            role: 'success',
            movesOnLastClaim: true
          }
        })
      ]
    })

    const moves = part($, 'fact-on-submit').find('dd > div')

    expect(textOf($, 'on-submit')).toBe('Pays now')
    expect(flatten(moves.text())).toBe('Moves on the last claim')
    expect(moves.children().attr('class')).toBe('text-base-content/60')
  })
})

describe('grantEntitlements: fields', () => {
  test('lists each field, with a fixed value in a code block', () => {
    const $ = renderTab({
      templates: [
        template({
          fields: [
            {
              name: 'hectares',
              input: true,
              text: 'Area maintained',
              unit: 'decimal (ha)',
              bounds: ['min 0.1', '2 dp']
            },
            {
              name: 'rate',
              input: false,
              text: '120',
              unit: 'string',
              bounds: []
            }
          ]
        })
      ]
    })

    expect(
      part($, 'fields')
        .find('th')
        .toArray()
        .map((th) => $(th).text())
    ).toEqual(['Field', 'Source', 'Label or value', 'Unit', 'Bounds'])
    expect(
      part($, 'field')
        .toArray()
        .map((row) =>
          $(row)
            .children('td')
            .toArray()
            .map((cell) => flatten($(cell).text()))
        )
    ).toEqual([
      ['hectares', 'Input', 'Area maintained', 'decimal (ha)', 'min 0.1, 2 dp'],
      ['rate', 'Fixed', '120', 'string', '—']
    ])
    expect(part($, 'field').last().find('code').text()).toBe('120')
  })

  test('has no table when there are no fields', () => {
    expect(part(renderTab(), 'fields')).toHaveLength(0)
  })
})

describe('grantEntitlements', () => {
  test('shows help closed, with its paragraphs and bullets', () => {
    const $ = renderTab({
      templates: [
        template({
          help: {
            summary: 'What counts',
            content: [{ text: 'Mown once.' }, { items: ['Cut', 'Graze'] }]
          }
        })
      ]
    })
    const help = part($, 'help')

    expect(help.is('details')).toBe(true)
    expect(help.attr('open')).toBeUndefined()
    expect(flatten(help.find('summary').text())).toBe('Help · What counts')
    expect(help.find('p').text()).toBe('Mown once.')
    expect(
      help
        .find('li')
        .toArray()
        .map((li) => $(li).text())
    ).toEqual(['Cut', 'Graze'])
  })

  test('breaks a chip between its parts, and marks a prefix', () => {
    const $ = renderTab()
    const [full, prefix] = part($, 'chip').toArray()

    expect($(full).find('wbr')).toHaveLength(2)
    expect($(full).text()).not.toContain(':*')
    expect($(prefix).find('wbr')).toHaveLength(1)
    expect($(prefix).find('.text-base-content\\/60').text()).toBe(':*')
    expect($(prefix).attr('href')).toBe('/phases')
  })

  test('says there are no templates, still showing the Claims card', () => {
    const $ = renderTab({ templates: [] })

    expect(textOf($, 'empty')).toBe('No entitlement templates.')
    expect(part($, 'claims')).toHaveLength(1)
    expect(part($, 'template')).toHaveLength(0)
  })
})
