import { render } from '../../../test-utils.ts'
import { toGrantQuestions } from '../../../view-models/grant-questions.ts'
import type { SchemaTreeRow } from '../../../view-models/grant-questions.ts'

const rowsOf = (questions: object): SchemaTreeRow[] => {
  const tab = toGrantQuestions({ phases: [{ code: 'PRE_AWARD', questions }] })
  const [card] = tab.kind === 'cards' ? tab.cards : []

  return card?.kind === 'schema' ? card.rows : []
}

const tree = (questions: object) =>
  render('schema-tree', { rows: rowsOf(questions), testId: 'tree' })

const nested = {
  required: ['applicant'],
  properties: {
    applicant: {
      type: 'object',
      title: 'Applicant details',
      properties: {
        business: {
          type: 'object',
          properties: { name: { type: 'string', maxLength: 100 } }
        }
      }
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { species: { type: 'string', enum: ['oak', 'birch'] } }
      }
    },
    planned: { type: 'boolean', default: false }
  }
}

describe('schema-tree component', () => {
  test('nests an open details for each object and each array of objects', () => {
    const $ = tree(nested)

    expect($('details')).toHaveLength(3)
    expect($('details:not([open])')).toHaveLength(0)
    expect($('details details')).toHaveLength(1)
    expect($('details details > div [data-testid="tree-name"]').text()).toBe(
      'name'
    )
  })

  test('puts the chevron in the summary, turned only by its own details', () => {
    const $ = tree(nested)
    const summary = $('details > summary').first()

    expect(summary.find('[data-testid="tree-name"]').text()).toBe('applicant')
    expect(summary.find('svg').attr('class')).toContain(
      '[details[open]>summary_&]:rotate-0'
    )
    expect($('[data-testid="tree-fold"]')).toHaveLength(3)
  })

  test('indents each level with a class from the literal map', () => {
    const $ = tree(nested)
    const indentOf = (index: number) =>
      $('[data-testid="tree-row"]')
        .eq(index)
        .children()
        .first()
        .attr('class')
        ?.split(' ')
        .find((name) => name.startsWith('pl-'))

    expect([0, 1, 2, 3, 4].map(indentOf)).toEqual([
      'pl-0',
      'pl-5',
      'pl-10',
      'pl-0',
      'pl-5'
    ])
  })

  test('sets no inline style, which the CSP would block', () => {
    expect(tree(nested)('[style]')).toHaveLength(0)
  })

  test('shows the column heads from sm up only', () => {
    const head = tree(nested)('[data-testid="tree-head"]')

    expect(head.attr('class')?.split(' ')).toEqual(
      expect.arrayContaining(['hidden', 'sm:grid'])
    )
    expect(
      head
        .children()
        .toArray()
        .map((cell) => head.find(cell).text())
    ).toEqual(['Property', 'Type', 'Required', 'Constraints'])
  })

  test('marks a required name for sight only, and says it in words', () => {
    const $ = tree(nested)
    const row = $('[data-testid="tree-row"]').first()

    expect(row.find('.text-error').attr('aria-hidden')).toBe('true')
    expect(row.find('[data-testid="tree-required"]').text()).toBe('Required')
    expect($('[data-testid="tree-required"]').eq(1).text().trim()).toBe(
      'Optional'
    )
  })

  test('shows the type, the title, the constraints and the default', () => {
    const $ = tree(nested)
    const rows = $('[data-testid="tree-row"]')
    const flatten = (index: number, part: string) =>
      rows
        .eq(index)
        .find(`[data-testid="tree-${part}"]`)
        .text()
        .replace(/\s+/g, ' ')
        .trim()

    expect(flatten(0, 'name')).toBe('applicant')
    expect(rows.eq(0).text()).toContain('Applicant details')
    expect(flatten(2, 'constraints')).toBe('maxLength 100')
    expect(flatten(3, 'name')).toBe('items[]')
    expect(flatten(3, 'type')).toBe('array of object')
    expect(flatten(4, 'constraints')).toBe('one of oak, birch')
    expect(flatten(5, 'constraints')).toBe('default false')
    expect(flatten(0, 'constraints')).toBe('—')
  })

  test('escapes markup in a name, a title or a pattern', () => {
    const $ = tree({
      properties: {
        '<b>x</b>': { title: '<i>t</i>', pattern: '<script>' }
      }
    })

    expect($('b, i, script')).toHaveLength(0)
    expect($('[data-testid="tree-name"]').text()).toBe('<b>x</b>')
    expect($('[data-testid="tree-constraints"]').text()).toContain(
      'pattern <script>'
    )
  })
})
