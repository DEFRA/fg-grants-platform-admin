import { render } from '../../../test-utils.ts'
import { toStateGraphs } from '../../../view-models/state-graph.view-model.ts'
import type { StateMap } from '../../../view-models/state-graph.view-model.ts'

const map: StateMap = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: 'Pre-award',
      stages: [
        {
          code: 'REVIEW',
          name: 'Review application',
          statuses: [
            { code: 'IN_REVIEW', tone: 'info', flagged: false },
            { code: 'ON_HOLD', tone: 'neutral', flagged: true },
            { code: 'APPROVED', tone: null, flagged: false }
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
          statuses: [{ code: 'OFFERED', tone: null, flagged: false }]
        }
      ]
    }
  ],
  moves: [
    {
      from: 'PRE_AWARD:REVIEW:IN_REVIEW',
      to: 'PRE_AWARD:REVIEW:ON_HOLD',
      kind: 'plain',
      title: 'Put on hold (PUT_ON_HOLD)'
    },
    {
      from: 'PRE_AWARD:REVIEW:IN_REVIEW',
      to: 'PRE_AWARD:REVIEW:APPROVED',
      kind: 'strong',
      title: 'IN_REVIEW → APPROVED: GENERATE_AGREEMENT'
    },
    {
      from: 'PRE_AWARD:REVIEW:APPROVED',
      to: 'POST_AWARD:AGREEMENT:OFFERED',
      kind: 'dashed',
      title: 'GAS sends'
    }
  ]
}

const legend = [
  { kind: 'strong', label: 'Runs processes' },
  { kind: 'dashed', label: 'GAS sends' },
  { kind: 'other-phase', label: 'Other phase' }
]

interface Options {
  map: StateMap
  asked?: string
  legend: object[]
}

const graph = (
  overrides: Partial<Options> = {},
  block = '<p data-testid="body">Panel body</p>'
) => {
  const options: Options = { map, legend, ...overrides }

  return render(
    'state-graph',
    {
      graphs: toStateGraphs(
        options.map,
        options.asked,
        (position) => `/dev-ops/x?tab=phases&status=${position}`
      ),
      legend: options.legend,
      testId: 'phases'
    },
    block
  )
}

const node = ($: ReturnType<typeof graph>, position: string) =>
  $(`[data-testid="phases-node"][data-position="${position}"]`)

describe('state-graph component', () => {
  test('draws one card per phase, titled with its code and any name', () => {
    const $ = graph()
    const cards = $('[data-testid="phases-phase"]')

    expect(cards.map((_, card) => $(card).attr('data-phase')).get()).toEqual([
      'PRE_AWARD',
      'POST_AWARD'
    ])
    expect(cards.first().find('h2 .font-mono').text()).toBe('PRE_AWARD')
    expect(cards.first().find('h2').text()).toBe('PRE_AWARD Pre-award')
    expect(cards.last().find('h2').text()).toBe('POST_AWARD')
  })

  test('sizes each graph at its natural size, with no inline style anywhere', () => {
    const $ = graph()
    const svg = $('[data-testid="phases-graph"]').first()
    const width = svg.attr('width')
    const height = svg.attr('height')

    expect(Number(width)).toBeGreaterThan(0)
    expect(svg.attr('viewBox')).toBe(`0 0 ${width} ${height}`)
    expect(svg.attr('role')).toBe('group')
    expect(svg.attr('aria-label')).toBe('PRE_AWARD statuses')
    expect($('[style]')).toHaveLength(0)
  })

  test('draws a strong edge in the info colour and a dashed edge dashed', () => {
    const $ = graph()
    const strong = $('[data-testid="phases-edge"][data-kind="strong"]')
    const dashed = $('[data-testid="phases-edge"][data-kind="dashed"]').first()

    expect(strong.attr('class')).toBe('stroke-info')
    expect(strong.attr('marker-end')).toBe('url(#phases-phase-0-strong)')
    expect(strong.find('title').text()).toBe(
      'IN_REVIEW → APPROVED: GENERATE_AGREEMENT'
    )
    expect(dashed.attr('stroke-dasharray')).toBe('5 4')
    expect(dashed.attr('marker-end')).toBe('url(#phases-phase-0-arrow)')
  })

  test('draws an other-phase node dashed, with its stage above its status', () => {
    const $ = graph()
    const other = node($, 'POST_AWARD:AGREEMENT:OFFERED').first()

    expect(other.find('rect').attr('stroke-dasharray')).toBe('4 3')
    expect(
      other
        .find('text')
        .map((_, text) => $(text).text())
        .get()
    ).toEqual(['POST_AWARD:AGREEMENT', 'OFFERED'])
    expect(other.attr('href')).toBe(
      '/dev-ops/x?tab=phases&status=POST_AWARD:AGREEMENT:OFFERED'
    )
  })

  test('marks the selected node current and outlines a flagged one', () => {
    const $ = graph({ asked: 'IN_REVIEW' })
    const selected = node($, 'PRE_AWARD:REVIEW:IN_REVIEW')
    const flagged = node($, 'PRE_AWARD:REVIEW:ON_HOLD')

    expect(selected.attr('aria-current')).toBe('true')
    expect(selected.attr('aria-label')).toBe('PRE_AWARD:REVIEW:IN_REVIEW')
    expect(selected.find('rect').attr('class')).toContain(
      'stroke-base-content '
    )
    expect(selected.find('rect').attr('stroke-width')).toBe('2')
    expect(flagged.attr('aria-current')).toBeUndefined()
    expect(flagged.find('rect').attr('class')).toContain('stroke-warning')
    expect(
      node($, 'PRE_AWARD:REVIEW:APPROVED').find('rect').attr('class')
    ).toContain('stroke-base-content/25')
  })

  test('gives each node link a visible focus ring', () => {
    const $ = graph()
    const link = node($, 'PRE_AWARD:REVIEW:APPROVED')

    expect(link.attr('class')).toBe('group')
    expect(link.find('rect').attr('class')).toContain(
      'group-focus-visible:[stroke-width:3]'
    )
  })

  test('draws a dot in the tone colour, and none without a tone', () => {
    const $ = graph()

    expect(
      node($, 'PRE_AWARD:REVIEW:IN_REVIEW').find('circle').attr('class')
    ).toBe('fill-info')
    expect(
      node($, 'PRE_AWARD:REVIEW:ON_HOLD').find('circle').attr('class')
    ).toBe('fill-base-content/80')
    expect(node($, 'PRE_AWARD:REVIEW:APPROVED').find('circle')).toHaveLength(0)
    expect(node($, 'PRE_AWARD:REVIEW:APPROVED').find('text').attr('x')).toBe(
      String(
        Number(node($, 'PRE_AWARD:REVIEW:APPROVED').find('rect').attr('x')) + 12
      )
    )
  })

  test('labels each stage band with its code and any name', () => {
    const $ = graph()
    const band = $('[data-testid="phases-band"]').first()

    expect(band.find('rect').attr('class')).toBe('fill-base-200')
    expect(band.find('tspan').first().text()).toBe('REVIEW')
    expect(band.find('tspan').last().text()).toBe('Review application')
  })

  test('keeps marker ids unique across phases', () => {
    const $ = graph()
    const ids = $('marker')
      .map((_, marker) => $(marker).attr('id'))
      .get()

    expect(ids).toEqual([
      'phases-phase-0-arrow',
      'phases-phase-0-strong',
      'phases-phase-1-arrow',
      'phases-phase-1-strong'
    ])
  })

  test('shows only the legend items passed, each with its sample', () => {
    const $ = graph({
      legend: [
        { kind: 'plain', label: 'Action' },
        { kind: 'flagged', label: 'Finding' }
      ]
    })
    const items = $('[data-testid="phases-legend-item"]')

    expect(items.map((_, item) => $(item).text().trim()).get()).toEqual([
      'Action',
      'Finding'
    ])
    expect(items.first().find('line').attr('class')).toBe('stroke-current')
    expect(items.first().find('line').attr('stroke-dasharray')).toBeUndefined()
    expect(items.last().find('span').attr('class')).toContain(
      'border-2 border-warning'
    )
  })

  test('draws the legend samples for strong, dashed and other-phase', () => {
    const $ = graph()
    const items = $('[data-testid="phases-legend-item"]')

    expect(items.eq(0).find('line').attr('class')).toBe('stroke-info')
    expect(items.eq(0).find('line').attr('stroke-width')).toBe('2')
    expect(items.eq(1).find('line').attr('stroke-dasharray')).toBe('5 4')
    expect(items.eq(2).find('span').attr('class')).toContain('border-dashed')
  })

  test('scrolls each graph in a named region a keyboard can reach', () => {
    const region = graph()('[data-testid="phases-graph"]').first().parent()

    expect(region.attr('class')).toContain('overflow-x-auto')
    expect(region.attr('tabindex')).toBe('0')
    expect(region.attr('role')).toBe('region')
    expect(region.attr('aria-label')).toBe('PRE_AWARD statuses')
  })

  test('puts the sticky panel after the graphs, titled with the selected status, around the body', () => {
    const $ = graph({ asked: 'PRE_AWARD:REVIEW:ON_HOLD' })
    const panel = $('[data-testid="phases-panel"]')

    expect(panel.attr('class')).toContain('lg:sticky lg:top-4')
    expect(panel.attr('aria-label')).toBe('Status')
    expect(panel.prev().find('[data-testid="phases-phase"]')).toHaveLength(2)
    expect(panel.find('[data-testid="phases-panel-title"]').text()).toBe(
      'ON_HOLD'
    )
    expect(panel.find('[data-testid="body"]').text()).toBe('Panel body')
  })

  test('says a phase has no statuses, and titles no panel on an empty map', () => {
    const $ = graph({
      map: {
        phases: [{ code: 'EMPTY', name: null, stages: [] }],
        moves: []
      }
    })

    expect($('[data-testid="phases-phase-empty"]').text()).toBe('No statuses.')
    expect($('svg[data-testid="phases-graph"]')).toHaveLength(0)
    expect($('[data-testid="phases-panel-title"]')).toHaveLength(0)
  })

  test('warns about each duplicated position above the graphs', () => {
    const $ = graph({
      map: {
        phases: [
          {
            code: 'P',
            name: null,
            stages: [
              {
                code: 'S',
                name: null,
                statuses: [
                  { code: 'A', tone: null, flagged: false },
                  { code: 'A', tone: null, flagged: false }
                ]
              }
            ]
          }
        ],
        moves: []
      }
    })
    const alert = $('[data-testid="phases-duplicates"]')

    expect(alert.attr('role')).toBe('alert')
    expect(alert.text().replace(/\s+/g, ' ').trim()).toBe(
      'P:S:A appears more than once in this definition. The graph shows it once, where it first appears.'
    )
  })

  test('shows no warning when no position is duplicated', () => {
    expect(graph()('[data-testid="phases-duplicates"]')).toHaveLength(0)
  })

  test('draws the panel helpers inside the panel body', () => {
    const $ = graph(
      {},
      `{% from "state-graph/macro.njk" import stageFacts, statusPanelSection %}
      {{ stageFacts({ phase: { code: 'PRE_AWARD', name: 'Pre-award' }, stage: { code: 'REVIEW', name: null }, testId: 'facts' }) }}
      {% call statusPanelSection({ title: 'Moves to', testId: 'moves' }) %}<p>→ APPROVED</p>{% endcall %}`
    )
    const panel = $('[data-testid="phases-panel"]')
    const facts = panel.find('[data-testid="facts"]')
    const section = panel.find('[data-testid="moves"]')

    expect(
      facts
        .find('dt')
        .map((_, dt) => $(dt).text())
        .get()
    ).toEqual(['Phase', 'Stage'])
    expect(facts.find('dd').first().text()).toBe('PRE_AWARD Pre-award')
    expect(facts.find('dd').last().text()).toBe('REVIEW')
    expect(section.find('h3').text()).toBe('Moves to')
    expect(section.find('h3').attr('class')).toContain('uppercase')
    expect(section.find('p').text()).toBe('→ APPROVED')
  })
})
