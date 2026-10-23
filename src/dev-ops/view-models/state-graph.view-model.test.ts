import {
  toStateGraphs,
  UnknownPositionError
} from './state-graph.view-model.ts'
import type {
  MoveKind,
  PhaseGraph,
  StateMap,
  StateMove,
  StatePhase
} from './state-graph.view-model.ts'

const phase = (
  code: string,
  stages: Record<string, string[]>,
  tone: 'info' | null = null
): StatePhase => ({
  code,
  name: null,
  stages: Object.entries(stages).map(([stage, statuses]) => ({
    code: stage,
    name: null,
    statuses: statuses.map((status) => ({
      code: status,
      name: status,
      tone,
      flagged: false
    }))
  }))
})

const move = (
  from: string,
  to: string,
  kind: MoveKind = 'plain'
): StateMove => ({
  from,
  to,
  kind,
  title: `${from} → ${to}`
})

const graphsOf = (map: StateMap, asked?: string) =>
  toStateGraphs(map, asked, (position) => `?status=${position}`)

const layoutOf = (graph: PhaseGraph) =>
  Object.fromEntries(
    graph.nodes.map((node) => [
      node.kind === 'status' ? node.position : `${node.kind} ${node.position}`,
      [node.x, node.y, node.width]
    ])
  )

const columnsOf = (graph: PhaseGraph) =>
  Object.fromEntries(graph.nodes.map((node) => [node.position, node.x]))

const nodeOf = (graph: PhaseGraph, position: string) =>
  graph.nodes.filter((node) => node.position === position)[0]

const single = (...moves: StateMove[]) =>
  graphsOf({ phases: [phase('P', { S: ['A', 'B', 'C', 'D'] })], moves })
    .phases[0]

/** A grant's phases: moves back within a phase, and on into the next one. */
const woodlandGrant: StateMap = {
  phases: [
    phase('PRE_AWARD', {
      APPLICATION: ['RECEIVED', 'AMEND'],
      REVIEW: ['IN_REVIEW', 'ON_HOLD', 'APPROVED', 'REJECTED', 'WITHDRAWN']
    }),
    phase('POST_AWARD', {
      AGREEMENT: ['OFFERED', 'ACCEPTED', 'DECLINED', 'CLAIMS_COMPLETE']
    })
  ],
  moves: [
    move('PRE_AWARD:APPLICATION:RECEIVED', 'PRE_AWARD:APPLICATION:AMEND'),
    move('PRE_AWARD:REVIEW:ON_HOLD', 'PRE_AWARD:APPLICATION:AMEND'),
    move('PRE_AWARD:APPLICATION:RECEIVED', 'PRE_AWARD:REVIEW:IN_REVIEW'),
    move('PRE_AWARD:REVIEW:IN_REVIEW', 'PRE_AWARD:REVIEW:ON_HOLD'),
    move('PRE_AWARD:REVIEW:IN_REVIEW', 'PRE_AWARD:REVIEW:APPROVED', 'strong'),
    move('PRE_AWARD:REVIEW:IN_REVIEW', 'PRE_AWARD:REVIEW:REJECTED'),
    move('PRE_AWARD:REVIEW:ON_HOLD', 'PRE_AWARD:REVIEW:REJECTED'),
    move('PRE_AWARD:REVIEW:IN_REVIEW', 'PRE_AWARD:REVIEW:WITHDRAWN'),
    move('PRE_AWARD:REVIEW:ON_HOLD', 'PRE_AWARD:REVIEW:WITHDRAWN'),
    move('PRE_AWARD:REVIEW:APPROVED', 'POST_AWARD:AGREEMENT:OFFERED', 'strong'),
    move(
      'POST_AWARD:AGREEMENT:OFFERED',
      'POST_AWARD:AGREEMENT:ACCEPTED',
      'strong'
    ),
    move('POST_AWARD:AGREEMENT:OFFERED', 'POST_AWARD:AGREEMENT:DECLINED'),
    move(
      'POST_AWARD:AGREEMENT:ACCEPTED',
      'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE'
    )
  ]
}

/** A workflow's phases: toned statuses, findings, and a move GAS sends. */
const floodWorkflow: StateMap = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: 'Pre-award',
      stages: [
        {
          code: 'REVIEW',
          name: 'Review application',
          statuses: [
            {
              code: 'AWAITING_REVIEW',
              name: 'AWAITING_REVIEW',
              tone: 'neutral',
              flagged: false
            },
            {
              code: 'IN_REVIEW',
              name: 'IN_REVIEW',
              tone: 'info',
              flagged: false
            },
            {
              code: 'ON_HOLD',
              name: 'ON_HOLD',
              tone: 'warning',
              flagged: false
            },
            {
              code: 'RFI_SENT',
              name: 'RFI_SENT',
              tone: 'warning',
              flagged: false
            },
            {
              code: 'APPROVED',
              name: 'APPROVED',
              tone: 'success',
              flagged: false
            },
            {
              code: 'REJECTED',
              name: 'REJECTED',
              tone: 'error',
              flagged: false
            },
            {
              code: 'WITHDRAWN',
              name: 'WITHDRAWN',
              tone: 'neutral',
              flagged: true
            }
          ]
        }
      ]
    },
    {
      code: 'POST_AWARD',
      name: 'Post-award',
      stages: [
        {
          code: 'AGREEMENT',
          name: 'Agreement',
          statuses: [
            {
              code: 'AWAITING_ACCEPTANCE',
              name: 'AWAITING_ACCEPTANCE',
              tone: 'info',
              flagged: true
            },
            {
              code: 'ACCEPTED',
              name: 'ACCEPTED',
              tone: 'success',
              flagged: true
            }
          ]
        }
      ]
    }
  ],
  moves: [
    move('PRE_AWARD:REVIEW:AWAITING_REVIEW', 'PRE_AWARD:REVIEW:IN_REVIEW'),
    move('PRE_AWARD:REVIEW:IN_REVIEW', 'PRE_AWARD:REVIEW:APPROVED'),
    move('PRE_AWARD:REVIEW:IN_REVIEW', 'PRE_AWARD:REVIEW:REJECTED'),
    move('PRE_AWARD:REVIEW:IN_REVIEW', 'PRE_AWARD:REVIEW:ON_HOLD'),
    move('PRE_AWARD:REVIEW:IN_REVIEW', 'PRE_AWARD:REVIEW:RFI_SENT'),
    move('PRE_AWARD:REVIEW:ON_HOLD', 'PRE_AWARD:REVIEW:IN_REVIEW'),
    move('PRE_AWARD:REVIEW:RFI_SENT', 'PRE_AWARD:REVIEW:IN_REVIEW', 'dashed'),
    move(
      'PRE_AWARD:REVIEW:APPROVED',
      'POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE',
      'dashed'
    )
  ]
}

describe('toStateGraphs', () => {
  test("places every node and edge of a grant's phases", () => {
    const [preAward, postAward] = graphsOf(woodlandGrant).phases

    expect([preAward.width, preAward.height]).toEqual([401, 354])
    expect(layoutOf(preAward)).toEqual({
      'PRE_AWARD:APPLICATION:RECEIVED': [20, 38, 104],
      'PRE_AWARD:APPLICATION:AMEND': [168, 38, 104],
      'PRE_AWARD:REVIEW:IN_REVIEW': [20, 210, 104],
      'PRE_AWARD:REVIEW:ON_HOLD': [168, 126, 104],
      'PRE_AWARD:REVIEW:APPROVED': [168, 182, 104],
      'PRE_AWARD:REVIEW:REJECTED': [168, 238, 104],
      'PRE_AWARD:REVIEW:WITHDRAWN': [168, 294, 104],
      'other-phase POST_AWARD:AGREEMENT:OFFERED': [316, 182, 65]
    })
    expect(preAward.edges.map(({ d }) => d)).toEqual([
      'M124 54.5C146 54.5 146 58 168 58',
      'M272 139 C308.125 139 308.125 58 272 58',
      'M124 61.5 C169.3125 61.5 169.3125 216 124 216',
      'M124 223C146 223 146 146 168 146',
      'M124 230C146 230 146 202 168 202',
      'M124 237C146 237 146 258 168 258',
      'M272 146 C312 146 312 258 272 258',
      'M124 244C146 244 146 314 168 314',
      'M272 153 C318.125 153 318.125 314 272 314',
      'M272 202C294 202 294 202 316 202'
    ])

    expect([postAward.width, postAward.height]).toEqual([588, 154])
    expect(layoutOf(postAward)).toEqual({
      'POST_AWARD:AGREEMENT:OFFERED': [135, 66, 104],
      'POST_AWARD:AGREEMENT:ACCEPTED': [283, 38, 104],
      'POST_AWARD:AGREEMENT:DECLINED': [283, 94, 104],
      'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE': [431, 38, 137],
      'other-phase PRE_AWARD:REVIEW:APPROVED': [20, 66, 71]
    })
    expect(postAward.edges.map(({ d }) => d)).toEqual([
      'M91 86C113 86 113 86 135 86',
      'M239 82.5C261 82.5 261 58 283 58',
      'M239 89.5C261 89.5 261 114 283 114',
      'M387 58C409 58 409 58 431 58'
    ])
  })

  test("places every node and edge of a workflow's phases", () => {
    const [preAward, postAward] = graphsOf(floodWorkflow).phases

    expect([preAward.width, preAward.height]).toEqual([670, 266])
    expect(layoutOf(preAward)).toEqual({
      'PRE_AWARD:REVIEW:AWAITING_REVIEW': [20, 122, 149],
      'PRE_AWARD:REVIEW:IN_REVIEW': [213, 122, 105],
      'PRE_AWARD:REVIEW:ON_HOLD': [362, 38, 104],
      'PRE_AWARD:REVIEW:RFI_SENT': [362, 150, 104],
      'PRE_AWARD:REVIEW:APPROVED': [362, 94, 104],
      'PRE_AWARD:REVIEW:REJECTED': [362, 206, 104],
      'PRE_AWARD:REVIEW:WITHDRAWN': [20, 178, 149],
      'other-phase POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE': [510, 94, 140]
    })
    expect(preAward.edges.map(({ d }) => d)).toEqual([
      'M169 142C191 142 191 142 213 142',
      'M318 139.2C340 139.2 340 114 362 114',
      'M318 156C340 156 340 226 362 226',
      'M318 128C340 128 340 61.5 362 61.5',
      'M318 144.8C340 144.8 340 173.5 362 173.5',
      'M362 54.5C340 54.5 340 133.6 318 133.6',
      'M362 166.5C340 166.5 340 150.4 318 150.4',
      'M466 114C488 114 488 114 510 114'
    ])

    expect([postAward.width, postAward.height]).toEqual([352, 154])
    expect(layoutOf(postAward)).toEqual({
      'POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE': [135, 38, 197],
      'POST_AWARD:AGREEMENT:ACCEPTED': [135, 94, 197],
      'other-phase PRE_AWARD:REVIEW:APPROVED': [20, 38, 71]
    })
    expect(postAward.edges.map(({ d }) => d)).toEqual([
      'M91 58C113 58 113 58 135 58'
    ])
  })

  test('puts entry statuses in column 0 and each next one a column further right', () => {
    const graph = single(move('P:S:A', 'P:S:B'), move('P:S:B', 'P:S:C'))

    expect(columnsOf(graph)).toEqual({
      'P:S:A': 20,
      'P:S:B': 168,
      'P:S:C': 316,
      'P:S:D': 20
    })
  })

  test('places a status reached only from a later one by searching again from it', () => {
    const graph = single(move('P:S:A', 'P:S:B'), move('P:S:B', 'P:S:A'))

    expect(columnsOf(graph)).toMatchObject({ 'P:S:A': 20, 'P:S:B': 168 })
  })

  test('leaves a status where it is for a move to itself', () => {
    const graph = single(move('P:S:A', 'P:S:A'), move('P:S:A', 'P:S:B'))

    expect(columnsOf(graph)).toMatchObject({ 'P:S:A': 20, 'P:S:B': 168 })
  })

  test('draws a move from another phase from column 0, shifting the phase right', () => {
    const map = {
      phases: [phase('A', { X: ['ONE'] }), phase('B', { Y: ['TWO', 'THREE'] })],
      moves: [move('A:X:ONE', 'B:Y:THREE')]
    }
    const graph = graphsOf(map).phases[1]
    const other = nodeOf(graph, 'A:X:ONE')

    expect(other).toMatchObject({
      kind: 'other-phase',
      x: 20,
      name: 'ONE',
      label: 'ONE (A:X:ONE)',
      href: '?status=A:X:ONE'
    })
    expect(nodeOf(graph, 'B:Y:THREE').x).toBe(103)
    expect(nodeOf(graph, 'B:Y:TWO').x).toBe(103)
    expect(other.y).toBe(nodeOf(graph, 'B:Y:THREE').y)
  })

  test('draws a move out to another phase into one last column, in the band it leaves', () => {
    const map = {
      phases: [
        phase('A', { X: ['ONE'], Z: ['TWO'] }),
        phase('B', { Y: ['THREE'] })
      ],
      moves: [move('A:X:ONE', 'A:Z:TWO'), move('A:Z:TWO', 'B:Y:THREE')]
    }
    const graph = graphsOf(map).phases[0]
    const other = nodeOf(graph, 'B:Y:THREE')

    expect(other).toMatchObject({ kind: 'other-phase', x: 168 })
    expect(other.y).toBe(nodeOf(graph, 'A:Z:TWO').y)
  })

  test('routes a move across three columns straight through two placeholders', () => {
    const map = {
      phases: [phase('A', { X: ['ONE'] }), phase('B', { Y: ['P', 'Q', 'R'] })],
      moves: [
        move('B:Y:P', 'B:Y:Q'),
        move('B:Y:Q', 'B:Y:R'),
        move('A:X:ONE', 'B:Y:R'),
        move('B:Y:R', 'B:Y:P')
      ]
    }
    const graph = graphsOf(map).phases[1]

    expect(graph.edges.map(({ d }) => d)).toEqual([
      'M207 82.5C229 82.5 229 58 251 58',
      'M355 58C377 58 377 107 399 107',
      'M59 142C81 142 81 142 103 142 L207 142 C229 142 229 170 251 170 L355 170 C377 170 377 121 399 121',
      'M399 114C377 114 377 114 355 114 L251 114 C229 114 229 89.5 207 89.5'
    ])
    expect(graph.nodes).toHaveLength(4)
  })

  test('stacks each stage in a band under the last, each from the first column', () => {
    const map = {
      phases: [phase('P', { ONE: ['A'], TWO: ['B'] })],
      moves: [move('P:ONE:A', 'P:TWO:B')]
    }
    const { bands } = graphsOf(map).phases[0]

    expect(bands).toEqual([
      {
        x: 12,
        y: 12,
        width: 120,
        height: 74,
        code: 'ONE',
        name: null,
        labelWidth: 35
      },
      {
        x: 12,
        y: 100,
        width: 120,
        height: 74,
        code: 'TWO',
        name: null,
        labelWidth: 35
      }
    ])
  })

  test('still draws an empty stage, the width of column 0', () => {
    const map = {
      phases: [phase('P', { ONE: ['A', 'B'], EMPTY: [] })],
      moves: [move('P:ONE:A', 'P:ONE:B')]
    }
    const { bands } = graphsOf(map).phases[0]

    expect(bands[1]).toMatchObject({ x: 12, width: 120, code: 'EMPTY' })
  })

  test('spreads two edges leaving one side, no more than 7px apart', () => {
    const graph = single(move('P:S:A', 'P:S:B'), move('P:S:A', 'P:S:C'))
    const starts = graph.edges.map(({ d }) => Number(d.split(/[MC ]/)[2]))

    expect(starts[0]).not.toBe(starts[1])
    expect(Math.abs(starts[0] - starts[1])).toBeLessThanOrEqual(7)
  })

  test('loops a move within one column out of the right side', () => {
    const self = single(move('P:S:A', 'P:S:A'), move('P:S:A', 'P:S:B'))
    const across = single(
      move('P:S:A', 'P:S:B'),
      move('P:S:A', 'P:S:C'),
      move('P:S:B', 'P:S:C')
    )

    expect(self.edges[0].d).toBe('M124 51 C151.75 51 151.75 65 124 65')
    expect(across.edges[2].d).toBe('M272 58 C305 58 305 114 272 114')
  })

  test('sizes a node by the longer of its name and code, never below 104, and 12px wider with a dot', () => {
    const plain = phase('P', { S: ['SHORT', 'A_RATHER_LONG_STATUS_CODE'] })
    const toned = phase('P', { S: ['A_RATHER_LONG_STATUS_CODE'] }, 'info')
    const widthOf = (p: StatePhase) =>
      graphsOf({ phases: [p], moves: [] }).phases[0].nodes.map(
        ({ width }) => width
      )

    expect(widthOf(plain)).toEqual([211, 211])
    expect(widthOf(toned)).toEqual([223])
    expect(widthOf(phase('P', { S: ['A'] }))).toEqual([104])
  })

  test('gives each node its height, and where its dot and text sit, so the template draws what the layout sized', () => {
    const nodeOf = (p: StatePhase) =>
      graphsOf({ phases: [p], moves: [] }).phases[0].nodes[0]
    const plain = nodeOf(phase('P', { S: ['A'] }))
    const toned = nodeOf(phase('P', { S: ['A'] }, 'info'))

    expect(plain).toMatchObject({ height: 40, dot: null })
    expect(plain.textX - plain.x).toBe(12)
    expect(toned).toMatchObject({
      height: 40,
      dot: { x: toned.x + 14, y: toned.y + 20 },
      textX: toned.x + 26
    })
  })

  test('includes padding in the natural size', () => {
    const graph = single()

    expect([graph.width, graph.height]).toEqual([144, 266])
  })

  test('selects a full position', () => {
    expect(
      graphsOf(woodlandGrant, 'POST_AWARD:AGREEMENT:ACCEPTED').selected
    ).toMatchObject({
      position: 'POST_AWARD:AGREEMENT:ACCEPTED',
      phase: { code: 'POST_AWARD' },
      stage: { code: 'AGREEMENT' },
      status: { code: 'ACCEPTED' }
    })
  })

  test('selects the first position in map order with a bare status code', () => {
    const map = {
      phases: [phase('A', { X: ['ONE', 'TWO'] }), phase('B', { Y: ['TWO'] })],
      moves: []
    }

    expect(graphsOf(map, 'TWO').selected?.position).toBe('A:X:TWO')
  })

  test("selects a stage's first status for a stage alone", () => {
    const map = {
      phases: [phase('A', { X: ['ONE'], Y: ['TWO', 'THREE'] })],
      moves: []
    }

    expect(graphsOf(map, 'A:Y').selected?.position).toBe('A:Y:TWO')
  })

  test.each([
    ['an unknown position', 'PRE_AWARD:REVIEW:NOPE'],
    ['an unknown status code', 'NOPE'],
    ['an empty value', ''],
    ['no value', undefined],
    ['a malformed value', 'a:b']
  ])('selects the first position in map order for %s', (_name, asked) => {
    expect(graphsOf(woodlandGrant, asked).selected?.position).toBe(
      'PRE_AWARD:APPLICATION:RECEIVED'
    )
  })

  test('falls back past a first phase with no statuses', () => {
    const map = {
      phases: [phase('A', { X: [] }), phase('B', { Y: ['ONE'] })],
      moves: []
    }
    const graphs = graphsOf(map)

    expect(graphs.selected?.position).toBe('B:Y:ONE')
    expect(graphs.phases[0]).toMatchObject({ nodes: [], edges: [], bands: [] })
  })

  test('selects nothing on a map with no statuses', () => {
    expect(graphsOf({ phases: [], moves: [] })).toEqual({
      selected: null,
      phases: [],
      duplicated: []
    })
  })

  test('links every node to its full position', () => {
    const hrefOf = vi.fn((position: string) => `#${position}`)
    const { phases } = toStateGraphs(woodlandGrant, undefined, hrefOf)

    expect(phases[1].nodes.map(({ href }) => href)).toEqual([
      '#POST_AWARD:AGREEMENT:OFFERED',
      '#POST_AWARD:AGREEMENT:ACCEPTED',
      '#POST_AWARD:AGREEMENT:DECLINED',
      '#POST_AWARD:AGREEMENT:CLAIMS_COMPLETE',
      '#PRE_AWARD:REVIEW:APPROVED'
    ])
  })

  test('marks the selected node over a flag, and a flagged one otherwise', () => {
    const states = (asked: string) =>
      graphsOf(floodWorkflow, asked).phases[0].nodes.map(({ state }) => state)

    expect(states('PRE_AWARD:REVIEW:WITHDRAWN')[6]).toBe('selected')
    expect(states('PRE_AWARD:REVIEW:IN_REVIEW').slice(0, 2)).toEqual([
      'plain',
      'selected'
    ])
    expect(states('PRE_AWARD:REVIEW:IN_REVIEW')[6]).toBe('flagged')
  })

  test('never flags the other-phase copy of a flagged status', () => {
    const preAward = (asked?: string) =>
      graphsOf(floodWorkflow, asked).phases[0]
    const copy = 'POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE'

    expect(nodeOf(preAward(), copy).state).toBe('plain')
    expect(nodeOf(preAward(copy), copy).state).toBe('selected')
  })

  test('keeps the moves of each phase to those that touch it', () => {
    const [preAward, postAward] = graphsOf(woodlandGrant).phases

    expect(preAward.edges.map(({ title }) => title)).not.toContain(
      'POST_AWARD:AGREEMENT:OFFERED → POST_AWARD:AGREEMENT:ACCEPTED'
    )
    expect(postAward.edges).toHaveLength(4)
    expect(postAward.edges[0]).toMatchObject({ kind: 'strong' })
  })

  test.each([
    ['from', move('P:S:NOPE', 'P:S:A')],
    ['to', move('P:S:A', 'Q:S:A')]
  ])('throws for a move %s a position not on the map', (_end, wrong) => {
    expect(() => single(wrong)).toThrow(UnknownPositionError)
  })

  test('draws a duplicated position once, where it first appears, and names it', () => {
    const map = {
      phases: [phase('P', { S: ['A', 'B', 'A'], T: ['A'] })],
      moves: [move('P:S:A', 'P:S:B')]
    }
    const graphs = graphsOf(map)

    expect(graphs.duplicated).toEqual(['P:S:A'])
    expect(graphs.phases[0].nodes.map(({ position }) => position)).toEqual([
      'P:S:A',
      'P:S:B',
      'P:T:A'
    ])
  })

  test('names no duplicates when there are none', () => {
    expect(graphsOf(woodlandGrant).duplicated).toEqual([])
  })
})

describe('toStateGraphs: names and labels', () => {
  const named: StateMap = {
    phases: [
      {
        code: 'P',
        name: 'Pre-award',
        stages: [
          {
            code: 'S',
            name: 'Review application',
            statuses: [
              {
                code: 'A',
                name: 'A rather long status name',
                tone: null,
                flagged: true,
                findings: ['unreachable', 'dead end'],
                chip: 'start'
              },
              { code: 'B', name: 'Bee', tone: null, flagged: false }
            ]
          }
        ]
      }
    ],
    moves: []
  }

  test('sizes a column by its longest name, with room for a finding', () => {
    const widths = graphsOf(named).phases[0].nodes.map(({ width }) => width)

    expect(widths).toEqual([
      Math.ceil(25 * 7.4 + 26 + 18),
      Math.ceil(25 * 7.4 + 26 + 18)
    ])
  })

  test('names a node and its finding for a screen reader, and keeps its chip', () => {
    const [node] = graphsOf(named).phases[0].nodes

    expect(node).toMatchObject({
      name: 'A rather long status name',
      label:
        'A rather long status name (P:S:A), finding: unreachable, dead end',
      chip: 'start',
      flagged: true
    })
  })

  test('names the CW theme in the label, before any finding, when the status has one', () => {
    const themed: StateMap = {
      ...named,
      phases: named.phases.map((phase) => ({
        ...phase,
        stages: phase.stages.map((stage) => ({
          ...stage,
          statuses: stage.statuses.map((status) => ({
            ...status,
            theme: 'WARN'
          }))
        }))
      }))
    }

    expect(graphsOf(themed).phases[0].nodes.map(({ label }) => label)).toEqual([
      'A rather long status name (P:S:A), CW theme WARN, finding: unreachable, dead end',
      'Bee (P:S:B), CW theme WARN'
    ])
  })

  test("widens a band to its label, the stage's name then its code", () => {
    const map: StateMap = {
      phases: [
        {
          code: 'P',
          name: null,
          stages: [
            {
              code: 'CLAIM_COMPLETE',
              name: 'Claim complete and paid in full',
              statuses: [{ code: 'A', name: 'A', tone: null, flagged: false }]
            }
          ]
        }
      ],
      moves: []
    }
    const [band] = graphsOf(map).phases[0].bands

    expect(band.labelWidth).toBe(Math.ceil(31 * 6.8 + 6 + 14 * 6.1 + 16))
    expect(band.width).toBe(band.labelWidth + 8)
  })
})
