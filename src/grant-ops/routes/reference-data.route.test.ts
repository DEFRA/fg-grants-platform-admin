import Boom from '@hapi/boom'
import type { Server } from '@hapi/hapi'
import { load } from 'cheerio'

import { getAllowListUseCase } from '../use-cases/get-allow-list.use-case.ts'
import { getGrantSettings } from '../repositories/grant-settings.repository.ts'
import {
  addDbReferenceDataItem,
  changeDbReferenceDataItem,
  listGrantReferenceData,
  removeDbReferenceDataItem,
  viewReferenceData
} from '../repositories/reference-data.repository.ts'
import { createServer } from '../../server/index.ts'
import { grantOps } from '../index.ts'

vi.mock(import('../repositories/reference-data.repository.ts'))
vi.mock(import('../repositories/grant-settings.repository.ts'))
vi.mock(import('../use-cases/get-allow-list.use-case.ts'))

const admin = '/grant-ops/grants/pigs-might-fly/admin'
const base = `${admin}/reference-data/landing-site`
const auth = {
  strategy: 'session',
  credentials: {
    user: { name: 'Ada Lovelace', id: 'operator-1' },
    scope: ['FCP.GrantApplicationsAdmin']
  }
}

const landingSite = {
  name: 'landing-site',
  source: 'db' as const,
  editable: true,
  items: [{ code: 'BARN', description: 'Barn roof' }]
}

const held = { name: 'landing-site', items: landingSite.items, updatedAt: null }

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
      {
        name: 'fly',
        source: 'endpoint',
        editable: false,
        service: 'GRANT_FUNDING_CALCULATOR'
      },
      {
        name: 'pig-colour',
        source: 'inline',
        editable: false,
        items: [{ code: 'PINK', description: 'Pink' }]
      },
      landingSite
    ]
  })
  vi.mocked(viewReferenceData).mockResolvedValue(landingSite)
  vi.mocked(addDbReferenceDataItem).mockResolvedValue(held)
  vi.mocked(changeDbReferenceDataItem).mockResolvedValue(held)
  vi.mocked(removeDbReferenceDataItem).mockResolvedValue(held)
})

afterAll(async () => {
  await server.stop()
})

const section = ($: ReturnType<typeof load>, name: string) =>
  $(`[data-testid="reference-data-set"][data-name="${name}"]`)

describe('Reference data tab', () => {
  test('shows every list with where it comes from', async () => {
    const { $, statusCode } = await get(admin)

    expect(statusCode).toBe(200)
    expect(
      $('[data-testid="reference-data-set"] h3')
        .map((_, heading) => $(heading).text().trim())
        .get()
    ).toEqual(['fly', 'pig-colour', 'landing-site'])
    expect(section($, 'fly').text()).toContain(
      'From the grant funding calculator service. Changes in that service, not here.'
    )
    expect(section($, 'pig-colour').text()).toContain(
      'Changes when a new grant version is published.'
    )
  })

  test('lets the operator change only the list held in GAS', async () => {
    const { $ } = await get(admin)

    expect(section($, 'landing-site').find('a[href$="/change"]')).toHaveLength(
      1
    )
    expect(
      section($, 'landing-site')
        .find('[data-testid="reference-data-add"]')
        .attr('href')
    ).toBe(`${base}/new`)
    expect(section($, 'pig-colour').text()).toContain('Pink')
    expect(section($, 'pig-colour').find('a')).toHaveLength(0)
  })

  test('links an endpoint list without fetching its items', async () => {
    const { $ } = await get(admin)

    expect(
      section($, 'fly').find('[data-testid="reference-data-view"]').attr('href')
    ).toBe(`${admin}/reference-data/fly`)
    expect(viewReferenceData).not.toHaveBeenCalled()
  })

  test('has no tab when the grant declares no lists', async () => {
    vi.mocked(listGrantReferenceData).mockResolvedValue({
      grantCode: 'pigs-might-fly',
      referenceData: []
    })

    const { $ } = await get(admin)

    expect($('a[href="#reference-data"]')).toHaveLength(0)
    expect($('#reference-data')).toHaveLength(0)
  })
})

describe('viewing an endpoint list', () => {
  const flyUrl = `${admin}/reference-data/fly`

  test('fetches and shows its current items, read only', async () => {
    vi.mocked(viewReferenceData).mockResolvedValue({
      name: 'fly',
      source: 'endpoint',
      editable: false,
      service: 'GRANT_FUNDING_CALCULATOR',
      items: [{ code: 'WINGS', description: 'Wings' }]
    })

    const { $, statusCode } = await get(flyUrl)

    expect(statusCode).toBe(200)
    expect($('[data-testid="reference-data-item"]').text()).toContain('Wings')
    expect($('main a[href$="/change"]')).toHaveLength(0)
  })

  test('says so when the service cannot answer', async () => {
    vi.mocked(viewReferenceData).mockRejectedValue(gasError(502, 'down'))

    const { $, statusCode } = await get(flyUrl)

    expect(statusCode).toBe(502)
    expect($('[data-testid="reference-data-unavailable"]').text()).toContain(
      "Couldn't load these items"
    )
  })

  test('forbids an operator GAS refuses administration to', async () => {
    vi.mocked(viewReferenceData).mockRejectedValue(gasError(403, 'Forbidden'))

    expect((await get(flyUrl)).statusCode).toBe(403)
  })
})

describe('adding an item', () => {
  test('adds the trimmed item and goes back to the Reference data tab', async () => {
    const response = await post(`${base}/new`, {
      code: ' WELL ',
      description: ' Well cover '
    })

    expect(addDbReferenceDataItem).toHaveBeenCalledWith(
      'pigs-might-fly',
      'landing-site',
      { code: 'WELL', description: 'Well cover' }
    )
    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe(admin)
  })

  test('asks for blank fields without calling GAS', async () => {
    const { $, statusCode } = await post(`${base}/new`, {
      code: '',
      description: ''
    })

    expect(statusCode).toBe(400)
    expect(addDbReferenceDataItem).not.toHaveBeenCalled()
    expect($('#code-error').text()).toContain('Enter a code')
    expect($('#description-error').text()).toContain('Enter a description')
  })

  test('shows a duplicate code GAS refused against the code', async () => {
    vi.mocked(addDbReferenceDataItem).mockRejectedValue(
      gasError(
        409,
        'Reference data "landing-site" already has an item with code "BARN"'
      )
    )

    const { $, statusCode } = await post(`${base}/new`, {
      code: 'BARN',
      description: 'Another barn'
    })

    expect(statusCode).toBe(409)
    expect($('#code-error').text()).toContain('already has an item')
    expect($('#code').val()).toBe('BARN')
  })
})

describe('changing an item', () => {
  test('shows the item with its code fixed', async () => {
    const { $, statusCode } = await get(`${base}/items/BARN/change`)

    expect(statusCode).toBe(200)
    expect($('#code')).toHaveLength(0)
    expect($('#description').val()).toBe('Barn roof')
  })

  test('is not found for an item the list does not hold', async () => {
    expect((await get(`${base}/items/NOPE/change`)).statusCode).toBe(404)
  })

  test('saves the new description', async () => {
    const response = await post(`${base}/items/BARN/change`, {
      description: 'Big barn roof'
    })

    expect(changeDbReferenceDataItem).toHaveBeenCalledWith(
      'pigs-might-fly',
      'landing-site',
      'BARN',
      'Big barn roof'
    )
    expect(response.headers.location).toBe(admin)
  })
})

describe('removing an item', () => {
  test('asks for confirmation first', async () => {
    const { $ } = await get(`${base}/items/BARN/remove`)

    expect($('h1').text()).toContain('remove BARN')
    expect(removeDbReferenceDataItem).not.toHaveBeenCalled()
  })

  test('removes the item once confirmed', async () => {
    const response = await post(`${base}/items/BARN/remove`)

    expect(removeDbReferenceDataItem).toHaveBeenCalledWith(
      'pigs-might-fly',
      'landing-site',
      'BARN'
    )
    expect(response.headers.location).toBe(admin)
  })
})
