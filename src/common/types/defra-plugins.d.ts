/**
 * Ambient declarations for dependencies that ship no types of their own, typed
 * only to the surface area this codebase uses.
 *
 * This file must stay a global script (no top-level import/export) for
 * `declare module` to register fresh ambient types. Augmenting @hapi/hapi's
 * already-typed module lives in hapi-augmentation.d.ts, which does need to be
 * a module.
 */

declare module '@defra/hapi-auth-oidc' {
  import type { Plugin } from '@hapi/hapi'

  export interface OidcToken {
    accessToken: string
    refreshToken: string
    idToken?: string
    claims?: Record<string, unknown>
    expiresIn?: number
  }

  export interface OidcCredentials extends OidcToken {}

  export interface OidcAuthProvider {
    type: string
    getCredentials(logger?: unknown): Promise<string>
  }

  export interface HapiAuthOidcPluginOptions {
    strategyName?: string
    oidc: {
      clientId: string
      discoveryUri: string
      useHttp?: boolean
      authProvider: OidcAuthProvider
      loginCallbackUri: string
      externalBaseUrl: string
      scope?: string
      responseMode?: string
      defaultPostLoginUri?: string
      enableRefreshDecoration?: boolean
      earlyRefreshMs?: number
    }
    cookie?: string
    cookieOptions: Record<string, unknown>
  }

  export const hapiAuthOidcPlugin: Plugin<HapiAuthOidcPluginOptions>

  export class MockProvider implements OidcAuthProvider {
    type: string
    constructor(options: { token?: string; type?: string })
    getCredentials(logger?: unknown): Promise<string>
  }

  export class WebIdentityTokenProvider implements OidcAuthProvider {
    type: string
    constructor(options: {
      audience: string | string[]
      signingAlgorithm?: string
      stsClient?: unknown
      durationSeconds?: number
      earlyRefreshMs?: number
    })
    getCredentials(logger?: unknown): Promise<string>
  }

  export function ensureValidToken(
    token: OidcToken,
    getOidcConfig: (logger?: unknown) => Promise<unknown>,
    earlyRefreshMs?: number,
    scope?: string,
    logger?: unknown
  ): Promise<{ token: OidcToken; refreshed: boolean }>
}

declare module '@defra/hapi-secure-context' {
  import type { Plugin } from '@hapi/hapi'

  export const secureContext: { plugin: Plugin<void> }
}

declare module '@defra/hapi-tracing' {
  import type { Plugin } from '@hapi/hapi'

  export const tracing: { plugin: Plugin<{ tracingHeader: string }> }
  export function getTraceId(): string | null
}

declare module '@defra/cdp-metrics' {
  import type { Plugin } from '@hapi/hapi'

  export const metrics: { plugin: Plugin<void> }
}

declare module '@defra/hapi-connect' {
  import type { Plugin } from '@hapi/hapi'
  import type { IncomingMessage, ServerResponse } from 'node:http'

  export type ConnectMiddleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void
  ) => void

  interface HapiConnectOptions {
    path: string
    middleware: ConnectMiddleware[]
  }

  const hapiConnect: Plugin<HapiConnectOptions>
  export default hapiConnect
}

declare module 'blankie' {
  import type { Plugin } from '@hapi/hapi'

  const Blankie: { plugin: Plugin<Record<string, unknown>> }
  export default Blankie
}

declare module 'govuk-frontend' {
  export function createAll(
    Component: new (...args: unknown[]) => unknown,
    config?: unknown,
    scope?: unknown
  ): unknown[]

  export class Button {}
  export class Checkboxes {}
  export class ErrorSummary {}
  export class Radios {}
  export class SkipLink {}
}
