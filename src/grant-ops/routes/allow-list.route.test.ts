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
const resetUrl = `${url}/reset`
const credentials = {
  user: {
    name: 'Ada Lovelace',
    id: 'operator-1',
    cwRoles: ['ROLE_WOODLAND_ADMIN']
  },
  scope: ['FCP.GrantApplicationsAdmin']
}

const view = {
  sbi: {
    key: 'sbi' as const,
    label: 'Single Business Identifiers (SBIs)',
    value: '106000033\n106000044',
    hint: 'One per line. 2 listed.'
  },
  crn: {
    key: 'crn' as const,
    label: 'Customer Reference Numbers (CRNs)',
    value: '1042000000',
    hint: 'One per line. 1 listed.'
  },
  errorSummary: []
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

/** A wreck-thrown non-2xx, matching what @hapi/wreck attaches to the error. */
const gasError = (statusCode: number, payload?: object) =>
  Object.assign(new Error('Response Error'), {
    output: { statusCode },
    data: { payload }
  })

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
    vi.mocked(getGrantAllowList).mockResolvedValue(view)
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
      return view
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

  test('uses the standard forbidden response when GAS denies grant administration', async () => {
    vi.mocked(getGrantAllowList).mockRejectedValue(Boom.forbidden())

    const response = await server.inject({
      method: 'GET',
      url,
      auth: authenticated
    })

    expect(response.statusCode).toBe(statusCodes.forbidden)
  })

  test('shows the current grant code without the screenshot grant header', async () => {
    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('title').text()).toContain('Who can apply')
    expect($('h1').text().trim()).toBe('Grant code woodland')
    expect($('body').text()).not.toContain('Woodland Creation')
    expect($('[data-testid="allow-list-explanation"]').text().trim()).toBe(
      'Leave both boxes empty and anyone can apply. Otherwise, only applicants with an SBI or CRN listed here can apply.'
    )
  })

  test('renders setup then who-can-apply tabs with setup selected on normal entry', async () => {
    const { $ } = await viewPage()
    const tabs = $('.govuk-tabs__list-item')

    expect(tabs.map((_, tab) => $(tab).text().trim()).get()).toEqual([
      'Grant setup',
      'Who can apply'
    ])
    expect(tabs.eq(0).hasClass('govuk-tabs__list-item--selected')).toBe(true)
    expect($('.govuk-tabs').attr('data-active-tab')).toBe('grant-setup')
  })

  test('keeps both tab panels as ordinary content without JavaScript', async () => {
    const { $ } = await viewPage()

    expect($('#grant-setup')).toHaveLength(1)
    expect($('#who-can-apply')).toHaveLength(1)
    expect($('#grant-setup').attr('hidden')).toBeUndefined()
    expect($('#who-can-apply').attr('hidden')).toBeUndefined()
    expect($('#who-can-apply h2').text().trim()).toBe('Who can apply')
  })

  test('renders SBI before CRN with the view GAS built', async () => {
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
    const reset = $('[data-testid="allow-list-reset"]')

    expect($('#who-can-apply form').attr('action')).toBe(url)
    expect($('button[type="submit"]').text().trim()).toBe('Save allow list')
    expect(reset.text().trim()).toBe('Reset changes')
    expect(reset.attr('href')).toBe(resetUrl)
    expect(reset.hasClass('govuk-button--secondary')).toBe(true)
  })
})

describe('resetAllowListRoute', () => {
  test('redirects without calling GAS, deferring the access check to the view', async () => {
    const response = await server.inject({
      method: 'GET',
      url: resetUrl,
      auth: authenticated
    })

    expect(response.statusCode).toBe(statusCodes.seeOther)
    expect(getGrantAllowList).not.toHaveBeenCalled()
  })

  test('denies the redirected view when GAS denies grant administration', async () => {
    vi.mocked(getGrantAllowList).mockRejectedValue(Boom.forbidden())
    const reset = await server.inject({
      method: 'GET',
      url: resetUrl,
      auth: authenticated
    })

    expect(reset.statusCode).toBe(statusCodes.seeOther)

    const cookie = (reset.headers['set-cookie'] as string[]).join('; ')
    const followed = await server.inject({
      method: 'GET',
      url,
      headers: { cookie },
      auth: authenticated
    })

    expect(followed.statusCode).toBe(403)
  })

  test('redirects to a fresh view of the persisted allow list', async () => {
    vi.mocked(getGrantAllowList).mockResolvedValue(view)
    const response = await server.inject({
      method: 'GET',
      url: resetUrl,
      auth: authenticated
    })

    expect(response.statusCode).toBe(statusCodes.seeOther)
    expect(response.headers.location).toBe(url)

    vi.mocked(getGrantAllowList).mockResolvedValue(view)
    const cookie = (response.headers['set-cookie'] as string[]).join('; ')
    const fresh = await server.inject({
      method: 'GET',
      url,
      headers: { cookie },
      auth: authenticated
    })
    const $ = load(fresh.result as unknown as string)

    expect($('.govuk-tabs').attr('data-active-tab')).toBe('who-can-apply')
    expect($('#sbi').text()).toBe('106000033\n106000044')
    expect($('#crn').text()).toBe('1042000000')
    expect($('[data-testid="allow-list-saved"]')).toHaveLength(0)
  })
})

describe('replaceAllowListRoute', () => {
  beforeEach(() => {
    vi.mocked(getGrantAllowList).mockResolvedValue(view)
    vi.mocked(replaceGrantAllowList).mockResolvedValue(view)
  })

  test('saves without first calling GAS to check access', async () => {
    await post({ sbi: '106000033', crn: '' })

    expect(getGrantAllowList).not.toHaveBeenCalled()
  })

  test('returns forbidden when GAS denies the write', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(Boom.forbidden())
    const response = await post({ sbi: '106000033', crn: '' })
    expect(response.statusCode).toBe(403)
  })

  test('submits the raw text fields as-is, unparsed', async () => {
    const submitted = { sbi: ' 106000033\r\n\r106000044 ', crn: '1042000000\n' }
    await post(submitted)

    expect(replaceGrantAllowList).toHaveBeenCalledWith('woodland', submitted)
  })

  test('redirects to the admin page on success', async () => {
    const response = await post({ sbi: '', crn: '' })

    expect(response.headers.location).toBe(url)
  })

  test('shows the view GAS shaped for a validation failure, without writing again', async () => {
    const submitted = { sbi: 'bad', crn: '1042000000\n1042000000' }
    const invalidView = {
      sbi: {
        key: 'sbi' as const,
        label: 'Single Business Identifiers (SBIs)',
        value: 'bad',
        hint: 'One per line. 1 listed.',
        error: 'SBI "bad" on line 1 must be exactly 9 digits'
      },
      crn: {
        key: 'crn' as const,
        label: 'Customer Reference Numbers (CRNs)',
        value: '1042000000\n1042000000',
        hint: 'One per line. 2 listed.',
        error: 'CRN "1042000000" on line 2 is a duplicate of line 1'
      },
      errorSummary: [
        {
          text: 'SBI "bad" on line 1 must be exactly 9 digits',
          href: '#sbi',
          attributes: { 'data-error-line': 1 }
        },
        {
          text: 'CRN "1042000000" on line 2 is a duplicate of line 1',
          href: '#crn',
          attributes: { 'data-error-line': 2 }
        }
      ]
    }
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(400, invalidView)
    )

    const response = await post(submitted)
    const $ = load(response.result as unknown as string)

    expect(response.statusCode).toBe(statusCodes.badRequest)
    expect(replaceGrantAllowList).toHaveBeenCalledWith('woodland', submitted)
    expect($('.govuk-error-summary')).toHaveLength(1)
    expect($('.govuk-tabs').attr('data-active-tab')).toBe('who-can-apply')
    expect(
      $('.govuk-error-summary a')
        .map((_, link) => $(link).attr('href'))
        .get()
    ).toEqual(['#sbi', '#crn'])
    expect(
      $('.govuk-error-summary a')
        .map((_, link) => $(link).attr('data-error-line'))
        .get()
    ).toEqual(['1', '2'])
    expect($('#sbi-error').text()).toContain(
      'SBI "bad" on line 1 must be exactly 9 digits'
    )
    expect($('#crn-error').text()).toContain(
      'CRN "1042000000" on line 2 is a duplicate of line 1'
    )
    expect($('#sbi').hasClass('app-allow-list-input')).toBe(true)
    expect($('#crn').hasClass('app-allow-list-input')).toBe(true)
    expect($('#sbi').text()).toBe(submitted.sbi)
    expect($('#crn').text()).toBe(submitted.crn)
    expect($('#sbi-hint').text().trim()).toBe('One per line. 1 listed.')
    expect($('#crn-hint').text().trim()).toBe('One per line. 2 listed.')
  })

  test('redirects after saving and shows the success once', async () => {
    const saved = await post({ sbi: '106000033', crn: '1042000000' })

    expect(saved.statusCode).toBe(statusCodes.seeOther)
    expect(saved.headers.location).toBe(url)

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
      load(first.result as unknown as string)('.govuk-tabs').attr(
        'data-active-tab'
      )
    ).toBe('who-can-apply')
    expect(
      load(second.result as unknown as string)('.govuk-tabs').attr(
        'data-active-tab'
      )
    ).toBe('grant-setup')

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

  test('shows a safe generic message and re-fetches the saved state for an unshaped refusal', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(400, { message: 'Unsafe backend detail' })
    )
    const submitted = { sbi: 'anything', crn: 'anything' }

    const response = await post(submitted)
    const $ = load(response.result as unknown as string)

    expect(response.statusCode).toBe(statusCodes.badRequest)
    expect(getGrantAllowList).toHaveBeenCalledWith('woodland')
    expect($('.govuk-error-summary').text()).toContain(
      'The allow list could not be saved. Check the entries and try again.'
    )
    expect($('body').text()).not.toContain('Unsafe backend detail')
    // The re-fetched saved state is shown, not the unsaved submission.
    expect($('#sbi').text()).toBe('106000033\n106000044')
    expect($('#crn').text()).toBe('1042000000')
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
