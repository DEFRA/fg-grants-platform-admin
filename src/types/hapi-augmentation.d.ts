/**
 * Augments @hapi/hapi's own types with the request/server decorations and
 * plugin state added by this app's plugins. The top-level import is required
 * so this file is treated as a module augmenting hapi's real types, rather
 * than a fresh (and conflicting) ambient declaration of the module.
 */
import type { ResponseObject, ResponseToolkit } from '@hapi/hapi'

declare module '@hapi/hapi' {
  interface Request {
    login(h: ResponseToolkit): Promise<ResponseObject>
    callback(
      h: ResponseToolkit
    ): Promise<import('@defra/hapi-auth-oidc').OidcCredentials>
    ensureValidToken(
      token: import('@defra/hapi-auth-oidc').OidcToken
    ): Promise<{
      token: import('@defra/hapi-auth-oidc').OidcToken
      refreshed: boolean
    }>
    getTraceId(): string | null
  }

  interface Server {
    getTraceId(): string | null
  }

  interface PluginProperties {
    'hapi-auth-oidc': {
      oidc: {
        login(request: Request, h: ResponseToolkit): Promise<unknown>
        callback(
          request: Request,
          h: ResponseToolkit
        ): Promise<import('@defra/hapi-auth-oidc').OidcCredentials>
        ensureValidToken(
          request: Request,
          token: import('@defra/hapi-auth-oidc').OidcToken
        ): Promise<{
          token: import('@defra/hapi-auth-oidc').OidcToken
          refreshed: boolean
        }>
      }
    }
  }

  interface ReqRefDefaults {
    AuthCredentialsExtra: {
      profile: {
        id?: string
        email?: string
        displayName?: string
      }
      scope: string[]
    }
  }
}
