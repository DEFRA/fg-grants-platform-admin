import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import type { GrantStatusMap } from '../../../use-cases/get-workflow-page.use-case.ts'
import { woodlandPhases } from '../../../use-cases/test-fixtures.ts'
import { toWorkflowPhases } from '../../../view-models/workflow-phases.view-model.ts'

const lifecycle = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: null,
      stages: [{ code: 'REVIEW', name: null, statuses: [{ code: 'APPROVED' }] }]
    }
  ],
  initialPosition: 'PRE_AWARD:REVIEW:APPROVED',
  amendablePositions: [],
  waysIn: [],
  externalMappings: [
    {
      source: 'CW',
      code: 'PRE_AWARD:REVIEW:APPROVED',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: '::APPROVED',
      to: 'PRE_AWARD:REVIEW:APPROVED'
    },
    {
      source: 'CW',
      code: 'PRE_AWARD:REVIEW:IN_REVIEW',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: 'P::X',
      to: 'P::X'
    }
  ],
  claimApproval: null
}

const found: GrantStatusMap = { outcome: 'found', lifecycle }

const renderPanel = (status: string, grant: GrantStatusMap = found) =>
  render(
    'workflow-status-panel',
    toWorkflowPhases(woodlandPhases, grant, status, {
      status: (position) => `/status/${position}`,
      grantStatus: (position) => `/grant/${position}`
    }).panel ?? {}
  )

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, name: string) =>
  $(`[data-testid="workflow-status-panel-${name}"]`)

const lines = ($: CheerioAPI, name: string) =>
  part($, name)
    .find('[data-testid="workflow-status-panel-way"]')
    .toArray()
    .map((line) => flatten($(line).text()))

describe('workflow-status-panel component', () => {
  test('badges the name in its theme, then the flags in order', () => {
    const $ = renderPanel('WITHDRAWN')
    const $badges = part($, 'badges')

    expect($badges.find('[data-testid="do-status-label"]').text()).toBe(
      'Withdrawn'
    )
    expect($badges.find('[data-testid="do-status-dot"]').attr('class')).toBe(
      'status bg-base-content/80'
    )
    expect(
      $badges
        .find('.badge-outline')
        .toArray()
        .map((badge) => $(badge).text())
    ).toEqual(['tasks read-only', 'closes case', 'hides tasks'])
  })

  test('shows the phase and stage', () => {
    expect(flatten(part(renderPanel('IN_REVIEW'), 'stage').text())).toBe(
      'Phase PRE_AWARD Pre-award Stage REVIEW Review application'
    )
  })

  test('raises one warning alert per finding', () => {
    const $alert = part(renderPanel('AWAITING_ACCEPTANCE'), 'finding')

    expect($alert).toHaveLength(1)
    expect($alert.attr('role')).toBe('alert')
    expect($alert.attr('class')).toContain('alert-warning')
    expect(flatten($alert.text())).toBe(
      'No ways out and does not close the case'
    )
    expect(
      $alert.find('[data-testid="do-icon-exclamation-triangle"]')
    ).toHaveLength(1)
    expect(part(renderPanel('IN_REVIEW'), 'finding')).toHaveLength(0)
  })

  test('lists the ways in, each linking its source, with the action code or GAS', () => {
    const $ = renderPanel('IN_REVIEW')

    expect(lines($, 'ways-in')).toEqual([
      'AWAITING_REVIEW START_REVIEW',
      'ON_HOLD RESUME',
      'RFI_SENT GAS'
    ])
    expect(part($, 'ways-in').find('a').first().attr('href')).toBe(
      '/status/PRE_AWARD:REVIEW:AWAITING_REVIEW'
    )
  })

  test('lists the ways out with their action and badges', () => {
    const $ = renderPanel('IN_REVIEW')

    expect(lines($, 'ways-out')).toEqual([
      '→ APPROVED Approve APPROVE comment confirm',
      '→ REJECTED Reject REJECT comment required confirm',
      '→ ON_HOLD Put on hold PUT_ON_HOLD comment required',
      '→ RFI_SENT Request information SEND_RFI comment required'
    ])
    expect(lines(renderPanel('APPROVED'), 'ways-out')).toEqual([
      '→ POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE GAS sends'
    ])
  })

  test('says a status with no way out closes the case, or shows —', () => {
    expect(flatten(part(renderPanel('REJECTED'), 'ways-out').text())).toBe(
      'Ways out Closes case'
    )
    expect(
      flatten(part(renderPanel('AWAITING_ACCEPTANCE'), 'ways-out').text())
    ).toBe('Ways out —')
  })

  test('links a mapped grant status, keyed on its stage', () => {
    const $ = renderPanel('APPROVED')

    expect(lines($, 'tells-gas')).toEqual([
      'while in PRE_AWARD:REVIEW → APPROVED'
    ])
    expect(part($, 'tells-gas').find('a').attr('href')).toBe(
      '/grant/PRE_AWARD:REVIEW:APPROVED'
    )
  })

  test('shows a target off the grant map as mono text, not a link', () => {
    const $ = renderPanel('IN_REVIEW')

    expect(lines($, 'tells-gas')).toEqual(['while in PRE_AWARD:REVIEW → P::X'])
    expect(part($, 'tells-gas').find('a')).toHaveLength(0)
    expect(part($, 'tells-gas').find('.font-mono').last().text()).toBe('P::X')
  })

  test('badges a status GAS has no mapping for as Not mapped, in the warning role', () => {
    const $tells = part(renderPanel('REJECTED'), 'tells-gas')

    expect($tells.find('[data-testid="do-status-label"]').text()).toBe(
      'Not mapped'
    )
    expect($tells.find('[data-testid="do-status-dot"]').attr('class')).toBe(
      'status status-warning'
    )
  })

  test.each([
    ['WITHDRAWN', found, '—'],
    ['AWAITING_ACCEPTANCE', found, 'Not sent (GAS moves only)'],
    ['APPROVED', { outcome: 'no-grant' } as const, 'No grant']
  ])('tells GAS, for %s, %j', (status, grant, text) => {
    expect(flatten(part(renderPanel(status, grant), 'tells-gas').text())).toBe(
      `Tells GAS ${text}`
    )
  })

  test('sets no inline style', () => {
    expect(renderPanel('IN_REVIEW')('[style]')).toHaveLength(0)
  })
})
