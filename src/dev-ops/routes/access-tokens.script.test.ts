// @vitest-environment happy-dom
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { ListedToken } from '../use-cases/access-tokens.use-case.ts'
import {
  changeTokenExpiryUseCase,
  listAccessTokensUseCase
} from '../use-cases/access-tokens.use-case.ts'
import { storedTokenDocument } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../use-cases/access-tokens.use-case.ts'), async (original) => ({
  ...(await original()),
  listAccessTokensUseCase: vi.fn(),
  changeTokenExpiryUseCase: vi.fn()
}))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const token = (fields: Partial<ListedToken>): ListedToken => ({
  tokenId: '6650c1f2a9e4b1d07c20bd91',
  clientId: 'grants-ui',
  tokenHint: '3e1d',
  status: 'ACTIVE',
  createdAt: null,
  createdBy: null,
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: false,
  expiringSoon: false,
  document: storedTokenDocument(),
  ...fields
})

const active = '6650c1f2a9e4b1d07c20bd91'
const inUse = '6650c1f2a9e4b1d07c20bd92'

let server: Server

/** The page as the server draws it, put in the document for the components' elements to upgrade. */
const open = async (
  url: string,
  posted: { method?: 'POST'; payload?: Record<string, string> } = {}
) => {
  const { payload } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials },
    headers: { 'sec-fetch-site': 'same-origin' },
    ...posted
  })

  const template = document.createElement('template')
  template.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(payload)?.[1] ?? ''
  // Whole, as a browser has the page by the time the module script defines the elements.
  document.body.replaceChildren(template.content)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const dialog = (id: string) => document.getElementById(id) as HTMLDialogElement

const click = (element: Element | null) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  element?.dispatchEvent(event)

  return event
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
  await import('../views/components/index.ts')
})

beforeEach(() => {
  vi.mocked(listAccessTokensUseCase).mockResolvedValue({
    outcome: 'done',
    tokens: [
      token({ tokenId: active }),
      token({
        tokenId: inUse,
        clientId: 'fg-grants-platform-admin',
        tokenHint: '0c4a',
        inUse: true
      })
    ]
  })
})

afterAll(async () => {
  await server.stop()
})

describe('with the script', () => {
  test('a row opens its drawer in place, without leaving the page', async () => {
    await open('/dev-ops/clients/gas')

    const event = click(
      document.querySelector(`a[data-gpa-open="token-${active}"]`)
    )

    expect(event.defaultPrevented).toBe(true)
    expect(dialog(`token-${active}`).open).toBe(true)
    expect(dialog(`token-${inUse}`).open).toBe(false)
  })

  test('the drawer’s buttons open their dialogs over it, and Cancel closes only the dialog', async () => {
    await open('/dev-ops/clients/gas')
    click(document.querySelector(`a[data-gpa-open="token-${active}"]`))

    for (const kind of ['rotate', 'expiry', 'revoke']) {
      const opener = document.querySelector(
        `#token-${active} [data-gpa-open="token-${active}-${kind}"]`
      )
      const event = click(opener)

      expect(event.defaultPrevented).toBe(true)
      expect(dialog(`token-${active}-${kind}`).open).toBe(true)

      click(
        dialog(`token-${active}-${kind}`).querySelector(
          '.gpa-dialog-foot [data-gpa-close]'
        )
      )
      await settle()

      expect(dialog(`token-${active}-${kind}`).open).toBe(false)
      expect(dialog(`token-${active}`).open).toBe(true)
    }
  })

  test('New token opens in place from the header', async () => {
    await open('/dev-ops/clients/gas')

    const event = click(
      document.querySelector('[data-testid="token-new-open"]')
    )

    expect(event.defaultPrevented).toBe(true)
    expect(dialog('token-new').open).toBe(true)
  })

  test('Revoke stays off until the client is typed', async () => {
    await open(`/dev-ops/clients/gas?token=${active}&dialog=revoke`)
    const confirm = dialog(`token-${active}-revoke`).querySelector(
      '[data-gpa-confirm]'
    ) as HTMLButtonElement
    const typed = dialog(`token-${active}-revoke`).querySelector(
      'input[name="confirmText"]'
    ) as HTMLInputElement

    expect(dialog(`token-${active}-revoke`).open).toBe(true)
    expect(confirm.disabled).toBe(true)

    typed.value = 'grants-ui'
    typed.dispatchEvent(new Event('input', { bubbles: true }))

    expect(confirm.disabled).toBe(false)
  })

  test('Revoke on the token in use does nothing when pressed', async () => {
    await open(`/dev-ops/clients/gas?token=${inUse}`)
    const revoke = document.querySelector(
      `#token-${inUse} [data-testid="token-revoke"]`
    )

    const event = click(revoke)

    expect(event.defaultPrevented).toBe(true)
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
  })

  test('a dialog the address asks for arrives open, over its token’s drawer', async () => {
    await open(`/dev-ops/clients/gas?token=${active}&dialog=expiry`)

    expect(dialog(`token-${active}`).open).toBe(true)
    expect(dialog(`token-${active}-expiry`).open).toBe(true)
  })

  test('a custom date GAS refuses comes back open on its dialog, the date box saying why', async () => {
    vi.mocked(changeTokenExpiryUseCase).mockResolvedValueOnce({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'EXPIRY_UNCHANGED',
      list: await listAccessTokensUseCase('gas')
    })
    vi.mocked(listAccessTokensUseCase).mockClear()

    await open(`/dev-ops/clients/gas/grants-ui/tokens/${active}/expiry`, {
      method: 'POST',
      payload: { expiry: 'custom', date: '2099-01-31', hint: '' }
    })

    expect(listAccessTokensUseCase).not.toHaveBeenCalled()
    expect(dialog(`token-${active}-expiry`).open).toBe(true)
    expect(
      document
        .getElementById(`token-${active}-expiry-choice-date-err`)
        ?.textContent.trim()
    ).toBe('The token already expires on that day. Pick another.')
  })

  test('the expiry date is typed into a text box and submitted as the day the form posts', async () => {
    await open(`/dev-ops/clients/gas?token=${active}&dialog=expiry`)
    const form = dialog(`token-${active}-expiry`).querySelector(
      'form'
    ) as HTMLFormElement
    const typed = form.querySelector(
      'gpa-date-picker input[type="text"]'
    ) as HTMLInputElement
    const box = typed.closest('.gpa-input') as HTMLElement
    const enter = (text: string) => {
      typed.value = text
      typed.dispatchEvent(new Event('blur'))
    }

    expect(form.querySelectorAll('input[name="date"]')).toHaveLength(1)
    expect(new FormData(form).get('date')).toBe('')

    enter('4 Feb 2099')

    expect(new FormData(form).get('date')).toBe('2099-02-04')
    expect(typed.value).toBe('4 Feb 2099')
    expect(box.classList.contains('is-invalid')).toBe(false)

    enter('1 Jan 2020')

    expect(box.classList.contains('is-invalid')).toBe(true)
    expect(typed.getAttribute('aria-invalid')).toBe('true')
  })

  test('the client ID’s copy button shows once the script runs', async () => {
    await open(`/dev-ops/clients/gas?token=${active}`)

    expect(
      (
        document.querySelector(
          `#token-${active} gpa-copy [data-gpa-copy]`
        ) as HTMLElement
      ).hidden
    ).toBe(false)
  })
})

describe('the expiry date box, with the script', () => {
  const datedToken = () =>
    vi.mocked(listAccessTokensUseCase).mockResolvedValue({
      outcome: 'done',
      tokens: [
        token({ tokenId: active, expiresAt: '2099-05-31T22:59:59.000Z' })
      ]
    })

  const dateBox = (dialogId: string) => {
    const form = dialog(dialogId).querySelector('form') as HTMLFormElement
    const typed = form.querySelector(
      'gpa-date-picker input[type="text"]'
    ) as HTMLInputElement

    return {
      form,
      typed,
      box: typed.closest('.gpa-input') as HTMLElement,
      posted: () => new FormData(form).get('date'),
      enter: (text: string) => {
        typed.value = text
        typed.dispatchEvent(new Event('blur'))
      }
    }
  }

  const submit = (form: HTMLFormElement) => {
    const event = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(event)

    return event
  }

  test('opened again after Cancel, shows and posts the token’s day, not the one picked before', async () => {
    datedToken()
    await open('/dev-ops/clients/gas')
    click(document.querySelector(`a[data-gpa-open="token-${active}"]`))
    const opener = document.querySelector(
      `#token-${active} [data-gpa-open="token-${active}-expiry"]`
    )
    click(opener)
    const { form, typed, posted, enter } = dateBox(`token-${active}-expiry`)

    expect(posted()).toBe('2099-05-31')

    enter('4 Feb 2099')

    expect(posted()).toBe('2099-02-04')

    click(
      dialog(`token-${active}-expiry`).querySelector(
        '.gpa-dialog-foot [data-gpa-close]'
      )
    )
    await settle()
    click(opener)
    await settle()

    expect(typed.value).toBe('31 May 2099')
    expect(posted()).toBe('2099-05-31')
    expect(form.querySelectorAll('input[name="date"]')).toHaveLength(1)
  })

  test('New token opened again after Cancel has no day, as the server drew it', async () => {
    await open('/dev-ops/clients/gas')
    const opener = document.querySelector('[data-testid="token-new-open"]')
    click(opener)
    const { typed, posted, enter } = dateBox('token-new')

    enter('4 Feb 2099')

    expect(posted()).toBe('2099-02-04')

    click(
      dialog('token-new').querySelector('.gpa-dialog-foot [data-gpa-close]')
    )
    await settle()
    click(opener)
    await settle()

    expect(typed.value).toBe('')
    expect(posted()).toBe('')
  })

  test.each(['31 Fob 2099', '1 Jan 2020'])(
    'text it can’t take (%s) stops the form being sent and puts focus back on it',
    async (text) => {
      datedToken()
      await open(`/dev-ops/clients/gas?token=${active}&dialog=expiry`)
      const { form, typed, enter } = dateBox(`token-${active}-expiry`)

      enter(text)

      expect(submit(form).defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(typed)
    }
  )

  test('text it can’t take in a date box the form hides, once another expiry is picked, doesn’t stop the form being sent', async () => {
    datedToken()
    await open(`/dev-ops/clients/gas?token=${active}&dialog=expiry`)
    const { form, typed, enter } = dateBox(`token-${active}-expiry`)

    enter('zz')
    click(form.querySelector('input[name="expiry"]:not([value="custom"])'))
    const custom = typed.closest('.gpa-check-conditional') as HTMLElement
    // The stylesheet hides it; the test page has no stylesheet.
    custom.style.display = 'none'

    expect(submit(form).defaultPrevented).toBe(false)
  })

  test('a day it can read lets the form be sent', async () => {
    datedToken()
    await open(`/dev-ops/clients/gas?token=${active}&dialog=expiry`)
    const { form, posted, enter } = dateBox(`token-${active}-expiry`)

    enter('4 Feb 2099')

    expect(submit(form).defaultPrevented).toBe(false)
    expect(posted()).toBe('2099-02-04')
  })

  test('Today is on, as a token may end at the end of today', async () => {
    await open(`/dev-ops/clients/gas?token=${active}&dialog=expiry`)
    const picker = dialog(`token-${active}-expiry`).querySelector(
      'gpa-date-picker'
    ) as HTMLElement

    click(picker.querySelector('.gpa-datefield-btn'))
    const todayButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Today'
    )

    expect(picker.dataset.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(todayButton?.disabled).toBe(false)
  })

  test('the server’s answer on the date box goes once a day it takes is typed', async () => {
    vi.mocked(changeTokenExpiryUseCase).mockResolvedValueOnce({
      outcome: 'refused',
      statusCode: 400,
      errorCode: 'EXPIRY_PAST',
      list: await listAccessTokensUseCase('gas')
    })

    await open(`/dev-ops/clients/gas/grants-ui/tokens/${active}/expiry`, {
      method: 'POST',
      payload: { expiry: 'custom', date: '2020-01-01', hint: '' }
    })
    const { box, typed, posted, enter } = dateBox(`token-${active}-expiry`)

    expect(dialog(`token-${active}-expiry`).open).toBe(true)
    expect(box.classList.contains('is-invalid')).toBe(true)
    expect(typed.getAttribute('aria-invalid')).toBe('true')

    enter('4 Feb 2099')

    expect(posted()).toBe('2099-02-04')
    expect(box.classList.contains('is-invalid')).toBe(false)
    expect(typed.hasAttribute('aria-invalid')).toBe(false)
  })
})
