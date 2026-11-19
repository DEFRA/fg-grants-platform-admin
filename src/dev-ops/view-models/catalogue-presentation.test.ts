import {
  casesBucket,
  cwEvents,
  gasEvents,
  gasInbox,
  gasOutbox,
  grantsBucket,
  applicationsBucket,
  workflowsBucket
} from '../use-cases/test-fixtures.ts'
import type { BucketEntry } from '../repositories/buckets.repository.ts'
import {
  cataloguePresentation,
  toFactLabel,
  toListColumns,
  toTimeLabel,
  toTone,
  toVersionColumn,
  toChipOrder
} from './catalogue-presentation.ts'

const columns = (bucket: BucketEntry) =>
  toListColumns(bucket).map(({ key, label, width, mono, align }) => ({
    key,
    label,
    width,
    mono,
    align
  }))

describe('the Events pages', () => {
  test.each([gasEvents, cwEvents])(
    '$id: Event, Event ID, Queue, Status, Created, each an equal share no row moves',
    (bucket) => {
      expect(columns(bucket)).toEqual([
        {
          key: 'title',
          label: 'Event',
          width: 'minmax(160px, 1fr)',
          mono: false,
          align: 'start'
        },
        {
          key: 'subtitle',
          label: 'Event ID',
          width: 'minmax(160px, 1fr)',
          mono: true,
          align: 'start'
        },
        {
          key: 'box',
          label: 'Queue',
          width: 'minmax(160px, 1fr)',
          mono: false,
          align: 'start'
        },
        {
          key: 'status',
          label: 'Status',
          width: 'minmax(160px, 1fr)',
          mono: false,
          align: 'start'
        },
        {
          key: 'time',
          label: 'Created',
          width: 'minmax(160px, 1fr)',
          mono: false,
          align: 'right'
        }
      ])
    }
  )

  test('other lists keep their own widths', () => {
    expect(columns(applicationsBucket).map(({ width }) => width)).not.toContain(
      'minmax(160px, 1fr)'
    )
  })

  test('the chips go Queue, Event, Status', () => {
    expect(
      toChipOrder(
        gasEvents,
        gasEvents.facts.filter(({ values }) => values)
      )
    ).toEqual(
      ['box', 'eventType', 'status'].map((name) =>
        gasEvents.facts.find((fact) => fact.name === name)
      )
    )
  })

  test.each([
    ['PUBLISHED', 'neutral', 'info'],
    ['PROCESSING', 'info', 'info'],
    ['FAILED', 'warning', 'danger'],
    ['RESUBMITTED', 'warning', 'warning'],
    ['COMPLETED', 'success', 'success'],
    ['DEAD_LETTER', 'error', 'danger'],
    ['PURGED', 'neutral', 'neutral']
  ] as const)('%s, declared %s, is drawn %s', (value, declared, tone) => {
    expect(toTone(gasEvents, 'status', value, declared)).toBe(tone)
    expect(toTone(cwEvents, 'status', value, declared)).toBe(tone)
  })

  test('a queue’s own list, while GAS lists the queues apart, is drawn as the catalogue declares it', () => {
    expect(
      columns(gasOutbox).map(({ label, width }) => [label, width])
    ).toEqual([
      ['Event', 'auto'],
      ['Status', 'auto'],
      ['Created', 'max-content']
    ])
    expect(toTone(gasInbox, 'status', 'PUBLISHED', 'neutral')).toBe('neutral')
    expect(toTimeLabel(gasInbox)).toBe('Received')
  })
})

describe('Applications and Cases', () => {
  test('Applications: Reference, Grant, Received; no position', () => {
    expect(columns(applicationsBucket).map(({ label }) => label)).toEqual([
      'Reference',
      'Grant',
      'Received'
    ])
    expect(columns(applicationsBucket)[0].mono).toBe(true)
  })

  test('Cases: Reference, Grant, and CW’s own Created', () => {
    expect(columns(casesBucket).map(({ label }) => label)).toEqual([
      'Reference',
      'Grant',
      'Created'
    ])
  })

  test.each([applicationsBucket, casesBucket])(
    '$id: widths that no row can change, so loading more keeps the columns still',
    (bucket) => {
      expect(columns(bucket).map(({ width }) => width)).toEqual([
        'minmax(180px, 1fr)',
        'minmax(220px, 1fr)',
        'var(--size-column-date)'
      ])
    }
  )
})

describe('Grants and Workflows', () => {
  test.each([
    [grantsBucket, 'Grant', 'worstFetchStatus'],
    [workflowsBucket, 'Workflow', 'fetchStatus']
  ])('one version column, Stored, Status, Received', (bucket, title, fact) => {
    expect(columns(bucket).map(({ label }) => label)).toEqual([
      title,
      'Stored',
      'Status',
      'Received'
    ])
    expect(toVersionColumn(bucket)).toBe('version')
    expect(
      toFactLabel(bucket, bucket.facts.find(({ name }) => name === fact)!)
    ).toBe('Stored')
  })

  test.each([grantsBucket, workflowsBucket])(
    '$id: widths that no row can change, so loading more keeps the columns still',
    (bucket) => {
      expect(columns(bucket).map(({ width }) => width)).toEqual([
        'minmax(220px, 1fr)',
        '160px',
        '128px',
        'var(--size-column-date)'
      ])
    }
  )

  test('the catalogue’s tones, error drawn as danger', () => {
    expect(
      toTone(grantsBucket, 'worstFetchStatus', 'permanent_error', 'error')
    ).toBe('danger')
    expect(toTone(grantsBucket, 'status', 'active', 'success')).toBe('success')
  })

  test('only the grants list puts the stored state’s hint in a tooltip, as the prototype does', () => {
    expect(
      toListColumns(grantsBucket).find(({ key }) => key === 'definition')
        ?.tooltip
    ).toBe(true)
    expect(
      toListColumns(workflowsBucket).find(({ key }) => key === 'definition')
        ?.tooltip
    ).toBe(false)
  })
})

describe('a list GPA has no entry for', () => {
  const unknown: BucketEntry = { ...applicationsBucket, id: 'gas.new' }

  test('is drawn as the catalogue declares it', () => {
    expect(columns(unknown).map(({ label }) => label)).toEqual([
      'Reference',
      'Grant',
      'Status',
      'Created'
    ])
    expect(toTone(unknown, 'status', 'X', undefined)).toBe('neutral')
  })
})

test('every entry is for a list GAS or CW declares', () => {
  expect(Object.keys(cataloguePresentation).sort()).toEqual([
    'cw.cases',
    'cw.events',
    'cw.workflows',
    'gas.applications',
    'gas.events',
    'gas.grants'
  ])
})

describe('toChipOrder', () => {
  test.each([
    [grantsBucket, ['grantCode', 'worstFetchStatus', 'status']],
    [workflowsBucket, ['grantCode', 'fetchStatus', 'status']]
  ])(
    'puts Stored before Status on %s, as the prototype does',
    (bucket, names) => {
      expect(toChipOrder(bucket, bucket.facts).map(({ name }) => name)).toEqual(
        names
      )
    }
  )

  test('keeps the catalogue’s order where GPA says none', () => {
    expect(toChipOrder(casesBucket, casesBucket.facts)).toEqual(
      casesBucket.facts
    )
  })
})
