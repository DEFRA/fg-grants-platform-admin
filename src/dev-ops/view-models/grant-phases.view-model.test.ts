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
          statuses: [
            { code: 'RECEIVED', name: 'Application received' },
            { code: 'AMEND' }
          ]
        },
        {
          code: 'REVIEW',
          name: null,
          statuses: [{ code: 'IN_REVIEW', name: null }, { code: 'APPROVED' }]
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
  workflowHref: ((code: string, back: string) => string) | null = null,
  read: GrantLifecycle = lifecycle
) => {
  const tab = toGrantPhases(
    { lifecycle: read, problem: null },
    { status, href, from, workflowHref }
  )

  expect(tab?.kind).toBe('graph')

  return tab as Extract<NonNullable<typeof tab>, { kind: 'graph' }>
}

const panelOf = (...args: Parameters<typeof phasesOf>) =>
  phasesOf(...args).panel

const statusHref = (position: string) =>
  `${href}?tab=phases&back=%2Fdev-ops%2Fgrants&status=${encodeURIComponent(position)}`

const panelHref = (position: string) => `${statusHref(position)}#panel`

/** GAS-16's read: what each process does, and that the claim move tells CW. */
const withEffects: GrantLifecycle = {
  ...lifecycle,
  waysIn: [
    ...lifecycle.waysIn.map((wayIn) => ({ ...wayIn, processEffects: [] })),
    {
      to: 'PRE_AWARD:REVIEW:IN_REVIEW',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:APPROVED',
      processes: ['REQUEST_APPLICATION_WITHDRAWAL'],
      processEffects: [
        {
          process: 'REQUEST_APPLICATION_WITHDRAWAL',
          setsStatus: 'APPROVED',
          tellsCw: true,
          onlyWhen: 'no agreement is on offer'
        },
        {
          process: 'REQUEST_APPLICATION_WITHDRAWAL',
          setsStatus: 'WITHDRAWN',
          tellsCw: true,
          onlyWhen: null
        }
      ]
    }
  ],
  claimApproval: { ...lifecycle.claimApproval!, tellsCw: true }
}

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

  test('draws every move, strong where it runs a GAS process, dashed where it only moves', () => {
    const edges = phasesOf(undefined).graphs.phases.flatMap(({ edges }) =>
      edges.map(({ kind, title }) => [kind, title])
    )

    expect(edges).toContainEqual([
      'strong',
      'PRE_AWARD:REVIEW:IN_REVIEW → PRE_AWARD:REVIEW:APPROVED: GENERATE_AGREEMENT'
    ])
    expect(edges).toContainEqual([
      'dashed',
      'PRE_AWARD:APPLICATION:RECEIVED → PRE_AWARD:APPLICATION:AMEND'
    ])
    expect(new Set(edges.map(([, title]) => title)).size).toBe(5)
  })

  test("names each node by the definition's name, else its code made readable", () => {
    const [preAward] = phasesOf(undefined).graphs.phases

    expect(
      preAward.nodes
        .filter((node) => node.kind === 'status')
        .map(({ name }) => name)
    ).toStrictEqual(['Application received', 'Amend', 'In review', 'Approved'])
  })

  test('draws statuses with no tone, under named stages', () => {
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

  test('chips a status GAS accepts from any status', () => {
    const nodes = phasesOf(undefined).graphs.phases.flatMap(({ nodes }) =>
      nodes.flatMap((node) =>
        node.kind === 'status' && node.chip ? [[node.position, node.chip]] : []
      )
    )

    expect(nodes).toStrictEqual([
      ['PRE_AWARD:APPLICATION:RECEIVED', 'any status'],
      ['POST_AWARD:AGREEMENT:CLAIMS_COMPLETE', 'any status']
    ])
  })

  test('links each node to the tab with its status and the panel, keeping back', () => {
    const [preAward] = phasesOf(undefined).graphs.phases

    expect(preAward.nodes[0].href).toBe(
      panelHref('PRE_AWARD:APPLICATION:RECEIVED')
    )
  })

  test('keys the legend on GAS processes, moves only and other phases', () => {
    expect(phasesOf(undefined).legend).toStrictEqual([
      { kind: 'strong', label: 'Runs a GAS process on the move' },
      { kind: 'dashed', label: 'Move only' },
      { kind: 'other-phase', label: 'Other phase' }
    ])
  })

  test('describes the first status when none is asked for, naming its phase and stage', () => {
    expect(panelOf(undefined)).toMatchObject({
      badges: [{ label: 'initial', title: 'New applications start here' }],
      phase: { code: 'PRE_AWARD', name: 'Pre award' },
      stage: { code: 'APPLICATION', name: 'Application' },
      waysIn: [{ kind: 'any', processes: [] }]
    })
  })

  test('names a stage with no name by its code made readable', () => {
    expect(panelOf('APPROVED')?.stage).toStrictEqual({
      code: 'REVIEW',
      name: 'Review'
    })
  })

  test('badges an amendable status, saying what it means', () => {
    expect(panelOf('PRE_AWARD:APPLICATION:AMEND')?.badges).toStrictEqual([
      {
        label: 'amendable',
        title:
          'The applicant can submit an amended application from here (amendablePositions)'
      }
    ])
  })

  test("lists the ways in by name, the stage named only outside the status's own, the code beneath", () => {
    expect(panelOf('PRE_AWARD:APPLICATION:AMEND')?.waysIn).toStrictEqual([
      {
        kind: 'move',
        from: {
          name: 'Application received',
          stageName: null,
          code: 'RECEIVED',
          position: 'PRE_AWARD:APPLICATION:RECEIVED',
          href: panelHref('PRE_AWARD:APPLICATION:RECEIVED')
        },
        processes: [],
        bareCode: null
      },
      {
        kind: 'move',
        from: {
          name: 'In review',
          stageName: 'Review',
          code: 'PRE_AWARD:REVIEW:IN_REVIEW',
          position: 'PRE_AWARD:REVIEW:IN_REVIEW',
          href: panelHref('PRE_AWARD:REVIEW:IN_REVIEW')
        },
        processes: ['NOTIFY'],
        bareCode: null
      },
      {
        kind: 'code',
        code: 'PRE_AWARD:REVIEW:ON_HOLD',
        processes: ['HOLD', 'NOTIFY'],
        bareCode: null
      }
    ])
  })

  test('says what triggers each way out, keyed on the selected status’s stage', () => {
    const [toAmend, toApproved] = panelOf('PRE_AWARD:REVIEW:IN_REVIEW')!.waysOut

    expect(toAmend).toMatchObject({
      to: { name: 'Amend', stageName: 'Application' },
      processes: ['NOTIFY'],
      triggers: [
        {
          kind: 'sends',
          source: 'CW',
          code: 'PRE_AWARD:REVIEW_APPLICATION:RFI_SENT'
        }
      ],
      untriggered: false
    })
    expect(toApproved).toMatchObject({ triggers: [], untriggered: false })
  })

  test('says the last claim triggers its move', () => {
    const waysOut = panelOf('POST_AWARD:AGREEMENT:OFFERED')!.waysOut

    expect(waysOut).toStrictEqual([])
    expect(
      panelOf('POST_AWARD:AGREEMENT:CLAIMS_COMPLETE')!.triggeredBy
    ).toStrictEqual([
      {
        kind: 'claim',
        at: {
          name: 'Offered',
          stageName: null,
          code: 'OFFERED',
          position: 'POST_AWARD:AGREEMENT:OFFERED',
          href: `${href}?tab=phases&back=${encodeURIComponent(from)}&status=${encodeURIComponent('POST_AWARD:AGREEMENT:OFFERED')}#panel`
        },
        href: `${href}?tab=entitlements&back=${encodeURIComponent(from)}`
      }
    ])
  })

  test('names each trigger by its source and the stage it is keyed on', () => {
    expect(panelOf('POST_AWARD:AGREEMENT:OFFERED')?.triggeredBy).toStrictEqual([
      {
        kind: 'external',
        source: 'Agreements',
        code: 'offered',
        href: null,
        stageName: 'Agreement',
        missingStage: null
      },
      {
        kind: 'external',
        source: 'unknown source XX',
        code: 'odd',
        href: null,
        stageName: 'Agreement',
        missingStage: null
      }
    ])
  })

  test("links a CW trigger to the workflow's status, coming back to this one", () => {
    const workflowHref = (code: string, back: string) =>
      `/workflow?status=${code}&back=${back}`

    expect(
      panelOf('PRE_AWARD:APPLICATION:AMEND', workflowHref)?.triggeredBy[0]
    ).toMatchObject({
      href: `/workflow?status=PRE_AWARD:REVIEW_APPLICATION:RFI_SENT&back=${statusHref('PRE_AWARD:APPLICATION:AMEND')}`
    })
  })

  test('marks a mapping keyed on a stage this version has not got', () => {
    const legacy: GrantLifecycle = {
      ...lifecycle,
      externalMappings: [
        {
          source: 'CW',
          code: 'TRIAGED',
          whileIn: 'PRE_AWARD:LEGACY_TRIAGE',
          mappedTo: '::AMEND',
          to: 'PRE_AWARD:APPLICATION:AMEND'
        }
      ]
    }

    expect(
      panelOf('PRE_AWARD:APPLICATION:AMEND', null, legacy)?.triggeredBy
    ).toMatchObject([
      { stageName: 'Legacy triage', missingStage: 'LEGACY_TRIAGE' }
    ])
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
      .map((position) => JSON.stringify(panelOf(position)?.triggeredBy))
      .join()

    expect(setters).not.toContain('BROKEN')
    expect(setters).not.toContain('OFF_MAP')
  })

  test('says the initial status is set on submission when nothing else sets it', () => {
    const initialOnly: GrantLifecycle = {
      ...lifecycle,
      externalMappings: []
    }

    expect(panelOf(undefined, null, initialOnly)).toMatchObject({
      triggeredBy: [],
      noTrigger: 'initial'
    })
  })
})

describe('toGrantPhases without what GAS processes do, as from an older GAS', () => {
  test('never says a move or a status has no trigger, nor flags a node', () => {
    const panel = panelOf('PRE_AWARD:REVIEW:APPROVED')

    expect(panel).toMatchObject({
      badges: [],
      triggeredBy: [],
      noTrigger: null,
      undefinedTargets: []
    })
    expect(panel?.waysOut.every(({ untriggered }) => !untriggered)).toBe(true)
    expect(
      phasesOf(undefined)
        .graphs.phases.flatMap(({ nodes }) => nodes)
        .some(({ state }) => state === 'flagged')
    ).toBe(false)
  })
})

describe('toGrantPhases with what GAS processes do', () => {
  test('lists a status a GAS process sets itself under Triggered by', () => {
    expect(
      panelOf('PRE_AWARD:REVIEW:APPROVED', null, withEffects)?.triggeredBy
    ).toStrictEqual([
      {
        kind: 'gas',
        process: 'REQUEST_APPLICATION_WITHDRAWAL',
        onEntering: 'In review',
        onlyWhen: 'no agreement is on offer'
      }
    ])
  })

  test('says the process triggers the move from the status it runs on to the one it sets', () => {
    const waysOut = panelOf(
      'PRE_AWARD:REVIEW:IN_REVIEW',
      null,
      withEffects
    )?.waysOut

    expect(waysOut?.[1]).toMatchObject({
      to: { position: 'PRE_AWARD:REVIEW:APPROVED' },
      triggers: [{ kind: 'gas', process: 'REQUEST_APPLICATION_WITHDRAWAL' }],
      untriggered: false
    })
  })

  test('warns of a status GAS sets that the grant does not define, on the move target', () => {
    expect(
      panelOf('PRE_AWARD:REVIEW:IN_REVIEW', null, withEffects)?.undefinedTargets
    ).toStrictEqual([
      { position: 'PRE_AWARD:REVIEW:WITHDRAWN', onlyWhen: null }
    ])
  })

  test('warns of a way out nothing in this version triggers', () => {
    expect(
      panelOf('PRE_AWARD:APPLICATION:RECEIVED', null, withEffects)?.waysOut
    ).toMatchObject([
      { to: { position: 'PRE_AWARD:APPLICATION:AMEND' }, untriggered: true },
      { to: { position: 'PRE_AWARD:REVIEW:IN_REVIEW' }, untriggered: true }
    ])
  })

  test('says nothing sets a status nothing triggers, and flags its node', () => {
    const withClosure: GrantLifecycle = {
      ...withEffects,
      phases: [
        ...withEffects.phases,
        {
          code: 'CLOSURE',
          name: null,
          stages: [{ code: 'END', name: null, statuses: [{ code: 'CLOSED' }] }]
        }
      ]
    }
    const tab = phasesOf('CLOSED', null, withClosure)

    expect(tab.graphs.phases[2].nodes[0].state).toBe('selected')
    expect(tab.panel?.noTrigger).toBe('nothing')
    expect(
      phasesOf(undefined, null, withClosure).graphs.phases[2].nodes[0].state
    ).toBe('flagged')
  })
})

describe('toGrantPhases: what a way runs, once GAS says what its processes do', () => {
  test('counts only the processes GAS has a handler for', () => {
    const tab = phasesOf('PRE_AWARD:APPLICATION:AMEND', null, withEffects)
    const edge = tab.graphs.phases[0].edges.find(({ title }) =>
      title.startsWith(
        'PRE_AWARD:REVIEW:IN_REVIEW → PRE_AWARD:APPLICATION:AMEND'
      )
    )

    expect(tab.panel?.waysIn).toMatchObject([
      { kind: 'move', processes: [] },
      { kind: 'move', processes: [] },
      { kind: 'code', processes: [] }
    ])
    expect(edge?.kind).toBe('dashed')
  })

  test('sets a status from a GAS process run on a way from any status', () => {
    const fromAny: GrantLifecycle = {
      ...withEffects,
      waysIn: [
        ...withEffects.waysIn,
        {
          to: 'POST_AWARD:AGREEMENT:OFFERED',
          kind: 'any',
          processes: ['WITHDRAW'],
          processEffects: [
            {
              process: 'WITHDRAW',
              setsStatus: 'CLAIMS_COMPLETE',
              tellsCw: true,
              onlyWhen: null
            }
          ]
        }
      ]
    }

    expect(
      panelOf('POST_AWARD:AGREEMENT:CLAIMS_COMPLETE', null, fromAny)
        ?.triggeredBy
    ).toContainEqual({
      kind: 'gas',
      process: 'WITHDRAW',
      onEntering: 'Offered',
      onlyWhen: null
    })
  })

  test('names the finding on a flagged node, and keys it in the legend', () => {
    const tab = phasesOf(undefined, null, withEffects)
    const flagged = tab.graphs.phases
      .flatMap(({ nodes }) => nodes)
      .filter(({ state }) => state === 'flagged')

    expect(flagged.length).toBeGreaterThan(0)
    expect(
      flagged.every(({ label }) =>
        label.endsWith(', finding: nothing in this version sets it')
      )
    ).toBe(true)
    expect(tab.legend).toContainEqual({
      kind: 'flagged',
      label: 'Nothing in this version sets it'
    })
    expect(phasesOf(undefined).legend.map(({ kind }) => kind)).not.toContain(
      'flagged'
    )
  })
})

const isBareMove = (wayIn: GrantLifecycle['waysIn'][number]) =>
  wayIn.kind === 'move' &&
  wayIn.from === 'PRE_AWARD:REVIEW:IN_REVIEW' &&
  wayIn.to === 'PRE_AWARD:APPLICATION:AMEND'

const matchedBy = (wayIn: GrantLifecycle['waysIn'][number]) =>
  isBareMove(wayIn) ? 'status' : 'position'

/** GAS-16's read, which says how each `validFrom` entry matched. */
const bare: GrantLifecycle = {
  ...lifecycle,
  waysIn: lifecycle.waysIn.map((wayIn) =>
    wayIn.kind === 'any' ? wayIn : { ...wayIn, matchedBy: matchedBy(wayIn) }
  )
}

describe('a way matched by a bare status code', () => {
  test('names the code in Ways in and Ways out', () => {
    expect(
      panelOf('PRE_AWARD:APPLICATION:AMEND', null, bare)?.waysIn.map(
        (way) => way.kind !== 'any' && way.bareCode
      )
    ).toEqual([null, { code: 'IN_REVIEW', said: false }, null])
    expect(
      panelOf('PRE_AWARD:REVIEW:IN_REVIEW', null, bare)?.waysOut.map(
        ({ bareCode }) => bareCode
      )
    ).toEqual([{ code: 'IN_REVIEW', said: false }, null])
  })

  test('says it aloud only where the code is in more than one stage of this version', () => {
    const repeated: GrantLifecycle = {
      ...bare,
      phases: bare.phases.map((phase) =>
        phase.code === 'POST_AWARD'
          ? {
              ...phase,
              stages: phase.stages.map((stage) => ({
                ...stage,
                statuses: [...stage.statuses, { code: 'IN_REVIEW' }]
              }))
            }
          : phase
      )
    }

    expect(
      panelOf('PRE_AWARD:REVIEW:IN_REVIEW', null, repeated)?.waysOut[0].bareCode
    ).toEqual({ code: 'IN_REVIEW', said: true })
  })

  test('draws its edge dotted, and adds its legend item', () => {
    const tab = phasesOf(undefined, null, bare)
    const kinds = tab.graphs.phases
      .flatMap(({ edges }) => edges)
      .map(({ kind }) => kind)

    expect(kinds).toContain('dotted')
    expect(tab.legend.at(-1)).toEqual({
      kind: 'dotted',
      label: 'Matched by status code only, in any stage'
    })
  })

  test('says nothing of how a way matched when GAS does not say', () => {
    const tab = phasesOf(undefined)

    expect(
      tab.graphs.phases.flatMap(({ edges }) => edges).map(({ kind }) => kind)
    ).not.toContain('dotted')
    expect(tab.legend.map(({ kind }) => kind)).not.toContain('dotted')
    expect(
      panelOf('PRE_AWARD:REVIEW:IN_REVIEW')?.waysOut.map(
        ({ bareCode }) => bareCode
      )
    ).toEqual([null, null])
  })
})
