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

vi.mock(
  import('../repositories/allow-list.repository.ts'),
  async (importOriginal) => ({
    ...(await importOriginal()),
    getGrantAllowList: vi.fn(),
    replaceGrantAllowList: vi.fn()
  })
)

const url = '/grant-ops/grants/woodland/admin'
const resetUrl = `${url}/reset`
const escapedUrl = '/grant-ops/grants/wood%20land/admin'
const credentials = {
  user: {
    name: 'Ada Lovelace',
    id: 'operator-1'
  },
  scope: ['FCP.GrantApplicationsAdmin']
}

const view = {
  sbi: {
    key: 'sbi' as const,
    label: 'Single Business Identifiers (SBIs)',
    value: '900000002\n900000003',
    hint: 'One per line. 2 listed.'
  },
  crn: {
    key: 'crn' as const,
    label: 'Customer Reference Numbers (CRNs)',
    value: '9000000001',
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
  Object.assign(Boom.boomify(new Error('Response Error'), { statusCode }), {
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
    expect($('title').text()).not.toContain('Error:')
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
    expect($('#sbi').text()).toBe('900000002\n900000003')
    expect($('#sbi-hint').text().trim()).toBe('One per line. 2 listed.')
    expect($('label[for="crn"]').text().trim()).toBe(
      'Customer Reference Numbers (CRNs)'
    )
    expect($('#crn').text()).toBe('9000000001')
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

  test('reads the allow list for the unescaped code and escapes it in the form hrefs', async () => {
    const response = await server.inject({
      method: 'GET',
      url: escapedUrl,
      auth: authenticated
    })
    const $ = load(response.result as unknown as string)

    expect(getGrantAllowList).toHaveBeenCalledWith('wood land')
    expect($('#who-can-apply form').attr('action')).toBe(escapedUrl)
    expect($('[data-testid="allow-list-reset"]').attr('href')).toBe(
      `${escapedUrl}/reset`
    )
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
    expect($('#sbi').text()).toBe('900000002\n900000003')
    expect($('#crn').text()).toBe('9000000001')
    expect($('[data-testid="allow-list-saved"]')).toHaveLength(0)
  })

  test('redirects a reset to the escaped admin page', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `${escapedUrl}/reset`,
      auth: authenticated
    })

    expect(response.headers.location).toBe(escapedUrl)
  })
})

describe('replaceAllowListRoute', () => {
  beforeEach(() => {
    vi.mocked(getGrantAllowList).mockResolvedValue(view)
    vi.mocked(replaceGrantAllowList).mockResolvedValue(view)
  })

  test('saves without first calling GAS to check access', async () => {
    await post({ sbi: '900000002', crn: '' })

    expect(getGrantAllowList).not.toHaveBeenCalled()
  })

  test('returns forbidden when GAS denies the write', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(Boom.forbidden())
    const response = await post({ sbi: '900000002', crn: '' })
    expect(response.statusCode).toBe(403)
  })

  test('submits the raw text fields as-is, unparsed', async () => {
    const submitted = { sbi: ' 900000002\r\n\r900000003 ', crn: '9000000001\n' }
    await post(submitted)

    expect(replaceGrantAllowList).toHaveBeenCalledWith('woodland', submitted)
  })

  test('renders every error without JavaScript so no failures are inaccessible', async () => {
    const errors = Array.from({ length: 11 }, (_, index) => ({
      text: `SBI on line ${index + 1} must be exactly 9 digits`,
      href: '#sbi',
      attributes: { 'data-error-line': index + 1 }
    }))
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(400, { ...view, errorSummary: errors })
    )

    const response = await post({ sbi: 'bad', crn: '' })
    const $ = load(response.result as unknown as string)

    expect(response.statusCode).toBe(statusCodes.badRequest)
    expect(
      $('[data-allow-list-errors] .govuk-error-summary__list li')
    ).toHaveLength(11)
    expect($('[data-allow-list-errors] [hidden]')).toHaveLength(0)
    expect($('[data-allow-list-errors] button')).toHaveLength(0)
  })

  test('redirects to the admin page on success', async () => {
    const response = await post({ sbi: '', crn: '' })

    expect(response.headers.location).toBe(url)
  })

  test('shows the view GAS shaped for a validation failure, without writing again', async () => {
    const submitted = { sbi: 'bad', crn: '9000000001\n9000000001' }
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
        value: '9000000001\n9000000001',
        hint: 'One per line. 2 listed.',
        error: 'CRN "9000000001" on line 2 is a duplicate of line 1'
      },
      errorSummary: [
        {
          text: 'SBI "bad" on line 1 must be exactly 9 digits',
          href: '#sbi',
          attributes: { 'data-error-line': 1 }
        },
        {
          text: 'CRN "9000000001" on line 2 is a duplicate of line 1',
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
    expect($('title').text()).toContain('Error: Who can apply')
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
      'CRN "9000000001" on line 2 is a duplicate of line 1'
    )
    expect($('#sbi').hasClass('app-allow-list-input')).toBe(true)
    expect($('#crn').hasClass('app-allow-list-input')).toBe(true)
    expect($('#sbi').text()).toBe(submitted.sbi)
    expect($('#crn').text()).toBe(submitted.crn)
    expect($('#sbi-hint').text().trim()).toBe('One per line. 1 listed.')
    expect($('#crn-hint').text().trim()).toBe('One per line. 2 listed.')
  })

  test('redirects after saving and shows the success once', async () => {
    const saved = await post({ sbi: '900000002', crn: '9000000001' })

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
    expect($('title').text()).toContain('Error: Who can apply')
    expect($('.govuk-error-summary').text()).toContain(
      'The allow list could not be saved. Check the entries and try again.'
    )
    expect($('body').text()).not.toContain('Unsafe backend detail')
    // The re-fetched saved state is shown, not the unsaved submission.
    expect($('#sbi').text()).toBe('900000002\n900000003')
    expect($('#crn').text()).toBe('9000000001')
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
    expect(load(response.result as unknown as string)('body').text()).toContain(
      'Something went wrong'
    )
  })

  test('saves for the unescaped code and redirects to the escaped admin page', async () => {
    const submitted = { sbi: '900000002', crn: '' }
    const response = await server.inject({
      method: 'POST',
      url: escapedUrl,
      payload: submitted,
      auth: authenticated
    })

    expect(replaceGrantAllowList).toHaveBeenCalledWith('wood land', submitted)
    expect(response.headers.location).toBe(escapedUrl)
  })
})

describe('allow-list administration access refusals', () => {
  const unavailable =
    'Caseworking roles could not be determined — try again later'

  const request = (method: 'GET' | 'POST') =>
    server.inject({
      method,
      url,
      payload: method === 'POST' ? { sbi: '', crn: '' } : undefined,
      auth: authenticated
    })

  beforeEach(() => {
    vi.mocked(getGrantAllowList).mockResolvedValue(view)
    vi.mocked(replaceGrantAllowList).mockResolvedValue(view)
  })

  test.each(['GET', 'POST'] as const)(
    '%s explains that GAS could not determine the roles',
    async (method) => {
      const rolesUnavailable = gasError(503, {
        errorCode: 'CASEWORKING_ROLES_UNAVAILABLE'
      })
      vi.mocked(getGrantAllowList).mockRejectedValue(rolesUnavailable)
      vi.mocked(replaceGrantAllowList).mockRejectedValue(rolesUnavailable)

      const response = await request(method)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(
        load(response.result as unknown as string)('body').text()
      ).toContain(unavailable)
    }
  )

  test.each(['GET', 'POST'] as const)(
    '%s forbids administration when GAS refuses it',
    async (method) => {
      vi.mocked(getGrantAllowList).mockRejectedValue(gasError(403))
      vi.mocked(replaceGrantAllowList).mockRejectedValue(gasError(403))

      const response = await request(method)

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(
        load(response.result as unknown as string)('body').text()
      ).not.toContain(unavailable)
    }
  )

  test.each([
    ['GET', 404],
    ['GET', 502],
    ['GET', 503],
    ['POST', 404],
    ['POST', 502],
    ['POST', 503]
  ] as const)('%s preserves GAS %i', async (method, statusCode) => {
    const error = Boom.boomify(new Error('GAS failure'), { statusCode })
    vi.mocked(getGrantAllowList).mockRejectedValue(error)
    vi.mocked(replaceGrantAllowList).mockRejectedValue(error)

    const response = await request(method)

    expect(response.statusCode).toBe(statusCode)
    expect(
      load(response.result as unknown as string)('body').text()
    ).not.toContain(unavailable)
  })

  test.each(['GET', 'POST'] as const)(
    '%s keeps a GAS 503 naming another error code on the generic error page',
    async (method) => {
      const error = gasError(503, { errorCode: 'CONFIGURATION_UNAVAILABLE' })
      vi.mocked(getGrantAllowList).mockRejectedValue(error)
      vi.mocked(replaceGrantAllowList).mockRejectedValue(error)

      const response = await request(method)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(
        load(response.result as unknown as string)('body').text()
      ).not.toContain(unavailable)
    }
  )

  test('keeps a GAS 503 on the generic error page when re-reading after a refused save', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(400, { message: 'Unshaped refusal' })
    )
    vi.mocked(getGrantAllowList).mockRejectedValue(gasError(503))

    const response = await request('POST')

    expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
    expect(
      load(response.result as unknown as string)('body').text()
    ).not.toContain(unavailable)
  })
})
