import type { GrantLifecycle } from '../use-cases/get-grant-page.use-case.ts'
import { toGrantPhases } from './grant-phases.view-model.ts'

const href = '/dev-ops/grants/woodland-creation/1.2.0'
const from = '/dev-ops/grants'

const lifecycle: GrantLifecycle = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: 'Pre award',
      stages: [
        {
          code: 'APPLICATION',
          name: 'Application',
          statuses: [{ code: 'RECEIVED' }, { code: 'AMEND' }]
        },
        {
          code: 'REVIEW',
          name: null,
          statuses: [{ code: 'IN_REVIEW' }, { code: 'APPROVED' }]
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
          statuses: [{ code: 'OFFERED' }, { code: 'CLAIMS_COMPLETE' }]
        }
      ]
    }
  ],
  initialPosition: 'PRE_AWARD:APPLICATION:RECEIVED',
  amendablePositions: ['PRE_AWARD:APPLICATION:AMEND'],
  waysIn: [
    { to: 'PRE_AWARD:APPLICATION:RECEIVED', kind: 'any', processes: [] },
    {
      to: 'PRE_AWARD:APPLICATION:AMEND',
      kind: 'move',
      from: 'PRE_AWARD:APPLICATION:RECEIVED',
      processes: []
    },
    {
      to: 'PRE_AWARD:APPLICATION:AMEND',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:IN_REVIEW',
      processes: ['NOTIFY']
    },
    {
      to: 'PRE_AWARD:APPLICATION:AMEND',
      kind: 'unmatched',
      code: 'PRE_AWARD:REVIEW:ON_HOLD',
      processes: ['HOLD', 'NOTIFY']
    },
    {
      to: 'PRE_AWARD:REVIEW:IN_REVIEW',
      kind: 'move',
      from: 'PRE_AWARD:APPLICATION:RECEIVED',
      processes: []
    },
    {
      to: 'PRE_AWARD:REVIEW:APPROVED',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:IN_REVIEW',
      processes: ['GENERATE_AGREEMENT']
    },
    {
      to: 'POST_AWARD:AGREEMENT:OFFERED',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:APPROVED',
      processes: []
    },
    {
      to: 'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE',
      kind: 'any',
      processes: ['PAY']
    }
  ],
  externalMappings: [
    {
      source: 'CW',
      code: 'PRE_AWARD:REVIEW_APPLICATION:RFI_SENT',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: '::AMEND',
      to: 'PRE_AWARD:APPLICATION:AMEND'
    },
    {
      source: 'AS',
      code: 'offered',
      whileIn: 'POST_AWARD:AGREEMENT',
      mappedTo: 'OFFERED',
      to: 'POST_AWARD:AGREEMENT:OFFERED'
    },
    {
      source: 'XX',
      code: 'odd',
      whileIn: 'POST_AWARD:AGREEMENT',
      mappedTo: 'OFFERED',
      to: 'POST_AWARD:AGREEMENT:OFFERED'
    },
    {
      source: 'CW',
      code: 'BROKEN',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: 'S:X',
      to: null
    },
    {
      source: 'CW',
      code: 'OFF_MAP',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: 'P::X',
      to: 'P::X'
    }
  ],
  claimApproval: {
    from: 'POST_AWARD:AGREEMENT:OFFERED',
    to: 'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE'
  }
}

const phasesOf = (
  status: string | undefined,
  workflowHref: ((code: string, back: string) => string) | null = null
) => {
  const tab = toGrantPhases(
    { lifecycle, problem: null },
    { status, href, from, workflowHref }
  )

  expect(tab?.kind).toBe('graph')

  return tab as Extract<NonNullable<typeof tab>, { kind: 'graph' }>
}

const panelOf = (...args: Parameters<typeof phasesOf>) =>
  phasesOf(...args).panel

const statusHref = (position: string) =>
  `${href}?tab=phases&back=%2Fdev-ops%2Fgrants&status=${encodeURIComponent(position)}`

describe('toGrantPhases', () => {
  test('is nothing when GAS sent neither a lifecycle nor a problem', () => {
    expect(
      toGrantPhases(
        { lifecycle: null, problem: null },
        { status: undefined, href, from, workflowHref: null }
      )
    ).toBeNull()
  })

  test("says why GAS cannot read the grant's lifecycle", () => {
    expect(
      toGrantPhases(
        { lifecycle: null, problem: 'Grant "x" has no initial position' },
        { status: undefined, href, from, workflowHref: null }
      )
    ).toStrictEqual({
      kind: 'unreadable',
      problem: 'Grant "x" has no initial position'
    })
  })

  test('shows even an empty problem rather than nothing', () => {
    expect(
      toGrantPhases(
        { lifecycle: null, problem: '' },
        { status: undefined, href, from, workflowHref: null }
      )
    ).toStrictEqual({ kind: 'unreadable', problem: '' })
  })

  test('draws every move, strong where it runs processes, titled with them', () => {
    const edges = phasesOf(undefined).graphs.phases.flatMap(({ edges }) =>
      edges.map(({ kind, title }) => [kind, title])
    )

    expect(edges).toContainEqual([
      'strong',
      'PRE_AWARD:REVIEW:IN_REVIEW → PRE_AWARD:REVIEW:APPROVED: GENERATE_AGREEMENT'
    ])
    expect(edges).toContainEqual([
      'plain',
      'PRE_AWARD:APPLICATION:RECEIVED → PRE_AWARD:APPLICATION:AMEND'
    ])
    expect(new Set(edges.map(([, title]) => title)).size).toBe(5)
  })

  test('draws statuses with no tone and never flagged, under named stages', () => {
    const [preAward] = phasesOf(undefined).graphs.phases

    expect(preAward.name).toBe('Pre award')
    expect(preAward.bands.map(({ code, name }) => [code, name])).toStrictEqual([
      ['APPLICATION', 'Application'],
      ['REVIEW', null]
    ])
    expect(
      preAward.nodes
        .filter((node) => node.kind === 'status')
        .map((node) => [node.tone, node.state])
    ).toStrictEqual([
      [null, 'selected'],
      [null, 'plain'],
      [null, 'plain'],
      [null, 'plain']
    ])
  })

  test('links each node to the tab with its status, keeping back', () => {
    const [preAward] = phasesOf(undefined).graphs.phases

    expect(preAward.nodes[0].href).toBe(
      statusHref('PRE_AWARD:APPLICATION:RECEIVED')
    )
  })

  test('keys the legend on processes and other phases', () => {
    expect(phasesOf(undefined).legend).toStrictEqual([
      { kind: 'strong', label: 'Runs processes' },
      { kind: 'plain', label: 'No processes' },
      { kind: 'other-phase', label: 'Other phase' }
    ])
  })

  test('describes the first status when none is asked for', () => {
    expect(panelOf(undefined)).toMatchObject({
      code: 'RECEIVED',
      badges: ['initial'],
      phase: { code: 'PRE_AWARD', name: 'Pre award' },
      stage: { code: 'APPLICATION', name: 'Application' },
      reachedFrom: [{ kind: 'any', processes: [] }]
    })
  })

  test('selects a status by its bare code', () => {
    expect(panelOf('APPROVED')?.code).toBe('APPROVED')
  })

  test('badges an amendable status', () => {
    expect(panelOf('PRE_AWARD:APPLICATION:AMEND')?.badges).toStrictEqual([
      'amendable'
    ])
  })

  test('lists the ways in in order: short in the stage, full outside it, with processes', () => {
    expect(panelOf('PRE_AWARD:APPLICATION:AMEND')?.reachedFrom).toStrictEqual([
      {
        kind: 'link',
        text: 'RECEIVED',
        href: statusHref('PRE_AWARD:APPLICATION:RECEIVED'),
        processes: []
      },
      {
        kind: 'link',
        text: 'PRE_AWARD:REVIEW:IN_REVIEW',
        href: statusHref('PRE_AWARD:REVIEW:IN_REVIEW'),
        processes: ['NOTIFY']
      },
      {
        kind: 'code',
        text: 'PRE_AWARD:REVIEW:ON_HOLD',
        processes: ['HOLD', 'NOTIFY']
      }
    ])
  })

  test('lists where a status moves to, with processes', () => {
    expect(panelOf('PRE_AWARD:REVIEW:IN_REVIEW')?.movesTo).toStrictEqual([
      {
        text: 'PRE_AWARD:APPLICATION:AMEND',
        href: statusHref('PRE_AWARD:APPLICATION:AMEND'),
        processes: ['NOTIFY']
      },
      {
        text: 'APPROVED',
        href: statusHref('PRE_AWARD:REVIEW:APPROVED'),
        processes: ['GENERATE_AGREEMENT']
      }
    ])
  })

  test('does not list statuses reached from any status under Moves to', () => {
    expect(panelOf('POST_AWARD:AGREEMENT:OFFERED')?.movesTo).toStrictEqual([])
  })

  test('puts the last claim first under Set by, linking to Entitlements', () => {
    expect(
      panelOf('POST_AWARD:AGREEMENT:CLAIMS_COMPLETE')?.setBy
    ).toStrictEqual([
      {
        kind: 'last-claim',
        from: 'POST_AWARD:AGREEMENT:OFFERED',
        href: `${href}?tab=entitlements&back=${encodeURIComponent(from)}`
      }
    ])
  })

  test('names each setter by its source, keyed on its stage', () => {
    expect(panelOf('POST_AWARD:AGREEMENT:OFFERED')?.setBy).toStrictEqual([
      {
        kind: 'external',
        label: 'Agreements offered',
        href: null,
        whileIn: 'POST_AWARD:AGREEMENT'
      },
      {
        kind: 'external',
        label: 'XX odd',
        href: null,
        whileIn: 'POST_AWARD:AGREEMENT'
      }
    ])
  })

  test('leaves a CW setter unlinked while there is no workflow to link to', () => {
    expect(panelOf('PRE_AWARD:APPLICATION:AMEND')?.setBy).toStrictEqual([
      {
        kind: 'external',
        label: 'CW PRE_AWARD:REVIEW_APPLICATION:RFI_SENT',
        href: null,
        whileIn: 'PRE_AWARD:REVIEW'
      }
    ])
  })

  test("links a CW setter to the workflow's status, coming back to this one", () => {
    const workflowHref = (code: string, back: string) =>
      `/workflow?status=${code}&back=${back}`

    expect(
      panelOf('PRE_AWARD:APPLICATION:AMEND', workflowHref)?.setBy[0]
    ).toMatchObject({
      href: `/workflow?status=PRE_AWARD:REVIEW_APPLICATION:RFI_SENT&back=${statusHref('PRE_AWARD:APPLICATION:AMEND')}`
    })
  })

  test('sets nothing from a mapping GAS cannot read or that lands off the map', () => {
    const setters = lifecycle.phases
      .flatMap((phase) =>
        phase.stages.flatMap((stage) =>
          stage.statuses.map(
            (status) => `${phase.code}:${stage.code}:${status.code}`
          )
        )
      )
      .map((position) => JSON.stringify(panelOf(position)?.setBy))
      .join()

    expect(setters).not.toContain('BROKEN')
    expect(setters).not.toContain('OFF_MAP')
  })

  test('gives a status no badges and no setters when nothing applies', () => {
    expect(panelOf('PRE_AWARD:REVIEW:APPROVED')).toMatchObject({
      badges: [],
      movesTo: [{ text: 'POST_AWARD:AGREEMENT:OFFERED' }],
      setBy: []
    })
  })
})
