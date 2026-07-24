import {
  MockProvider,
  WebIdentityTokenProvider,
  hapiAuthOidcPlugin
} from '@defra/hapi-auth-oidc'

import { config } from '../../../common/config.ts'
import { loginCallbackPath } from './paths.ts'

const authConfig = config.get('auth')
const isSecure = config.get('session.cookie.secure')

// Entra ID is only ever reached over HTTPS, so a plain HTTP discovery url means
// we are pointed at the shared Entra stub that fg-cw-backend runs.
const isLocalStub = authConfig.discoveryUri.startsWith('http://')

/**
 * Entra ID authenticates this app by federation rather than a shared secret:
 * AWS STS mints a short lived web identity token for the running workload, and
 * a federated credential on the app registration trusts that issuer and
 * audience, so the token is accepted as the `client_assertion`. Nothing long
 * lived is deployed alongside the app.
 *
 * The stub has no federated credential, and authenticates clients by a secret
 * it has registered for them instead.
 */
const createAuthProvider = () => {
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
 * Drives the OIDC handshake with Entra ID, decorating requests with `login`,
 * `callback` and `ensureValidToken`. It registers no auth strategy of its own,
 * so route protection lives in ./session-scheme.ts
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
