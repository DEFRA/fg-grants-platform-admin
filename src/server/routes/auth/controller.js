import {
  clearAuthSession,
  setAuthSession,
  takeRedirectTo
} from '#/server/auth/session.js'

/**
 * Hands the user to Entra ID. The plugin builds the authorize url, stashes the
 * PKCE verifier in its own cookie and takes over the response.
 */
export const loginController = {
  options: {
    auth: false
  },
  handler(request, h) {
    return request.login(h)
  }
}

/**
 * Where Entra ID returns the user. The plugin validates state, nonce and the
 * PKCE verifier before swapping the code for tokens, so a request that reaches
 * the body of this handler has been through those checks.
 *
 * Both methods are accepted because the response mode follows the cookie
 * security setting: `form_post` over HTTPS, a `query` redirect over plain HTTP.
 */
export const loginCallbackController = {
  options: {
    auth: false
  },
  async handler(request, h) {
    const credentials = await request.callback(h)

    setAuthSession(request, credentials)

    return h.redirect(takeRedirectTo(request, h))
  }
}

/**
 * Drops the local session. The Entra ID session is left alone, so a user who
 * logs back in is signed straight in again without re-entering credentials.
 */
export const logoutController = {
  options: {
    auth: false
  },
  handler(request, h) {
    clearAuthSession(request)

    return h.redirect('/')
  }
}
