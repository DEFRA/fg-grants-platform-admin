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
    statuses: statuses.map((status) => ({ code: status, tone, flagged: false }))
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
            { code: 'AWAITING_REVIEW', tone: 'neutral', flagged: false },
            { code: 'IN_REVIEW', tone: 'info', flagged: false },
            { code: 'ON_HOLD', tone: 'warning', flagged: false },
            { code: 'RFI_SENT', tone: 'warning', flagged: false },
            { code: 'APPROVED', tone: 'success', flagged: false },
            { code: 'REJECTED', tone: 'error', flagged: false },
            { code: 'WITHDRAWN', tone: 'neutral', flagged: true }
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
            { code: 'AWAITING_ACCEPTANCE', tone: 'info', flagged: true },
            { code: 'ACCEPTED', tone: 'success', flagged: true }
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

    expect([preAward.width, preAward.height]).toEqual([612, 326])
    expect(layoutOf(preAward)).toEqual({
      'PRE_AWARD:APPLICATION:RECEIVED': [20, 38, 104],
      'PRE_AWARD:APPLICATION:AMEND': [168, 38, 104],
      'PRE_AWARD:REVIEW:IN_REVIEW': [168, 196, 104],
      'PRE_AWARD:REVIEW:ON_HOLD': [316, 124, 104],
      'PRE_AWARD:REVIEW:APPROVED': [316, 172, 104],
      'PRE_AWARD:REVIEW:REJECTED': [316, 220, 104],
      'PRE_AWARD:REVIEW:WITHDRAWN': [316, 268, 104],
      'other-phase POST_AWARD:AGREEMENT:OFFERED': [464, 172, 128]
    })
    expect(preAward.edges.map(({ d }) => d)).toEqual([
      'M124 53.5C146 53.5 146 57 168 57',
      'M316 139.5C294 139.5 294 57 272 57',
      'M124 60.5C146 60.5 146 215 168 215',
      'M272 204.5C294 204.5 294 146.5 316 146.5',
      'M272 211.5C294 211.5 294 191 316 191',
      'M272 218.5C294 218.5 294 239 316 239',
      'M420 139.5 C458.4375 139.5 458.4375 239 420 239',
      'M272 225.5C294 225.5 294 287 316 287',
      'M420 146.5 C463.5625 146.5 463.5625 287 420 287',
      'M420 191C442 191 442 191 464 191'
    ])

    expect([postAward.width, postAward.height]).toEqual([621, 144])
    expect(layoutOf(postAward)).toEqual({
      'POST_AWARD:AGREEMENT:OFFERED': [171, 62, 104],
      'POST_AWARD:AGREEMENT:ACCEPTED': [319, 38, 104],
      'POST_AWARD:AGREEMENT:DECLINED': [319, 86, 104],
      'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE': [467, 38, 134],
      'other-phase PRE_AWARD:REVIEW:APPROVED': [20, 62, 107]
    })
    expect(postAward.edges.map(({ d }) => d)).toEqual([
      'M127 81C149 81 149 81 171 81',
      'M275 77.5C297 77.5 297 57 319 57',
      'M275 84.5C297 84.5 297 105 319 105',
      'M423 57C445 57 445 57 467 57'
    ])
  })

  test("places every node and edge of a workflow's phases", () => {
    const [preAward, postAward] = graphsOf(floodWorkflow).phases

    expect([preAward.width, preAward.height]).toEqual([683, 240])
    expect(layoutOf(preAward)).toEqual({
      'PRE_AWARD:REVIEW:AWAITING_REVIEW': [20, 110, 146],
      'PRE_AWARD:REVIEW:IN_REVIEW': [210, 110, 104],
      'PRE_AWARD:REVIEW:ON_HOLD': [358, 38, 104],
      'PRE_AWARD:REVIEW:RFI_SENT': [358, 134, 104],
      'PRE_AWARD:REVIEW:APPROVED': [358, 86, 104],
      'PRE_AWARD:REVIEW:REJECTED': [358, 182, 104],
      'PRE_AWARD:REVIEW:WITHDRAWN': [20, 158, 146],
      'other-phase POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE': [506, 86, 157]
    })
    expect(preAward.edges.map(({ d }) => d)).toEqual([
      'M166 129C188 129 188 129 210 129',
      'M314 126.4C336 126.4 336 105 358 105',
      'M314 142C336 142 336 201 358 201',
      'M314 116C336 116 336 60.5 358 60.5',
      'M314 131.6C336 131.6 336 156.5 358 156.5',
      'M358 53.5C336 53.5 336 121.2 314 121.2',
      'M358 149.5C336 149.5 336 136.8 314 136.8',
      'M462 105C484 105 484 105 506 105'
    ])

    expect([postAward.width, postAward.height]).toEqual([366, 144])
    expect(layoutOf(postAward)).toEqual({
      'POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE': [171, 38, 175],
      'POST_AWARD:AGREEMENT:ACCEPTED': [171, 86, 175],
      'other-phase PRE_AWARD:REVIEW:APPROVED': [20, 38, 107]
    })
    expect(postAward.edges.map(({ d }) => d)).toEqual([
      'M127 57C149 57 149 57 171 57'
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
      stageKey: 'A:X',
      code: 'ONE',
      href: '?status=A:X:ONE'
    })
    expect(nodeOf(graph, 'B:Y:THREE').x).toBe(106)
    expect(nodeOf(graph, 'B:Y:TWO').x).toBe(106)
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

    expect(other).toMatchObject({ kind: 'other-phase', x: 316 })
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
      'M210 77.5C232 77.5 232 57 254 57',
      'M358 57C380 57 380 98 402 98',
      'M62 129C84 129 84 129 106 129 L210 129 C232 129 232 153 254 153 L358 153 C380 153 380 112 402 112',
      'M402 105C380 105 380 105 358 105 L254 105 C232 105 232 84.5 210 84.5'
    ])
    expect(graph.nodes).toHaveLength(4)
  })

  test('gives each stage one band, in order, as wide as its own columns', () => {
    const map = {
      phases: [phase('P', { ONE: ['A'], TWO: ['B'] })],
      moves: [move('P:ONE:A', 'P:TWO:B')]
    }
    const { bands } = graphsOf(map).phases[0]

    expect(bands).toEqual([
      { x: 12, y: 12, width: 120, height: 72, code: 'ONE', name: null },
      { x: 160, y: 98, width: 120, height: 72, code: 'TWO', name: null }
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

    expect(self.edges[0].d).toBe('M124 50 C151.75 50 151.75 64 124 64')
    expect(across.edges[2].d).toBe('M272 57 C304 57 304 105 272 105')
  })

  test('sizes a node by its code, never below 104, and 12px wider with a dot', () => {
    const plain = phase('P', { S: ['SHORT', 'A_RATHER_LONG_STATUS_CODE'] })
    const toned = phase('P', { S: ['A_RATHER_LONG_STATUS_CODE'] }, 'info')
    const widthOf = (p: StatePhase) =>
      graphsOf({ phases: [p], moves: [] }).phases[0].nodes.map(
        ({ width }) => width
      )

    expect(widthOf(plain)).toEqual([206, 206])
    expect(widthOf(toned)).toEqual([218])
    expect(widthOf(phase('P', { S: ['A'] }))).toEqual([104])
  })

  test('includes padding in the natural size', () => {
    const graph = single()

    expect([graph.width, graph.height]).toEqual([144, 240])
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
