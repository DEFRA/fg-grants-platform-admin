import Boom from '@hapi/boom'
import type { Server } from '@hapi/hapi'
import { load } from 'cheerio'

import { getAllowListUseCase } from '../use-cases/get-allow-list.use-case.ts'
import { getGrantSettings } from '../repositories/grant-settings.repository.ts'
import {
  addDbReferenceDataItem,
  changeDbReferenceDataItem,
  getDbReferenceData,
  listGrantReferenceData,
  removeDbReferenceDataItem
} from '../repositories/reference-data.repository.ts'
import { createServer } from '../../server/index.ts'
import { grantOps } from '../index.ts'

vi.mock(import('../repositories/reference-data.repository.ts'))
vi.mock(import('../repositories/grant-settings.repository.ts'))
vi.mock(import('../use-cases/get-allow-list.use-case.ts'))

const base = '/grant-ops/grants/pigs-might-fly/admin/reference-data/fly-db'
const auth = {
  strategy: 'session',
  credentials: {
    user: { name: 'Ada Lovelace', id: 'operator-1' },
    scope: ['FCP.GrantApplicationsAdmin']
  }
}

const held = {
  name: 'fly-db',
  items: [{ code: 'WINGS', description: 'Wings' }],
  updatedAt: null
}

/** A wreck-thrown non-2xx, matching what @hapi/wreck attaches to the error. */
const gasError = (statusCode: number, message: string) =>
  Object.assign(Boom.boomify(new Error('Response Error'), { statusCode }), {
    data: { payload: { message } }
  })

const get = async (url: string) => {
  const response = await server.inject({ method: 'GET', url, auth })
  return { ...response, $: load(response.result as unknown as string) }
}

const post = async (url: string, payload: object = {}) => {
  const response = await server.inject({ method: 'POST', url, payload, auth })
  return { ...response, $: load(response.result as unknown as string) }
}

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([grantOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(getDbReferenceData).mockResolvedValue(held)
  vi.mocked(addDbReferenceDataItem).mockResolvedValue(held)
  vi.mocked(changeDbReferenceDataItem).mockResolvedValue(held)
  vi.mocked(removeDbReferenceDataItem).mockResolvedValue(held)
})

afterAll(async () => {
  await server.stop()
})

describe('grant admin page', () => {
  test('lists the reference data and links only the set held in GAS', async () => {
    vi.mocked(getAllowListUseCase).mockResolvedValue({
      sbi: { key: 'sbi', label: 'SBIs', value: '', hint: '' },
      crn: { key: 'crn', label: 'CRNs', value: '', hint: '' },
      errorSummary: []
    })
    vi.mocked(getGrantSettings).mockResolvedValue({
      grantCode: 'pigs-might-fly',
      open: true
    })
    vi.mocked(listGrantReferenceData).mockResolvedValue({
      grantCode: 'pigs-might-fly',
      referenceData: [
        { name: 'fly-inline', source: 'inline', editable: false },
        { name: 'fly-db', source: 'db', editable: true, itemCount: 1 },
        { name: 'fly-endpoint', source: 'endpoint', editable: false }
      ]
    })

    const { $, statusCode } = await get(
      '/grant-ops/grants/pigs-might-fly/admin'
    )
    const rows = $('[data-testid="reference-data-set"]')

    expect(statusCode).toBe(200)
    expect(
      rows.map((_, row) => $(row).find('td').first().text().trim()).get()
    ).toEqual(['fly-inline', 'fly-db', 'fly-endpoint'])
    expect(rows.find('a').attr('href')).toBe(base)
    expect(rows.eq(1).text()).toContain('Held in GAS')
  })
})

describe('reference data items', () => {
  test('shows the items GAS holds with change and remove links', async () => {
    const { $, statusCode } = await get(base)

    expect(statusCode).toBe(200)
    expect($('[data-testid="reference-data-item"]').text()).toContain('Wings')
    expect($(`a[href="${base}/items/WINGS/change"]`)).toHaveLength(1)
    expect($(`a[href="${base}/items/WINGS/remove"]`)).toHaveLength(1)
    expect($('[data-testid="reference-data-add"]').attr('href')).toBe(
      `${base}/new`
    )
  })

  test('refuses a set GAS does not hold, as GAS answered', async () => {
    vi.mocked(getDbReferenceData).mockRejectedValue(
      gasError(409, 'Reference data "fly-inline" comes from inline')
    )

    expect((await get(base)).statusCode).toBe(409)
  })

  test('forbids an operator GAS refuses administration to', async () => {
    vi.mocked(getDbReferenceData).mockRejectedValue(gasError(403, 'Forbidden'))

    expect((await get(base)).statusCode).toBe(403)
  })
})

describe('adding an item', () => {
  test('adds the trimmed item and goes back to the list', async () => {
    const response = await post(`${base}/new`, {
      code: ' GLIDERS ',
      description: ' Gliders '
    })

    expect(addDbReferenceDataItem).toHaveBeenCalledWith(
      'pigs-might-fly',
      'fly-db',
      { code: 'GLIDERS', description: 'Gliders' }
    )
    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe(base)
  })

  test('asks for blank fields without calling GAS', async () => {
    const { $, statusCode } = await post(`${base}/new`, {
      code: '',
      description: ''
    })

    expect(statusCode).toBe(400)
    expect(addDbReferenceDataItem).not.toHaveBeenCalled()
    expect($('[data-testid="reference-data-errors"]').text()).toContain(
      'Enter a code'
    )
    expect($('#code-error').text()).toContain('Enter a code')
    expect($('#description-error').text()).toContain('Enter a description')
  })

  test('shows a duplicate code GAS refused against the code', async () => {
    vi.mocked(addDbReferenceDataItem).mockRejectedValue(
      gasError(
        409,
        'Reference data "fly-db" already has an item with code "WINGS"'
      )
    )

    const { $, statusCode } = await post(`${base}/new`, {
      code: 'WINGS',
      description: 'More wings'
    })

    expect(statusCode).toBe(409)
    expect($('#code-error').text()).toContain('already has an item')
    expect($('#code').val()).toBe('WINGS')
  })
})

describe('changing an item', () => {
  test('shows the item with its code fixed', async () => {
    const { $, statusCode } = await get(`${base}/items/WINGS/change`)

    expect(statusCode).toBe(200)
    expect($('#code')).toHaveLength(0)
    expect($('#description').val()).toBe('Wings')
  })

  test('is not found for an item the set does not hold', async () => {
    expect((await get(`${base}/items/NOPE/change`)).statusCode).toBe(404)
  })

  test('saves the new description', async () => {
    const response = await post(`${base}/items/WINGS/change`, {
      description: 'Feathered wings'
    })

    expect(changeDbReferenceDataItem).toHaveBeenCalledWith(
      'pigs-might-fly',
      'fly-db',
      'WINGS',
      'Feathered wings'
    )
    expect(response.headers.location).toBe(base)
  })
})

describe('removing an item', () => {
  test('asks for confirmation first', async () => {
    const { $ } = await get(`${base}/items/WINGS/remove`)

    expect($('h1').text()).toContain('remove WINGS')
    expect(removeDbReferenceDataItem).not.toHaveBeenCalled()
  })

  test('removes the item once confirmed', async () => {
    const response = await post(`${base}/items/WINGS/remove`)

    expect(removeDbReferenceDataItem).toHaveBeenCalledWith(
      'pigs-might-fly',
      'fly-db',
      'WINGS'
    )
    expect(response.headers.location).toBe(base)
  })
})
