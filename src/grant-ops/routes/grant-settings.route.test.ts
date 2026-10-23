import Boom from '@hapi/boom'
import type { Server } from '@hapi/hapi'
import { load } from 'cheerio'

import { getFromGas, putToGas } from '../../common/gas.ts'
import { currentGasActor } from '../../common/gas-actor.ts'
import { createServer } from '../../server/index.ts'
import { grantOps } from '../index.ts'

vi.mock(import('../../common/gas.ts'), async (original) => ({
  ...(await original()),
  getFromGas: vi.fn(),
  putToGas: vi.fn()
}))

const url = '/grant-ops/grants/woodland/admin'
const settingsUrl = `${url}/settings`
const auth = {
  strategy: 'session',
  credentials: {
    user: { name: 'Ada Lovelace', id: 'operator-1' },
    scope: ['FCP.GrantApplicationsAdmin']
  }
}
const allowList = {
  sbi: {
    key: 'sbi',
    label: 'Single Business Identifiers (SBIs)',
    value: '900000002',
    hint: 'One per line. 1 listed.'
  },
  crn: {
    key: 'crn',
    label: 'Customer Reference Numbers (CRNs)',
    value: '',
    hint: 'One per line. 0 listed.'
  },
  errorSummary: []
}
let server: Server
let open: boolean
beforeAll(async () => {
  server = await createServer()
  await server.register(grantOps)
  await server.initialize()
})
beforeEach(() => {
  open = false
  vi.mocked(getFromGas).mockImplementation(async (path) =>
    path.endsWith('/settings') ? { grantCode: 'woodland', open } : allowList
  )
  vi.mocked(putToGas).mockImplementation(async (_path, options) => {
    open = (options?.payload as { open: boolean }).open
    return { grantCode: 'woodland', open }
  })
})
afterAll(async () => server.stop())

const get = (cookie?: string) =>
  server.inject({
    method: 'GET',
    url,
    auth,
    ...(cookie && { headers: { cookie } })
  })
const post = (payload: object) =>
  server.inject({ method: 'POST', url: settingsUrl, auth, payload })

describe('Grant setup', () => {
  test('shows the saved closed state using GOV.UK radios and Save changes', async () => {
    const response = await get()
    const $ = load(response.payload)
    expect(response.statusCode).toBe(200)
    expect($('#grant-setup legend').text()).toContain(
      'Is this grant open or closed?'
    )
    expect(
      $('#grant-setup input[value="closed"]').attr('checked')
    ).toBeDefined()
    expect(
      $('#grant-setup input[value="open"]').attr('checked')
    ).toBeUndefined()
    expect($('#grant-setup button[type="submit"]').text().trim()).toBe(
      'Save changes'
    )
    expect($('title').text()).toContain('Grant setup')
  })
  test('saves the selection as the signed-in operator and returns to Grant setup', async () => {
    let actor = {}
    vi.mocked(putToGas).mockImplementation(async (_path, options) => {
      actor = currentGasActor()
      open = (options?.payload as { open: boolean }).open
      return { grantCode: 'woodland', open }
    })
    const response = await post({ status: 'open' })
    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe(url)
    expect(actor).toMatchObject({ name: 'Ada Lovelace', id: 'operator-1' })
    const cookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0]
    const page = await get(cookie)
    const $ = load(page.payload)
    expect($('#grant-setup input[value="open"]').attr('checked')).toBeDefined()
    expect($('.govuk-notification-banner').text()).toContain(
      'Grant setup saved'
    )
    expect($('.govuk-tabs').attr('data-active-tab')).toBe('grant-setup')
  })

  test('shows an accessible error for a missing selection without saving', async () => {
    const response = await post({})
    const $ = load(response.payload)
    expect(response.statusCode).toBe(400)
    expect($('.govuk-error-summary a').attr('href')).toBe('#grant-status')
    expect($('#grant-setup .govuk-error-message').text()).toContain(
      'Select whether the grant is open or closed'
    )
    expect(putToGas).not.toHaveBeenCalled()
  })

  test('keeps the selected state and shows an accessible error when GAS refuses the save', async () => {
    vi.mocked(putToGas).mockRejectedValue(Boom.badRequest())
    const response = await post({ status: 'open' })
    const $ = load(response.payload)
    expect(response.statusCode).toBe(400)
    expect($('#grant-setup input[value="open"]').attr('checked')).toBeDefined()
    expect($('.govuk-error-summary').text()).toContain(
      'Grant setup could not be saved'
    )
    expect($('.govuk-notification-banner')).toHaveLength(0)
  })
  test('explains an unavailable role lookup on save', async () => {
    const error = Boom.serverUnavailable()
    error.output.payload.errorCode = 'CASEWORKING_ROLES_UNAVAILABLE'
    vi.mocked(putToGas).mockRejectedValue(error)
    const response = await post({ status: 'closed' })
    expect(response.statusCode).toBe(503)
    expect(response.payload).toContain(
      'Caseworking roles could not be determined'
    )
  })
  test.each([403, 404, 500])(
    'preserves a GAS %i refusal without showing success',
    async (statusCode) => {
      vi.mocked(putToGas).mockRejectedValue(
        Boom.boomify(new Error('GAS unavailable'), { statusCode })
      )
      const response = await post({ status: 'open' })
      expect(response.statusCode).toBe(statusCode)
      expect(response.payload).not.toContain('Grant setup saved')
    }
  )
  test.each(['true', 'false', '', ['open'], { value: 'open' }])(
    'rejects invalid selection %j without saving',
    async (status) => {
      expect((await post({ status })).statusCode).toBe(400)
      expect(putToGas).not.toHaveBeenCalled()
    }
  )
  test('shows the current saved setting after an allow-list validation error', async () => {
    open = true
    vi.mocked(putToGas).mockRejectedValue(
      Object.assign(Boom.badRequest(), {
        data: {
          payload: {
            ...allowList,
            errorSummary: [
              {
                text: 'Invalid SBI',
                href: '#sbi',
                attributes: { 'data-error-line': 1 }
              }
            ]
          }
        }
      })
    )
    const response = await server.inject({
      method: 'POST',
      url,
      auth,
      payload: { sbi: 'bad', crn: '' }
    })
    const $ = load(response.payload)
    expect(response.statusCode).toBe(400)
    expect($('#grant-setup input[value="open"]').attr('checked')).toBeDefined()
  })

  test.each([
    undefined,
    null,
    {},
    { grantCode: 'woodland', open: 'false' },
    { grantCode: 'other', open: true }
  ])(
    'refuses an unreadable or wrong-grant settings response %j',
    async (settings) => {
      vi.mocked(getFromGas).mockImplementation(async (path) =>
        path.endsWith('/settings') ? settings : allowList
      )
      expect((await get()).statusCode).toBe(502)
    }
  )
  test('requires sign-in before changing grant settings', async () => {
    const response = await server.inject({
      method: 'POST',
      url: settingsUrl,
      payload: { status: 'open' }
    })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/auth/login')
    expect(putToGas).not.toHaveBeenCalled()
  })
})
