import {
  MockProvider,
  WebIdentityTokenProvider,
  hapiAuthOidcPlugin
} from '@defra/hapi-auth-oidc'

import { config } from '#/config/config.js'

const authConfig = config.get('auth')
const isSecure = config.get('session.cookie.secure')

export const loginPath = '/auth/login'
export const loginCallbackPath = '/auth/callback'
export const logoutPath = '/auth/logout'

/**
 * Entra ID is only ever reached over HTTPS, so a plain HTTP discovery url means
 * we are pointed at the shared Entra stub that fg-cw-backend runs. That single
 * fact settles both how openid-client may talk to the provider, and how the
 * provider expects this app to prove who it is.
 */
const isLocalStub = authConfig.discoveryUri.startsWith('http://')

const tenMinutesMs = 600_000

export const redirectCookieName = 'auth-redirect'

/**
 * Where the user was heading before login has to survive the trip through
 * Entra ID, which returns them cross-site. The yar session cookie is SameSite
 * Lax and so is withheld on the `form_post` callback, hence this separate
 * cookie, relaxed the same way as the plugin's own PKCE cookie. Iron encoding
 * keeps it tamper proof, so it cannot be rewritten into an open redirect.
 */
export const redirectCookieOptions = {
  password: authConfig.cookie.password,
  encoding: 'iron',
  isSecure,
  isSameSite: isSecure ? 'None' : 'Lax',
  isHttpOnly: true,
  path: '/',
  ttl: tenMinutesMs,
  clearInvalid: true,
  ignoreErrors: true
}

/**
 * Entra ID authenticates this app by federation rather than by a shared secret.
 * AWS STS mints a short lived web identity token for the running workload, and
 * the app registration carries a federated credential trusting that issuer and
 * audience, so the token is accepted as the `client_assertion` on token
 * requests. Nothing long lived is deployed alongside the app.
 *
 * The stub has no federated credential to trust, and authenticates clients by
 * the secret it has registered for them, posted alongside the authorization
 * code. `MockProvider` here is doing nothing more than handing that static
 * secret over, in place of one minted per request.
 */
function createAuthProvider() {
  if (isLocalStub) {
    return new MockProvider({
      type: 'client_secret',
      token: 'secret1'
    })
  }

  return new WebIdentityTokenProvider({
    audience: [authConfig.federatedCredentials.audience],
    // The provider only refreshes once expiry has passed, so buy a minute of
    // slack rather than let an assertion lapse in flight to Entra.
    earlyRefreshMs: 60_000
  })
}

/**
 * Drives the OIDC handshake with Entra ID. Decorates requests with `login`,
 * `callback` and `ensureValidToken`. It registers no auth strategy of its own,
 * so route protection lives in ./session-strategy.js
 */
export const oidc = {
  plugin: hapiAuthOidcPlugin,
  options: {
    oidc: {
      clientId: authConfig.clientId,
      discoveryUri: authConfig.discoveryUri,
      useHttp: isLocalStub,
      authProvider: createAuthProvider(),
      loginCallbackUri: loginCallbackPath,
      externalBaseUrl: authConfig.appBaseUrl,
      // offline_access buys a refresh token, without which sessions die at the
      // first access token expiry.
      scope: 'openid profile email offline_access',
      // Entra returns the auth code by POSTing a form cross-site, so the cookie
      // holding the PKCE verifier only survives the round trip when it is
      // SameSite=None, which browsers honour only on Secure cookies. Over plain
      // HTTP there is no such pairing, so take the code on a same-site redirect.
      responseMode: isSecure ? 'form_post' : 'query'
    },
    cookieOptions: {
      password: authConfig.cookie.password,
      isSecure,
      isSameSite: isSecure ? 'None' : 'Lax'
    }
  }
}
