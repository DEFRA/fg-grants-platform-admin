import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute
} from '@hapi/hapi'
import Joi from 'joi'

import type {
  ApiToken,
  ClientService,
  IssueResult,
  KeepOld,
  TokenFailure,
  TokenKey
} from '../use-cases/access-tokens.use-case.ts'
import {
  changeTokenExpiryUseCase,
  deleteAccessTokenUseCase,
  issueAccessTokenUseCase,
  listAccessTokensUseCase,
  revokeAccessTokenUseCase,
  rotateAccessTokenUseCase
} from '../use-cases/access-tokens.use-case.ts'
import type {
  DialogKind,
  ExpiryInput,
  NewTokenInput,
  OpenDialog
} from '../view-models/access-token-forms.ts'
import {
  clientNamePattern,
  confirmsRevoke,
  expiryChoiceValues,
  parseExpiry,
  parseNewToken,
  revokeMismatch,
  toExpiryFieldErrors,
  toIssueFieldErrors
} from '../view-models/access-token-forms.ts'
import {
  clientServices,
  toClientsPath
} from '../view-models/access-token-services.ts'
import type {
  NoticeAction,
  TokenNotice
} from '../view-models/access-token-toasts.ts'
import {
  accessTokenNoticeKey,
  toFailureOutcome,
  toRefusalMessage
} from '../view-models/access-token-toasts.ts'
import type { Reveal } from '../view-models/access-tokens-page.view-model.ts'
import {
  accessTokensPageCache,
  toAccessTokensPage
} from '../view-models/access-tokens-page.view-model.ts'
import { seeOther } from '../view-models/see-other.ts'

const badRequest = 400

const service = Joi.string()
  .valid(...clientServices)
  .required()

const serviceParams = Joi.object({ service })

const tokenParams = Joi.object({
  service,
  clientId: Joi.string().pattern(clientNamePattern).required(),
  tokenId: Joi.string().hex().length(24).required()
})

/** Read only for the words of a toast, never for the write itself. */
const hint = Joi.string()
  .pattern(/^[A-Za-z0-9_-]{4}$/)
  .allow('')
  .default('')

const expiryFields = {
  expiry: Joi.string()
    .valid(...expiryChoiceValues)
    .required(),
  date: Joi.string().allow('').max(10).default('')
}

/**
 * Every page this answers carries no-store: a reveal holds a live token, and
 * an error is rendered beside a list that may have changed since.
 */
const view = (
  h: ResponseToolkit,
  page: ReturnType<typeof toAccessTokensPage>,
  code = 200
): ResponseObject =>
  h.view('access-tokens', page).code(code).header('cache-control', 'no-store')

interface PageExtras {
  dialog?: OpenDialog
  reveal?: Reveal
}

const renderPage = async (
  h: ResponseToolkit,
  serviceName: ClientService,
  extras: PageExtras,
  code?: number
): Promise<ResponseObject> =>
  view(
    h,
    toAccessTokensPage({
      service: serviceName,
      tokens: await listAccessTokensUseCase(serviceName),
      now: new Date(),
      ...extras
    }),
    code
  )

/** The same page, with the dialog open again on what was wrong. */
const reopen = (
  h: ResponseToolkit,
  serviceName: ClientService,
  dialog: OpenDialog
) => renderPage(h, serviceName, { dialog }, badRequest)

/** Only the latest write's: a reveal left without Done never spends its own. */
const putNotice = (request: Request, notice: TokenNotice) => {
  request.yar.flash(accessTokenNoticeKey)
  request.yar.flash(accessTokenNoticeKey, notice)
}

/**
 * The page the write came from, and nothing about the outcome in the url:
 * the outcome rides the session instead, spent on one render.
 */
const backTo = (request: Request, h: ResponseToolkit, notice: TokenNotice) => {
  putNotice(request, notice)

  return h.redirect(toClientsPath(notice.service)).code(seeOther)
}

interface NoticeContext {
  action: NoticeAction
  key: TokenKey
  hint: string
}

const failureNotice = (
  { action, key, hint: shown }: NoticeContext,
  failure: TokenFailure
): TokenNotice => ({
  service: key.service,
  action,
  ...toFailureOutcome(failure),
  tokenId: key.tokenId,
  clientId: key.clientId,
  hint: shown || null,
  expiresAt: null
})

const dialogKinds: Record<NoticeAction, DialogKind> = {
  issue: 'new',
  rotate: 'rotate',
  expiry: 'expiry',
  revoke: 'revoke',
  delete: 'delete'
}

/**
 * A refusal the operator can act on opens the dialog again, saying why;
 * anything else goes back to the page as a toast.
 */
const afterFailure = (
  request: Request,
  h: ResponseToolkit,
  context: NoticeContext,
  failure: TokenFailure,
  values: Record<string, string> = {}
) => {
  const notice = failureNotice(context, failure)

  return notice.outcome === 'refused'
    ? reopen(h, context.key.service, {
        kind: dialogKinds[context.action],
        tokenId: context.action === 'issue' ? null : context.key.tokenId,
        values,
        errors: { form: toRefusalMessage(notice) }
      })
    : backTo(request, h, notice)
}

/**
 * The response to the POST that issued a token is the one place its value
 * appears. The page Done leads to says the token is live, from a notice that
 * names the client only.
 */
const toReveal = (
  request: Request,
  h: ResponseToolkit,
  action: 'issue' | 'rotate',
  key: Pick<TokenKey, 'service' | 'clientId'>,
  result: Extract<IssueResult, { outcome: 'issued' }>
) => {
  const clientId = result.token.clientId ?? key.clientId
  const tokenHint = result.token.tokenHint ?? result.raw.slice(-4)

  putNotice(request, {
    service: key.service,
    action,
    outcome: 'done',
    errorCode: null,
    tokenId: result.token.tokenId,
    clientId,
    hint: tokenHint,
    expiresAt: null
  })

  return renderPage(h, key.service, {
    reveal: { clientId, raw: result.raw, hint: tokenHint }
  })
}

const tokenKeyOf = (request: Request): TokenKey =>
  request.params as unknown as TokenKey

export const viewAccessTokensRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/clients/{service}',
  options: {
    cache: accessTokensPageCache,
    validate: { params: serviceParams }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { service: shown } = request.params as { service: ClientService }
    // Read before the list, so the message is spent whatever the read says.
    const [notice] = request.yar.flash(accessTokenNoticeKey)

    return h.view(
      'access-tokens',
      toAccessTokensPage({
        service: shown,
        tokens: await listAccessTokensUseCase(shown),
        now: new Date(),
        notice
      })
    )
  }
}

const afterIssueFailure = (
  request: Request,
  h: ResponseToolkit,
  values: NewTokenInput,
  failure: TokenFailure
) => {
  const { service: shown } = request.params as { service: ClientService }
  const errors =
    failure.outcome === 'refused' ? toIssueFieldErrors(failure.errorCode) : null

  return errors
    ? reopen(h, shown, {
        kind: 'new',
        tokenId: null,
        values: { ...values },
        errors
      })
    : afterFailure(
        request,
        h,
        {
          action: 'issue',
          key: {
            service: shown,
            clientId: values.clientId.trim(),
            tokenId: ''
          },
          hint: ''
        },
        failure,
        { ...values }
      )
}

/** Creates the client too when no token has its name yet. */
export const issueAccessTokenRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/tokens',
  options: {
    validate: {
      params: serviceParams,
      payload: Joi.object({
        clientId: Joi.string().allow('').max(200).required(),
        ...expiryFields
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { service: shown } = request.params as { service: ClientService }
    const values = request.payload as NewTokenInput
    const parsed = parseNewToken(values, new Date())

    if (!parsed.ok) {
      return reopen(h, shown, {
        kind: 'new',
        tokenId: null,
        values: { ...values },
        errors: parsed.errors
      })
    }

    const { clientId, expiresAt } = parsed.value
    const result = await issueAccessTokenUseCase(shown, clientId, expiresAt)

    return result.outcome === 'issued'
      ? toReveal(request, h, 'issue', { service: shown, clientId }, result)
      : afterIssueFailure(request, h, values, result)
  }
}

export const rotateAccessTokenRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/rotate',
  options: {
    validate: {
      params: tokenParams,
      payload: Joi.object({
        keepOld: Joi.string().valid('none', '24h', '7d').required()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = tokenKeyOf(request)
    const { keepOld } = request.payload as { keepOld: KeepOld }
    const result = await rotateAccessTokenUseCase(key, keepOld)

    return result.outcome === 'issued'
      ? toReveal(request, h, 'rotate', key, result)
      : afterFailure(request, h, { action: 'rotate', key, hint: '' }, result, {
          keepOld
        })
  }
}

interface ExpiryPayload extends ExpiryInput {
  hint: string
}

const reopenExpiry = (
  h: ResponseToolkit,
  key: TokenKey,
  { expiry, date }: ExpiryPayload,
  errors: Record<string, string>
) =>
  reopen(h, key.service, {
    kind: 'expiry',
    tokenId: key.tokenId,
    values: { expiry, date },
    errors
  })

const expiryNotice = (key: TokenKey, token: ApiToken): TokenNotice => ({
  service: key.service,
  action: 'expiry',
  outcome: 'done',
  errorCode: null,
  tokenId: key.tokenId,
  clientId: key.clientId,
  hint: token.tokenHint,
  expiresAt: token.expiresAt
})

const afterExpiryFailure = (
  request: Request,
  h: ResponseToolkit,
  payload: ExpiryPayload,
  failure: TokenFailure
) => {
  const key = tokenKeyOf(request)
  const errors =
    failure.outcome === 'refused'
      ? toExpiryFieldErrors(failure.errorCode)
      : null

  return errors
    ? reopenExpiry(h, key, payload, errors)
    : afterFailure(
        request,
        h,
        { action: 'expiry', key, hint: payload.hint },
        failure,
        { expiry: payload.expiry, date: payload.date }
      )
}

export const changeTokenExpiryRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/expiry',
  options: {
    validate: {
      params: tokenParams,
      payload: Joi.object({
        ...expiryFields,
        hint,
        current: Joi.string().isoDate().allow('').default('')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = tokenKeyOf(request)
    const payload = request.payload as ExpiryPayload
    const parsed = parseExpiry(payload, new Date())

    if (!parsed.ok) {
      return reopenExpiry(h, key, payload, parsed.errors)
    }

    const result = await changeTokenExpiryUseCase(key, parsed.value)

    return result.outcome === 'done'
      ? backTo(request, h, expiryNotice(key, result.token))
      : afterExpiryFailure(request, h, payload, result)
  }
}

const doneNotice = ({
  action,
  key,
  hint: shown
}: NoticeContext): TokenNotice => ({
  service: key.service,
  action,
  outcome: 'done',
  errorCode: null,
  tokenId: key.tokenId,
  clientId: key.clientId,
  hint: shown || null,
  expiresAt: null
})

export const revokeAccessTokenRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/revoke',
  options: {
    validate: {
      params: tokenParams,
      payload: Joi.object({
        confirm: Joi.string().allow('').max(200).default(''),
        hint
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = tokenKeyOf(request)
    const { confirm, hint: shown } = request.payload as {
      confirm: string
      hint: string
    }

    if (!confirmsRevoke(confirm, key.clientId)) {
      return reopen(h, key.service, {
        kind: 'revoke',
        tokenId: key.tokenId,
        values: { confirm },
        errors: { confirm: revokeMismatch }
      })
    }

    const result = await revokeAccessTokenUseCase(key)
    const context: NoticeContext = { action: 'revoke', key, hint: shown }

    return result.outcome === 'done'
      ? backTo(request, h, doneNotice(context))
      : afterFailure(request, h, context, result)
  }
}

/** A POST, as a form can't send a DELETE; it becomes one on the way to GAS. */
export const deleteAccessTokenRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/delete',
  options: {
    validate: {
      params: tokenParams,
      payload: Joi.object({ hint })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = tokenKeyOf(request)
    const { hint: shown } = request.payload as { hint: string }
    const result = await deleteAccessTokenUseCase(key)
    const context: NoticeContext = { action: 'delete', key, hint: shown }

    return result.outcome === 'done'
      ? backTo(request, h, doneNotice(context))
      : afterFailure(request, h, context, result)
  }
}

export const accessTokenWriteRoutes = [
  issueAccessTokenRoute,
  rotateAccessTokenRoute,
  changeTokenExpiryRoute,
  revokeAccessTokenRoute,
  deleteAccessTokenRoute
]
