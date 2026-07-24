import { MockProvider, WebIdentityTokenProvider } from '@defra/hapi-auth-oidc'

import { loginCallbackPath } from './paths.ts'

vi.mock(import('@defra/hapi-auth-oidc'))
vi.mock(import('../../../common/config.ts'))

const entraDiscoveryUri =
  'https://login.microsoftonline.com/tenant-id/v2.0/.well-known/openid-configuration'

/**
 * The module settles its provider and cookie choices as it loads, so each case
 * takes a fresh copy of it. Config is written after the reset and before that
 * import, which is what puts the values on the instance the copy will read.
 */
const loadOidc = async (overrides: Record<string, unknown>) => {
  vi.resetModules()

  const { config } = await import('../../../common/config.ts')

  for (const [key, value] of Object.entries(overrides)) {
    config.set(key, value)
  }

  const { oidc } = await import('./oidc.ts')

  return oidc.options
}

describe('oidc against Entra ID', () => {
  const deployed = {
    'auth.discoveryUri': entraDiscoveryUri,
    'auth.clientId': 'client-id',
    'auth.appBaseUrl': 'https://admin.example',
    'auth.federatedCredentials.audience': 'api://AzureADTokenExchange',
    'session.cookie.secure': true
  }

  test('authenticates with a web identity token minted for the federated credential audience', async () => {
    await loadOidc(deployed)

    expect(WebIdentityTokenProvider).toHaveBeenCalledWith({
      audience: ['api://AzureADTokenExchange'],
      earlyRefreshMs: 60_000
    })
    expect(MockProvider).not.toHaveBeenCalled()
  })

  test('drives the handshake over https, returning the user to the callback path', async () => {
    const { oidc } = await loadOidc(deployed)

    expect(oidc).toMatchObject({
      clientId: 'client-id',
      discoveryUri: entraDiscoveryUri,
      useHttp: false,
      externalBaseUrl: 'https://admin.example',
      loginCallbackUri: loginCallbackPath
    })
  })

  test('asks for a refresh token alongside the profile', async () => {
    const { oidc } = await loadOidc(deployed)

    expect(oidc.scope.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email', 'offline_access'])
    )
  })

  test('takes the code by cross-site form post, on a cookie a browser will send with it', async () => {
    const { oidc, cookieOptions } = await loadOidc(deployed)

    expect(oidc.responseMode).toBe('form_post')
    expect(cookieOptions).toMatchObject({ isSecure: true, isSameSite: 'None' })
  })
})

describe('oidc against the local Entra stub', () => {
  const local = {
    'auth.discoveryUri':
      'http://localhost:3010/tenant-id/v2.0/.well-known/openid-configuration',
    'session.cookie.secure': false
  }

  test('authenticates with the secret the stub has registered', async () => {
    await loadOidc(local)

    expect(MockProvider).toHaveBeenCalledWith({
      type: 'client_secret',
      token: 'secret1'
    })
    expect(WebIdentityTokenProvider).not.toHaveBeenCalled()
  })

  test('allows the handshake over plain http', async () => {
    const { oidc } = await loadOidc(local)

    expect(oidc.useHttp).toBe(true)
  })

  test('takes the code on a same-site redirect instead of a form post', async () => {
    const { oidc, cookieOptions } = await loadOidc(local)

    expect(oidc.responseMode).toBe('query')
    expect(cookieOptions).toMatchObject({ isSecure: false, isSameSite: 'Lax' })
  })
})
