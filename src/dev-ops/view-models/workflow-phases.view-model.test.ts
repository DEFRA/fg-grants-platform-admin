import type {
  ExternalStatusMapping,
  GrantLifecycle,
  GrantStatusMap,
  StoredTransition,
  StoredWorkflowPhase,
  StoredWorkflowStatus
} from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandPhases } from '../use-cases/test-fixtures.ts'
import { toWorkflowPhases } from './workflow-phases.view-model.ts'

const links = {
  status: (position: string) => `status:${position}`,
  grantStatus: (position: string) => `grant:${position}`
}

const cwMapping = (
  code: string,
  whileIn: string,
  to: string | null,
  mappedTo = to ?? 'A:B'
): ExternalStatusMapping => ({ source: 'CW', code, whileIn, mappedTo, to })

/** The woodland grant as GAS describes it, with its map keyed by full CW position as real maps are. */
const lifecycle: GrantLifecycle = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: null,
      stages: [
        {
          code: 'APPLICATION',
          name: null,
          statuses: [{ code: 'RECEIVED' }, { code: 'AMEND' }]
        },
        {
          code: 'REVIEW',
          name: null,
          statuses: [
            { code: 'IN_REVIEW' },
            { code: 'ON_HOLD' },
            { code: 'APPROVED' },
            { code: 'REJECTED' }
          ]
        }
      ]
    },
    {
      code: 'POST_AWARD',
      name: null,
      stages: [
        {
          code: 'AGREEMENT',
          name: null,
          statuses: [{ code: 'OFFERED' }, { code: 'ACCEPTED' }]
        }
      ]
    }
  ],
  initialPosition: 'PRE_AWARD:APPLICATION:RECEIVED',
  amendablePositions: [],
  waysIn: [],
  externalMappings: [
    cwMapping(
      'PRE_AWARD:REVIEW:IN_REVIEW',
      'PRE_AWARD:REVIEW',
      'PRE_AWARD:REVIEW:IN_REVIEW',
      '::IN_REVIEW'
    ),
    cwMapping(
      'PRE_AWARD:REVIEW:APPROVED',
      'PRE_AWARD:REVIEW',
      'PRE_AWARD:REVIEW:APPROVED',
      '::APPROVED'
    ),
    cwMapping(
      'PRE_AWARD:REVIEW:RFI_SENT',
      'PRE_AWARD:REVIEW',
      'PRE_AWARD:APPLICATION:AMEND'
    ),
    {
      source: 'AS',
      code: 'PRE_AWARD:REVIEW:REJECTED',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: '::REJECTED',
      to: 'PRE_AWARD:REVIEW:REJECTED'
    }
  ],
  claimApproval: null
}

const found: GrantStatusMap = { outcome: 'found', lifecycle }

const withMappings = (externalMappings: ExternalStatusMapping[]) =>
  ({
    outcome: 'found',
    lifecycle: { ...lifecycle, externalMappings }
  }) as const

const tabFor = (
  asked: string | undefined,
  grant: GrantStatusMap = found,
  phases: StoredWorkflowPhase[] = woodlandPhases
) => toWorkflowPhases(phases, grant, asked, links)

const panelFor = (
  asked: string,
  grant?: GrantStatusMap,
  phases?: StoredWorkflowPhase[]
) => {
  const { panel } = tabFor(asked, grant, phases)

  if (!panel) {
    throw new Error('no panel')
  }

  return panel
}

const status = (
  code: string,
  transitions: StoredTransition[] = [],
  overrides: Partial<StoredWorkflowStatus> = {}
): StoredWorkflowStatus => ({
  code,
  name: code,
  theme: 'NEUTRAL',
  interactive: true,
  hideTaskGroups: false,
  transitions,
  ...overrides
})

const gas = (targetPosition: string, checkTasks = false): StoredTransition => ({
  targetPosition,
  checkTasks,
  action: null
})

const action = (targetPosition: string, code: string): StoredTransition => ({
  targetPosition,
  checkTasks: false,
  action: { code, name: code, checkTasks: false, comment: null }
})

const onePhase = (
  ...stages: [string, StoredWorkflowStatus[]][]
): StoredWorkflowPhase[] => [
  {
    code: 'P',
    name: 'Phase',
    stages: stages.map(([code, statuses]) => ({ code, name: code, statuses }))
  }
]

const flaggedNodes = (asked?: string, phases?: StoredWorkflowPhase[]) =>
  tabFor(asked, found, phases)
    .graphs.phases.flatMap(({ nodes }) => nodes)
    .filter(({ kind, state }) => kind === 'status' && state === 'flagged')
    .map(({ position }) => position)

describe('toWorkflowPhases', () => {
  test('finds the statuses nothing reaches, and those a case never leaves', () => {
    expect(panelFor('WITHDRAWN').findings).toEqual(['No ways in'])
    expect(panelFor('ACCEPTED').findings).toEqual(['No ways in'])
    expect(panelFor('AWAITING_ACCEPTANCE').findings).toEqual([
      'No ways out and does not close the case'
    ])
    expect(panelFor('AWAITING_REVIEW').findings).toEqual([])
    expect(panelFor('REJECTED').findings).toEqual([])
  })

  test('outlines each status with a finding, and adds Finding to the legend', () => {
    expect(flaggedNodes('IN_REVIEW')).toEqual([
      'PRE_AWARD:REVIEW:WITHDRAWN',
      'POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE',
      'POST_AWARD:AGREEMENT:ACCEPTED'
    ])
    expect(tabFor(undefined).legend).toEqual([
      { kind: 'plain', label: 'Action' },
      { kind: 'dashed', label: 'GAS sends' },
      { kind: 'flagged', label: 'Finding' },
      { kind: 'other-phase', label: 'Other phase' }
    ])
  })

  test('has no Finding in the legend without a finding', () => {
    const phases = onePhase([
      'S',
      [status('A', [action('P:S:B', 'GO')]), status('B', [], { closes: true })]
    ])

    expect(tabFor(undefined, found, phases).legend).toEqual([
      { kind: 'plain', label: 'Action' },
      { kind: 'dashed', label: 'GAS sends' },
      { kind: 'other-phase', label: 'Other phase' }
    ])
  })

  test('has no initial status when the first stage is empty, as CW cannot start a case', () => {
    const phases = onePhase(
      ['EMPTY', []],
      [
        'S',
        [
          status('A', [action('P:S:B', 'GO')]),
          status('B', [], { closes: true })
        ]
      ]
    )

    expect(panelFor('A', found, phases).findings).toEqual(['No ways in'])
    expect(panelFor('B', found, phases).findings).toEqual([])
  })

  test('draws an action as a solid move and a move GAS sends as a dashed one', () => {
    const edges = tabFor(undefined).graphs.phases[0].edges

    expect(edges.find(({ title }) => title === 'Approve (APPROVE)')?.kind).toBe(
      'plain'
    )
    expect(
      edges.filter(({ kind }) => kind === 'dashed').map(({ title }) => title)
    ).toEqual(['GAS sends', 'GAS sends'])
  })

  test('draws no move to a target not on the map, and lists it as it is stored', () => {
    const phases = onePhase([
      'S',
      [
        status('A', [gas('P:S:GONE'), gas('::B')]),
        status('B', [], { closes: true })
      ]
    ])
    const tab = tabFor('A', found, phases)

    expect(tab.graphs.phases[0].edges).toEqual([])
    expect(tab.panel?.waysOut.map(({ to }) => to)).toEqual([
      { text: 'P:S:GONE', href: null },
      { text: '::B', href: null }
    ])
    expect(panelFor('B', found, phases).waysIn).toEqual([])
  })

  test('lists a move to itself both ways', () => {
    const phases = onePhase(['S', [status('A', [gas('P:S:A')])]])
    const panel = panelFor('A', found, phases)

    expect(panel.waysIn).toEqual([
      { from: { text: 'A', href: 'status:P:S:A' }, via: { kind: 'gas' } }
    ])
    expect(panel.waysOut).toEqual([
      {
        to: { text: 'A', href: 'status:P:S:A' },
        move: { kind: 'gas', badges: [] }
      }
    ])
  })

  test('badges the actions out of a status, and the moves GAS sends by their own checkTasks', () => {
    expect(panelFor('IN_REVIEW').waysOut).toEqual([
      {
        to: { text: 'APPROVED', href: 'status:PRE_AWARD:REVIEW:APPROVED' },
        move: {
          kind: 'action',
          name: 'Approve',
          code: 'APPROVE',
          badges: ['comment', 'confirm']
        }
      },
      {
        to: { text: 'REJECTED', href: 'status:PRE_AWARD:REVIEW:REJECTED' },
        move: {
          kind: 'action',
          name: 'Reject',
          code: 'REJECT',
          badges: ['comment required', 'confirm']
        }
      },
      {
        to: { text: 'ON_HOLD', href: 'status:PRE_AWARD:REVIEW:ON_HOLD' },
        move: {
          kind: 'action',
          name: 'Put on hold',
          code: 'PUT_ON_HOLD',
          badges: ['comment required']
        }
      },
      {
        to: { text: 'RFI_SENT', href: 'status:PRE_AWARD:REVIEW:RFI_SENT' },
        move: {
          kind: 'action',
          name: 'Request information',
          code: 'SEND_RFI',
          badges: ['comment required']
        }
      }
    ])
  })

  test('badges tasks done on the action and on a move GAS sends', () => {
    const phases = onePhase([
      'S',
      [
        status('A', [
          {
            targetPosition: 'P:S:B',
            checkTasks: false,
            action: { code: 'GO', name: 'Go', checkTasks: true, comment: null }
          },
          gas('P:S:B', true)
        ]),
        status('B', [], { closes: true })
      ]
    ])

    expect(
      panelFor('A', found, phases).waysOut.map(({ move }) => move.badges)
    ).toEqual([['tasks done'], ['tasks done']])
  })

  test('says a status with no way out closes the case', () => {
    expect(panelFor('REJECTED')).toMatchObject({ waysOut: [], closes: true })
    expect(panelFor('AWAITING_ACCEPTANCE')).toMatchObject({
      waysOut: [],
      closes: false
    })
  })

  test('shortens positions within the selected status stage, in both lists', () => {
    expect(panelFor('IN_REVIEW').waysIn).toEqual([
      {
        from: {
          text: 'AWAITING_REVIEW',
          href: 'status:PRE_AWARD:REVIEW:AWAITING_REVIEW'
        },
        via: { kind: 'action', code: 'START_REVIEW' }
      },
      {
        from: { text: 'ON_HOLD', href: 'status:PRE_AWARD:REVIEW:ON_HOLD' },
        via: { kind: 'action', code: 'RESUME' }
      },
      {
        from: { text: 'RFI_SENT', href: 'status:PRE_AWARD:REVIEW:RFI_SENT' },
        via: { kind: 'gas' }
      }
    ])
    expect(panelFor('APPROVED').waysOut[0].to).toEqual({
      text: 'POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE',
      href: 'status:POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE'
    })
    expect(panelFor('AWAITING_ACCEPTANCE').waysIn[0].from).toEqual({
      text: 'PRE_AWARD:REVIEW:APPROVED',
      href: 'status:PRE_AWARD:REVIEW:APPROVED'
    })
  })

  test('names the status, its theme and phase and stage, and its flags in order', () => {
    expect(panelFor('WITHDRAWN')).toMatchObject({
      code: 'WITHDRAWN',
      name: 'Withdrawn',
      role: 'neutral',
      flags: ['tasks read-only', 'closes case', 'hides tasks'],
      phase: { code: 'PRE_AWARD', name: 'Pre-award' },
      stage: { code: 'REVIEW', name: 'Review application' }
    })
    expect(panelFor('ON_HOLD')).toMatchObject({ role: 'warning', flags: [] })
  })

  test('gives a status with no theme no colour in the panel, and a neutral dot on the graph', () => {
    const phases = onePhase([
      'S',
      [status('A', [gas('P:S:A')], { theme: 'NONE', closes: true })]
    ])
    const tab = tabFor('A', found, phases)

    expect(tab.panel?.role).toBeNull()
    expect(tab.graphs.phases[0].nodes[0]).toMatchObject({ tone: 'neutral' })
  })

  test('Tells GAS nothing with no ways in', () => {
    expect(panelFor('WITHDRAWN').tellsGas).toEqual({ kind: 'none' })
  })

  test('Tells GAS it sends nothing when only GAS moves into the status', () => {
    expect(panelFor('AWAITING_ACCEPTANCE').tellsGas).toEqual({
      kind: 'text',
      text: 'Not sent (GAS moves only)'
    })
  })

  test.each([
    ['no-grant', 'No grant'],
    ['not-stored', 'Grant definition not stored'],
    ['unreadable', 'Grant definition cannot be read'],
    ['unavailable', 'Grant could not be read from fg-gas-backend'],
    ['timed-out', 'Grant could not be read from fg-gas-backend']
  ] as const)('Tells GAS, for a grant read that is %s, %j', (outcome, text) => {
    expect(panelFor('IN_REVIEW', { outcome }).tellsGas).toEqual({
      kind: 'text',
      text
    })
  })

  test('Tells GAS Not mapped when no CW mapping names the full position', () => {
    expect(panelFor('REJECTED').tellsGas).toEqual({ kind: 'not-mapped' })
    expect(panelFor('ON_HOLD', withMappings([])).tellsGas).toEqual({
      kind: 'not-mapped'
    })
  })

  test('Tells GAS by the full position only, as CW publishes it', () => {
    const bare = withMappings([
      cwMapping('IN_REVIEW', 'PRE_AWARD:REVIEW', 'PRE_AWARD:REVIEW:IN_REVIEW')
    ])

    expect(panelFor('IN_REVIEW', bare).tellsGas).toEqual({
      kind: 'not-mapped'
    })
  })

  test('Tells GAS the grant status, linked, within the keyed stage', () => {
    expect(panelFor('APPROVED').tellsGas).toEqual({
      kind: 'mapped',
      lines: [
        {
          keyedOn: 'PRE_AWARD:REVIEW',
          to: { text: 'APPROVED', href: 'grant:PRE_AWARD:REVIEW:APPROVED' }
        }
      ]
    })
  })

  test('Tells GAS a target in the keyed phase to its stage and status, and gives one line per keyed stage', () => {
    const twoStages = withMappings([
      cwMapping(
        'PRE_AWARD:REVIEW:ON_HOLD',
        'PRE_AWARD:REVIEW',
        'PRE_AWARD:APPLICATION:AMEND'
      ),
      cwMapping(
        'PRE_AWARD:REVIEW:ON_HOLD',
        'POST_AWARD:AGREEMENT',
        'PRE_AWARD:REVIEW:IN_REVIEW'
      )
    ])

    expect(panelFor('ON_HOLD', twoStages).tellsGas).toEqual({
      kind: 'mapped',
      lines: [
        {
          keyedOn: 'PRE_AWARD:REVIEW',
          to: {
            text: 'APPLICATION:AMEND',
            href: 'grant:PRE_AWARD:APPLICATION:AMEND'
          }
        },
        {
          keyedOn: 'POST_AWARD:AGREEMENT',
          to: {
            text: 'PRE_AWARD:REVIEW:IN_REVIEW',
            href: 'grant:PRE_AWARD:REVIEW:IN_REVIEW'
          }
        }
      ]
    })
  })

  test('Tells GAS a target off the grant map, or one GAS cannot read, as text', () => {
    const offMap = withMappings([
      cwMapping('PRE_AWARD:REVIEW:ON_HOLD', 'PRE_AWARD:REVIEW', 'P::X', 'P::X'),
      cwMapping('PRE_AWARD:REVIEW:ON_HOLD', 'POST_AWARD:AGREEMENT', null, 'A:B')
    ])

    expect(panelFor('ON_HOLD', offMap).tellsGas).toEqual({
      kind: 'mapped',
      lines: [
        { keyedOn: 'PRE_AWARD:REVIEW', to: { text: 'P::X', href: null } },
        { keyedOn: 'POST_AWARD:AGREEMENT', to: { text: 'A:B', href: null } }
      ]
    })
  })
  test('counts only the first copy of a status held twice', () => {
    const phases = onePhase([
      'S',
      [
        status('A', [action('P:S:B', 'FIRST')]),
        status('B', [], { closes: true }),
        status('A', [action('P:S:B', 'SECOND')])
      ]
    ])
    const tab = tabFor('A', found, phases)

    expect(tab.graphs.duplicated).toEqual(['P:S:A'])
    expect(tab.panel?.waysOut.map(({ move }) => move)).toMatchObject([
      { code: 'FIRST' }
    ])
    expect(panelFor('B', found, phases).waysIn).toEqual([
      {
        from: { text: 'A', href: 'status:P:S:A' },
        via: { kind: 'action', code: 'FIRST' }
      }
    ])
  })

  test('has no panel without statuses', () => {
    expect(tabFor(undefined, found, onePhase(['S', []])).panel).toBeNull()
  })

  test('selects by full position or bare code, and the first status otherwise', () => {
    expect(panelFor('PRE_AWARD:REVIEW:ON_HOLD').code).toBe('ON_HOLD')
    expect(panelFor('ON_HOLD').code).toBe('ON_HOLD')
    expect(panelFor('junk').code).toBe('AWAITING_REVIEW')
  })

  test('links each status by its full position', () => {
    expect(
      tabFor(undefined).graphs.phases[1].nodes.map(({ href }) => href)
    ).toContain('status:POST_AWARD:AGREEMENT:ACCEPTED')
  })
})
