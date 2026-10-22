import type { BadgeRole } from '../use-cases/get-event.use-case.ts'

export interface StateStatus {
  code: string
  /** No dot when null. */
  tone: BadgeRole | null
  flagged: boolean
}

export interface StateStage {
  code: string
  name: string | null
  statuses: StateStatus[]
}

export interface StatePhase {
  code: string
  name: string | null
  stages: StateStage[]
}

export type MoveKind = 'plain' | 'strong' | 'dashed'

/** One edge, between full `PHASE:STAGE:STATUS` positions. */
export interface StateMove {
  from: string
  to: string
  kind: MoveKind
  title: string
}

export interface StateMap {
  phases: StatePhase[]
  moves: StateMove[]
}

export interface SelectedStatus {
  position: string
  phase: StatePhase
  stage: StateStage
  status: StateStatus
}

export interface GraphBand {
  x: number
  y: number
  width: number
  height: number
  code: string
  name: string | null
}

export type GraphNode = {
  x: number
  y: number
  width: number
  position: string
  href: string
  state: 'selected' | 'flagged' | 'plain'
} & (
  | { kind: 'status'; code: string; tone: BadgeRole | null }
  | { kind: 'other-phase'; stageKey: string; code: string }
)

export interface GraphEdge {
  d: string
  kind: MoveKind
  title: string
}

export interface PhaseGraph {
  /** Prefixes the graph's marker ids, so it is unique on the page. */
  id: string
  code: string
  name: string | null
  /** Natural size in px, which is also the viewBox. */
  width: number
  height: number
  bands: GraphBand[]
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface StateGraphs {
  selected: SelectedStatus | null
  phases: PhaseGraph[]
  /** Positions the definition holds more than once; each is drawn where it first appears. */
  duplicated: string[]
}

/** A move end the tab should have resolved, or left out, before drawing. */
export class UnknownPositionError extends Error {
  constructor(position: string) {
    super(`Move end is not a position on the map: ${position}`)
    this.name = 'UnknownPositionError'
  }
}

const nodeHeight = 38
const columnGap = 44
const rowPitch = 48
const padding = 12
const bandHead = 26
const bandInset = 8
const bandGap = 14
const minNodeWidth = 104
const portSpread = 7
const passes = 4

interface Place extends SelectedStatus {
  phaseIndex: number
  stageIndex: number
}

type Key = string

type Vertex =
  | { kind: 'status'; place: Place }
  | { kind: 'other-phase'; position: string }
  | { kind: 'via' }

interface Chain {
  move: StateMove
  keys: Key[]
}

interface End {
  chain: number
  at: 0 | 1
  key: Key
  side: 'left' | 'right'
  toward: number
}

const placesOf = (map: StateMap): Place[] =>
  map.phases.flatMap((phase, phaseIndex) =>
    phase.stages.flatMap((stage, stageIndex) =>
      stage.statuses.map((status) => ({
        position: `${phase.code}:${stage.code}:${status.code}`,
        phase,
        stage,
        status,
        phaseIndex,
        stageIndex
      }))
    )
  )

const firstPlaces = (places: Place[]) =>
  places.reduce(
    (first, place) =>
      first.has(place.position) ? first : first.set(place.position, place),
    new Map<string, Place>()
  )

const duplicatesOf = (places: Place[], first: Map<string, Place>) => [
  ...new Set(
    places
      .filter((place) => first.get(place.position) !== place)
      .map(({ position }) => position)
  )
]

const placeOf = (first: Map<string, Place>, position: string): Place => {
  const place = first.get(position)

  if (!place) {
    throw new UnknownPositionError(position)
  }

  return place
}

const bareMatch = (positions: string[], asked: string | undefined) =>
  asked && !asked.includes(':')
    ? positions.find((position) => position.endsWith(`:${asked}`))
    : undefined

const pickPosition = (positions: string[], asked: string | undefined) =>
  positions.find((position) => position === asked) ??
  bareMatch(positions, asked) ??
  positions[0]

const toSelected = ({
  position,
  phase,
  stage,
  status
}: Place): SelectedStatus => ({ position, phase, stage, status })

const unique = (values: string[]) => [...new Set(values)]

const sum = (values: number[]) => values.reduce((total, x) => total + x, 0)

const mean = (values: number[]) => sum(values) / values.length

const stageKeyOf = (position: string) =>
  position.split(':').slice(0, 2).join(':')

const statusCodeOf = (position: string) => position.split(':')[2]

const statusWidth = ({ code, tone }: StateStatus) =>
  Math.max(minNodeWidth, Math.ceil(code.length * 7.2 + (tone ? 38 : 26)))

const otherPhaseWidth = (position: string) =>
  Math.ceil(
    Math.max(
      stageKeyOf(position).length * 5.4,
      statusCodeOf(position).length * 7.2
    ) + 20
  )

const vertexWidth = (vertex: Vertex) => {
  if (vertex.kind === 'status') {
    return statusWidth(vertex.place.status)
  }

  return vertex.kind === 'other-phase' ? otherPhaseWidth(vertex.position) : 0
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const k = (x2 - x1) / 2

  return `C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`
}

const nodeState = (selected: boolean, flagged: boolean): GraphNode['state'] => {
  if (selected) {
    return 'selected'
  }

  return flagged ? 'flagged' : 'plain'
}

const runningTotals = (sizes: number[], start: number) =>
  sizes.reduce<number[]>(
    (starts, _size, index) => [
      ...starts,
      index === 0 ? start : starts[index - 1] + sizes[index - 1]
    ],
    []
  )

/**
 * One phase's layered layout: columns by distance from the phase's entry
 * statuses, one band per stage, long moves bent round placeholders, and each
 * cell ordered by its neighbours' barycentre so edges cross as little as they can.
 */
class PhaseLayout {
  readonly #own: Map<string, Place>
  readonly #stages: StateStage[]
  readonly #moves: StateMove[]
  readonly #vertices: Record<Key, Vertex> = {}
  readonly #col: Record<Key, number> = {}
  readonly #band: Record<Key, number> = {}
  readonly #links: [Key, Key][] = []
  #cells: Key[][][] = []
  #offsets: number[][] = []
  #chains: Chain[] = []
  #columnX: number[] = []
  #columnWidth: number[] = []
  #bandY: number[] = []
  #rows: number[] = []

  constructor(own: Place[], stages: StateStage[], moves: StateMove[]) {
    this.#own = new Map(own.map((place) => [place.position, place]))
    this.#stages = stages
    this.#moves = moves
    this.#columns()
    this.#otherPhaseNodes()
    this.#fillCells()
    this.#chainMoves()
    this.#order()
    this.#align()
    this.#measure()
  }

  get #incoming() {
    return unique(
      this.#moves
        .filter(({ from }) => !this.#own.has(from))
        .map(({ from }) => from)
    )
  }

  get #outgoing() {
    return unique(
      this.#moves.filter(({ to }) => !this.#own.has(to)).map(({ to }) => to)
    )
  }

  #colOf(key: Key) {
    return this.#col[key]
  }

  #bandOf(key: Key) {
    return this.#band[key]
  }

  #hasCol(key: Key) {
    return Object.hasOwn(this.#col, key)
  }

  #place(key: Key, vertex: Vertex, col: number, band: number) {
    this.#vertices[key] = vertex
    this.#col[key] = col
    this.#band[key] = band
  }

  #columns() {
    const inner = this.#moves.filter(
      ({ from, to }) => from !== to && this.#own.has(from) && this.#own.has(to)
    )
    const shift = this.#incoming.length ? 1 : 0
    const positions = [...this.#own.keys()]

    this.#search(
      positions.filter((position) => !inner.some(({ to }) => to === position)),
      inner,
      shift
    )
    positions.forEach((position) => this.#search([position], inner, shift))
    this.#own.forEach((place, position) => {
      this.#band[position] = place.stageIndex
    })
  }

  #search(roots: string[], inner: StateMove[], shift: number) {
    const queue = roots.filter((position) => !this.#hasCol(position))

    queue.forEach((position) => {
      this.#col[position] = shift
    })
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const from = next
      inner
        .filter(({ from: start }) => start === from)
        .forEach(({ to }) => this.#reach(from, to, queue))
    }
  }

  #reach(from: string, to: string, queue: string[]) {
    if (!this.#hasCol(to)) {
      this.#col[to] = this.#colOf(from) + 1
      queue.push(to)
    }
  }

  #otherPhaseNodes() {
    this.#own.forEach((place, position) => {
      this.#vertices[position] = { kind: 'status', place }
    })
    const last =
      Math.max(...[...this.#own.keys()].map((k) => this.#colOf(k))) + 1

    this.#incoming.forEach((position) => {
      const [move] = this.#moves.filter(({ from }) => from === position)

      this.#place(
        `in\n${position}`,
        { kind: 'other-phase', position },
        0,
        this.#bandOf(move.to)
      )
    })
    this.#outgoing.forEach((position) => {
      const [move] = this.#moves.filter(({ to }) => to === position)

      this.#place(
        `out\n${position}`,
        { kind: 'other-phase', position },
        last,
        this.#bandOf(move.from)
      )
    })
  }

  get #columnCount() {
    return Math.max(...Object.values(this.#col)) + 1
  }

  #fillCells() {
    const count = this.#columnCount

    this.#cells = this.#stages.map(() =>
      Array.from({ length: count }, (): Key[] => [])
    )
    this.#offsets = this.#stages.map(() => Array<number>(count).fill(0))
    const keys = [
      ...this.#incoming.map((position) => `in\n${position}`),
      ...this.#own.keys(),
      ...this.#outgoing.map((position) => `out\n${position}`)
    ]

    keys.forEach((key) => this.#cellOf(key).push(key))
  }

  #cellOf(key: Key) {
    return this.#cells[this.#bandOf(key)][this.#colOf(key)]
  }

  #keyOf(position: string, side: 'in' | 'out') {
    return this.#own.has(position) ? position : `${side}\n${position}`
  }

  #chainMoves() {
    this.#chains = this.#moves.map((move, index) => {
      const from = this.#keyOf(move.from, 'in')
      const to = this.#keyOf(move.to, 'out')
      const keys = [from, ...this.#placeholders(index, from, to), to]

      keys.slice(1).forEach((key, i) => this.#link(keys[i], key))

      return { move, keys }
    })
  }

  #placeholders(index: number, from: Key, to: Key) {
    const start = this.#colOf(from)
    const end = this.#colOf(to)
    const step = end > start ? 1 : -1
    const span = Math.max(0, Math.abs(end - start) - 1)

    return Array.from({ length: span }, (_, i) => {
      const col = start + step * (i + 1)
      const key = `via\n${index}:${col}`

      this.#place(key, { kind: 'via' }, col, this.#bandOf(from))
      this.#cellOf(key).push(key)

      return key
    })
  }

  #link(a: Key, b: Key) {
    if (this.#colOf(a) !== this.#colOf(b)) {
      this.#links.push([a, b])
    }
  }

  #near(key: Key, col: number) {
    return this.#links.flatMap(([a, b]) => [
      ...this.#neighbour(a, b, key, col),
      ...this.#neighbour(b, a, key, col)
    ])
  }

  #neighbour(end: Key, other: Key, key: Key, col: number) {
    return end === key && this.#colOf(other) === col ? [other] : []
  }

  #slot(key: Key) {
    const band = this.#bandOf(key)
    const col = this.#colOf(key)

    return this.#offsets[band][col] + this.#cells[band][col].indexOf(key)
  }

  #rank(key: Key) {
    return this.#bandOf(key) * 1000 + this.#slot(key)
  }

  #order() {
    for (let pass = 0; pass < passes; pass++) {
      this.#sweep(1)
      this.#sweep(-1)
    }
  }

  #sweep(direction: 1 | -1) {
    const count = this.#columnCount
    const columns = [...Array(count).keys()].filter(
      (col) => col - direction >= 0 && col - direction < count
    )

    ;(direction === 1 ? columns : columns.reverse()).forEach((col) =>
      this.#cells.forEach((row) => {
        row[col] = this.#byBarycentre(row[col], col - direction)
      })
    )
  }

  #byBarycentre(keys: Key[], toward: number) {
    return keys
      .map((key): [Key, number] => [key, this.#barycentre(key, toward)])
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => key)
  }

  #barycentre(key: Key, toward: number) {
    const near = this.#near(key, toward)

    return near.length ? mean(near.map((k) => this.#rank(k))) : this.#rank(key)
  }

  #align() {
    for (let pass = 0; pass < passes; pass++) {
      this.#cells.forEach((row, band) =>
        row.forEach((keys, col) => {
          this.#offsets[band][col] = this.#offsetOf(keys, band, col)
        })
      )
    }
    this.#offsets.forEach((offsets, band) => this.#normalise(offsets, band))
  }

  #offsetOf(keys: Key[], band: number, col: number) {
    const wanted = keys.flatMap((key, index) => {
      const near = [...this.#near(key, col - 1), ...this.#near(key, col + 1)]
        .filter((k) => this.#bandOf(k) === band)
        .map((k) => this.#slot(k))

      return near.length ? [mean(near) - index] : []
    })

    return wanted.length ? Math.max(0, Math.round(2 * mean(wanted)) / 2) : 0
  }

  #normalise(offsets: number[], band: number) {
    const used = offsets.filter((_, col) => this.#cells[band][col].length)
    const least = used.length ? Math.min(...used) : 0

    offsets.forEach((_, col) => {
      offsets[col] -= least
    })
  }

  #measure() {
    this.#columnWidth = Array.from({ length: this.#columnCount }, (_, col) =>
      Math.max(
        ...this.#cells
          .flatMap((row) => row[col])
          .map((key) => vertexWidth(this.#vertexOf(key)))
      )
    )
    this.#columnX = runningTotals(
      this.#columnWidth.map((width) => width + columnGap),
      padding + bandInset
    )
    this.#rows = this.#cells.map((row, band) =>
      Math.ceil(
        Math.max(
          1,
          ...row.map((keys, col) =>
            keys.length ? this.#offsets[band][col] + keys.length : 0
          )
        )
      )
    )
    this.#bandY = runningTotals(
      this.#rows.map((rows) => this.#bandHeight(rows) + bandGap),
      padding
    )
  }

  #vertexOf(key: Key) {
    return this.#vertices[key]
  }

  #bandHeight(rows: number) {
    return bandHead + (rows - 1) * rowPitch + nodeHeight + bandInset
  }

  #x(key: Key) {
    return this.#columnX[this.#colOf(key)]
  }

  #width(key: Key) {
    return this.#columnWidth[this.#colOf(key)]
  }

  #y(key: Key) {
    return (
      this.#bandY[this.#bandOf(key)] + bandHead + this.#slot(key) * rowPitch
    )
  }

  get width() {
    return (
      this.#columnX[this.#columnX.length - 1] +
      this.#columnWidth[this.#columnWidth.length - 1] +
      bandInset +
      padding
    )
  }

  get height() {
    return (
      this.#bandY[this.#bandY.length - 1] +
      this.#bandHeight(this.#rows[this.#rows.length - 1]) +
      padding
    )
  }

  #endsOf({ keys }: Chain, chain: number): End[] {
    const from = keys[0]
    const to = keys[keys.length - 1]
    const forward = this.#colOf(to) > this.#colOf(from)
    const backward = this.#colOf(to) < this.#colOf(from)

    return [
      {
        chain,
        at: 0,
        key: from,
        side: backward ? 'left' : 'right',
        toward: this.#y(keys[1])
      },
      {
        chain,
        at: 1,
        key: to,
        side: forward ? 'left' : 'right',
        toward: this.#y(keys[keys.length - 2])
      }
    ]
  }

  #ports() {
    const groups = Map.groupBy(
      this.#chains.flatMap((chain, index) => this.#endsOf(chain, index)),
      ({ key, side }) => `${key}\n${side}`
    )
    const ports: Record<string, number> = {}

    groups.forEach((ends) =>
      ends
        .sort((a, b) => a.toward - b.toward || a.at - b.at)
        .forEach((end, index) => {
          ports[`${end.chain}:${end.at}`] = this.#port(end, index, ends.length)
        })
    )

    return ports
  }

  #port({ key }: End, index: number, count: number) {
    const spread = Math.min(
      portSpread,
      (nodeHeight - 12) / Math.max(1, count - 1)
    )

    return this.#y(key) + nodeHeight / 2 + (index - (count - 1) / 2) * spread
  }

  edges(): GraphEdge[] {
    const ports = this.#ports()

    return this.#chains.map((chain, index) => ({
      d: this.#path(chain.keys, ports[`${index}:0`], ports[`${index}:1`]),
      kind: chain.move.kind,
      title: chain.move.title
    }))
  }

  #path(keys: Key[], y1: number, y2: number) {
    const from = keys[0]
    const to = keys[keys.length - 1]

    return this.#colOf(from) === this.#colOf(to)
      ? this.#loop(from, y1, y2)
      : this.#run(keys, y1, y2)
  }

  #loop(key: Key, y1: number, y2: number) {
    const x = this.#x(key) + this.#width(key)
    const k = 26 + Math.abs(y2 - y1) / 8

    return `M${x} ${y1} C${x + k} ${y1} ${x + k} ${y2} ${x} ${y2}`
  }

  #run(keys: Key[], y1: number, y2: number) {
    const forward = this.#colOf(keys[keys.length - 1]) > this.#colOf(keys[0])
    const points = [
      [this.#side(keys[0], forward), y1],
      ...keys.slice(1, -1).flatMap((key) => this.#through(key, forward)),
      [this.#side(keys[keys.length - 1], !forward), y2]
    ]

    return (
      `M${points[0][0]} ${points[0][1]}` +
      points
        .slice(1)
        .map(([x, y], i) =>
          i % 2 === 0 ? curve(points[i][0], points[i][1], x, y) : `L${x} ${y}`
        )
        .join(' ')
    )
  }

  #side(key: Key, right: boolean) {
    return right ? this.#x(key) + this.#width(key) : this.#x(key)
  }

  #through(key: Key, forward: boolean) {
    const y = this.#y(key) + nodeHeight / 2
    const left = [this.#x(key), y]
    const right = [this.#x(key) + this.#width(key), y]

    return forward ? [left, right] : [right, left]
  }

  bands(): GraphBand[] {
    return this.#stages.map((stage, band) => {
      const cols = [...this.#own.keys()]
        .filter((key) => this.#bandOf(key) === band)
        .map((key) => this.#colOf(key))
      const first = cols.length ? Math.min(...cols) : 0
      const last = cols.length ? Math.max(...cols) : 0
      const x = this.#columnX[first] - bandInset

      return {
        x,
        y: this.#bandY[band],
        width: this.#columnX[last] + this.#columnWidth[last] + bandInset - x,
        height: this.#bandHeight(this.#rows[band]),
        code: stage.code,
        name: stage.name
      }
    })
  }

  nodes(selected: string | undefined, hrefOf: (position: string) => string) {
    const stateOf = (position: string, flagged: boolean) =>
      nodeState(position === selected, flagged)
    const other = (key: Key, position: string): GraphNode => ({
      ...this.#box(key),
      kind: 'other-phase',
      position,
      href: hrefOf(position),
      state: stateOf(position, false),
      stageKey: stageKeyOf(position),
      code: statusCodeOf(position)
    })

    return [
      ...[...this.#own.values()].map(
        ({ position, status }): GraphNode => ({
          ...this.#box(position),
          kind: 'status',
          position,
          href: hrefOf(position),
          state: stateOf(position, status.flagged),
          code: status.code,
          tone: status.tone
        })
      ),
      ...this.#incoming.map((position) => other(`in\n${position}`, position)),
      ...this.#outgoing.map((position) => other(`out\n${position}`, position))
    ]
  }

  #box(key: Key) {
    return { x: this.#x(key), y: this.#y(key), width: this.#width(key) }
  }
}

const emptyGraph = { width: 0, height: 0, bands: [], nodes: [], edges: [] }

const toPhaseGraph = (
  phase: StatePhase,
  index: number,
  own: Place[],
  moves: StateMove[],
  selection: { position: string | undefined; hrefOf: (p: string) => string }
): PhaseGraph => {
  const head = { id: `phase-${index}`, code: phase.code, name: phase.name }

  if (own.length === 0) {
    return { ...head, ...emptyGraph }
  }

  const layout = new PhaseLayout(own, phase.stages, moves)

  return {
    ...head,
    width: layout.width,
    height: layout.height,
    bands: layout.bands(),
    nodes: layout.nodes(selection.position, selection.hrefOf),
    edges: layout.edges()
  }
}

/**
 * Lays out one state graph per phase, ready for the `state-graph` component,
 * and resolves which position the panel describes. `asked` is the `status`
 * query value: a full position, a bare status code, or anything else, which
 * selects the first position on the map.
 */
export const toStateGraphs = (
  map: StateMap,
  asked: string | undefined,
  hrefOf: (position: string) => string
): StateGraphs => {
  const places = placesOf(map)
  const first = firstPlaces(places)
  const ends = map.moves.map((move) => ({
    move,
    from: placeOf(first, move.from).phaseIndex,
    to: placeOf(first, move.to).phaseIndex
  }))
  const position = pickPosition([...first.keys()], asked)
  const ownOf = (index: number) =>
    [...first.values()].filter(({ phaseIndex }) => phaseIndex === index)
  const movesOf = (index: number) =>
    ends
      .filter(({ from, to }) => from === index || to === index)
      .map(({ move }) => move)

  return {
    selected:
      position === undefined ? null : toSelected(placeOf(first, position)),
    phases: map.phases.map((phase, index) =>
      toPhaseGraph(phase, index, ownOf(index), movesOf(index), {
        position,
        hrefOf
      })
    ),
    duplicated: duplicatesOf(places, first)
  }
}
