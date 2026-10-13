import Boom from '@hapi/boom'
import type { Server } from '@hapi/hapi'
import { load } from 'cheerio'

import { currentGasActor } from '../../common/gas-actor.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { grantOps } from '../index.ts'
import {
  getGrantAllowList,
  replaceGrantAllowList
} from '../repositories/allow-list.repository.ts'

vi.mock(import('../repositories/allow-list.repository.ts'))

const url = '/grant-ops/grants/woodland/admin'
const anchoredUrl = `${url}#who-can-apply`
const credentials = {
  user: { name: 'Ada Lovelace', id: 'operator-1' },
  scope: ['FCP.GrantApplicationsAdmin']
}
const allowList = {
  grantCode: 'woodland',
  global: {
    sbi: ['106000033', '106000044'],
    crn: ['1042000000']
  }
}

const authenticated = {
  strategy: 'session',
  credentials
} as const

const viewPage = async () => {
  const response = await server.inject({
    method: 'GET',
    url,
    auth: authenticated
  })

  return { ...response, $: load(response.result as unknown as string) }
}

const post = (payload: { sbi: string; crn: string }) =>
  server.inject({ method: 'POST', url, payload, auth: authenticated })

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([grantOps])
  await server.initialize()
})

afterAll(async () => {
  await server.stop()
})

describe('viewAllowListRoute', () => {
  beforeEach(() => {
    vi.mocked(getGrantAllowList).mockResolvedValue(allowList)
  })

  test('redirects an anonymous user to login', async () => {
    const response = await server.inject({ method: 'GET', url })

    expect(response.statusCode).toBe(statusCodes.found)
    expect(response.headers.location).toBe('/auth/login')
  })

  test('forbids a user without the applications admin role', async () => {
    const response = await server.inject({
      method: 'GET',
      url,
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantOperationsAdmin']
        }
      }
    })

    expect(response.statusCode).toBe(statusCodes.forbidden)
  })

  test('reads the allow list as the signed-in operator', async () => {
    let actor = {}
    vi.mocked(getGrantAllowList).mockImplementation(async () => {
      actor = currentGasActor()
      return allowList
    })

    await viewPage()

    expect(getGrantAllowList).toHaveBeenCalledWith('woodland')
    expect(actor).toMatchObject({ name: 'Ada Lovelace', id: 'operator-1' })
  })

  test('uses the standard not-found response for an unknown grant', async () => {
    vi.mocked(getGrantAllowList).mockRejectedValue(Boom.notFound())

    const response = await server.inject({
      method: 'GET',
      url,
      auth: authenticated
    })

    expect(response.statusCode).toBe(statusCodes.notFound)
  })

  test('renders the agreed page without the screenshot grant header', async () => {
    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('title').text()).toContain('Who can apply')
    expect($('h1').text().trim()).toBe('Who can apply')
    expect($('body').text()).not.toContain('Woodland Creation')
    expect($('[data-testid="allow-list-explanation"]').text().trim()).toBe(
      'Leave both boxes empty and anyone can apply. Otherwise, only applicants with an SBI or CRN listed here can apply.'
    )
  })

  test('renders setup then who-can-apply tabs with the latter selected', async () => {
    const { $ } = await viewPage()
    const tabs = $('.govuk-tabs__list-item')

    expect(tabs.map((_, tab) => $(tab).text().trim()).get()).toEqual([
      'Grant setup',
      'Who can apply'
    ])
    expect(tabs.eq(1).hasClass('govuk-tabs__list-item--selected')).toBe(true)
  })

  test('keeps both tab panels as ordinary content without JavaScript', async () => {
    const { $ } = await viewPage()

    expect($('#grant-setup')).toHaveLength(1)
    expect($('#who-can-apply')).toHaveLength(1)
    expect($('#grant-setup').attr('hidden')).toBeUndefined()
    expect($('#who-can-apply').attr('hidden')).toBeUndefined()
    expect($('#who-can-apply h2').text().trim()).toBe('Who can apply')
  })

  test('renders SBI before CRN with persisted values and counts', async () => {
    const { $ } = await viewPage()
    const fields = $('#who-can-apply textarea')

    expect(fields.map((_, field) => $(field).attr('id')).get()).toEqual([
      'sbi',
      'crn'
    ])
    expect($('label[for="sbi"]').text().trim()).toBe(
      'Single Business Identifiers (SBIs)'
    )
    expect($('#sbi').attr('name')).toBe('sbi')
    expect($('#sbi').attr('rows')).toBe('10')
    expect($('#sbi').text()).toBe('106000033\n106000044')
    expect($('#sbi-hint').text().trim()).toBe('One per line. 2 listed.')
    expect($('label[for="crn"]').text().trim()).toBe(
      'Customer Reference Numbers (CRNs)'
    )
    expect($('#crn').text()).toBe('1042000000')
    expect($('#crn-hint').text().trim()).toBe('One per line. 1 listed.')
  })

  test('renders save and reset controls that work without JavaScript', async () => {
    const { $ } = await viewPage()

    expect($('button[type="submit"]').text().trim()).toBe('Save allow list')
    expect($('[data-testid="allow-list-reset"]').text().trim()).toBe(
      'Reset changes'
    )
    expect($('[data-testid="allow-list-reset"]').attr('href')).toBe(anchoredUrl)
  })
})

describe('replaceAllowListRoute', () => {
  beforeEach(() => {
    vi.mocked(getGrantAllowList).mockResolvedValue(allowList)
    vi.mocked(replaceGrantAllowList).mockResolvedValue(allowList)
  })

  test('submits both normalized identifier arrays', async () => {
    await post({
      sbi: ' 106000033\r\n\r106000044 ',
      crn: '1042000000\n'
    })

    expect(replaceGrantAllowList).toHaveBeenCalledWith('woodland', {
      sbi: ['106000033', '106000044'],
      crn: ['1042000000']
    })
  })

  test('submits two empty arrays to clear the allow list', async () => {
    await post({ sbi: '', crn: ' \r\n ' })

    expect(replaceGrantAllowList).toHaveBeenCalledWith('woodland', {
      sbi: [],
      crn: []
    })
  })

  test('shows validation errors without writing and preserves exact input', async () => {
    const submitted = {
      sbi: 'bad\r\n bad ',
      crn: '1042000000\n1042000000'
    }

    const response = await post(submitted)
    const $ = load(response.result as unknown as string)

    expect(response.statusCode).toBe(statusCodes.badRequest)
    expect(replaceGrantAllowList).not.toHaveBeenCalled()
    expect($('.govuk-error-summary')).toHaveLength(1)
    expect(
      $('.govuk-error-summary a')
        .map((_, link) => $(link).attr('href'))
        .get()
    ).toEqual(['#sbi', '#sbi', '#sbi', '#crn'])
    expect($('#sbi-error').text()).toContain(
      'SBI "bad" on line 1 must be exactly 9 digits'
    )
    expect($('#crn-error').text()).toContain(
      'CRN "1042000000" on line 2 is a duplicate of line 1'
    )
    expect($('.govuk-error-summary').text()).toContain(
      'SBI "bad" on line 2 is a duplicate of line 1'
    )
    expect($('#sbi').hasClass('app-allow-list-input')).toBe(true)
    expect($('#crn').hasClass('app-allow-list-input')).toBe(true)
    expect(response.result).toEqual(expect.stringContaining(submitted.sbi))
    expect($('#crn').text()).toBe(submitted.crn)
    expect($('#sbi-hint').text().trim()).toBe('One per line. 2 listed.')
    expect($('#crn-hint').text().trim()).toBe('One per line. 2 listed.')
  })

  test('redirects after saving and shows the success once', async () => {
    const saved = await post({ sbi: '106000033', crn: '1042000000' })

    expect(saved.statusCode).toBe(statusCodes.seeOther)
    expect(saved.headers.location).toBe(anchoredUrl)

    const cookie = (saved.headers['set-cookie'] as string[]).join('; ')
    const visit = () =>
      server.inject({
        method: 'GET',
        url,
        headers: { cookie },
        auth: authenticated
      })

    const first = await visit()
    const second = await visit()

    expect(
      load(first.result as unknown as string)(
        '[data-testid="allow-list-saved"]'
      )
        .text()
        .replace(/\s+/g, ' ')
        .trim()
    ).toContain('Allow list saved')
    expect(
      load(second.result as unknown as string)(
        '[data-testid="allow-list-saved"]'
      )
    ).toHaveLength(0)
  })

  test('shows a safe message when GAS rejects the submitted entries', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      Object.assign(new Error('Response Error'), {
        output: { statusCode: 400 },
        data: { payload: { message: 'Unsafe backend detail' } }
      })
    )
    const submitted = { sbi: '106000033', crn: '1042000000' }

    const response = await post(submitted)
    const $ = load(response.result as unknown as string)

    expect(response.statusCode).toBe(statusCodes.badRequest)
    expect($('.govuk-error-summary').text()).toContain(
      'The allow list could not be saved. Check the entries and try again.'
    )
    expect($('body').text()).not.toContain('Unsafe backend detail')
    expect($('#sbi').text()).toBe(submitted.sbi)
    expect($('#crn').text()).toBe(submitted.crn)
  })

  test('uses the standard not-found response when GAS returns 404', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(Boom.notFound())

    const response = await post({ sbi: '', crn: '' })

    expect(response.statusCode).toBe(statusCodes.notFound)
  })

  test('uses standard service error handling for an unexpected failure', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(Boom.serverUnavailable())

    const response = await post({ sbi: '', crn: '' })

    expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
  })
})
