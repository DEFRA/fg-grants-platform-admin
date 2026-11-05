import type {
  ApiToken,
  ClientService,
  KeepOld,
  ListedToken
} from '../use-cases/access-tokens.use-case.ts'
import { toExpiryDay, toUkDate } from './access-token-dates.ts'
import type {
  DialogKind,
  ExpiryInput,
  OpenDialog
} from './access-token-forms.ts'
import {
  defaultExpiry,
  toExpiryPicker,
  inUseKeepOldReason,
  toKeepOldChoices
} from './access-token-forms.ts'
import { toTokenRows } from './access-token-rows.ts'
import {
  serviceWords,
  toClientsPath,
  toNavActive
} from './access-token-services.ts'
import type { Toast, TokenNotice } from './access-token-toasts.ts'
import { toToast } from './access-token-toasts.ts'

/** The page a token is never cached on, as it may carry one being revealed. */
export const accessTokensPageCache = { otherwise: 'no-store' }

/** A token just issued, shown once in the response to the POST that made it. */
export interface Reveal {
  clientId: string
  raw: string
  hint: string
}

export interface AccessTokensPageInput {
  service: ClientService
  /** Null when the list could not be read. */
  tokens: ListedToken[] | null
  now: Date
  dialog?: OpenDialog | null
  reveal?: Reveal | null
  notice?: TokenNotice
}

const isOpen = (
  dialog: OpenDialog | null | undefined,
  kind: DialogKind,
  tokenId: string | null
): dialog is OpenDialog => dialog?.kind === kind && dialog.tokenId === tokenId

interface DialogState {
  open: boolean
  values: Record<string, string>
  errors: Record<string, string>
}

const closed: DialogState = { open: false, values: {}, errors: {} }

/** What one dialog comes back with: only the dialog the POST was for opens, with what was typed and what was wrong. */
const stateOf = (
  dialog: OpenDialog | null | undefined,
  kind: DialogKind,
  tokenId: string | null
): DialogState =>
  isOpen(dialog, kind, tokenId)
    ? { open: true, values: dialog.values, errors: dialog.errors }
    : closed

/** Open, and the refusal it came back with, if any, for the whole dialog rather than one field. */
const toOpenState = ({ open, errors }: DialogState) => ({
  open,
  formError: errors.form ?? null
})

/** The UK day of an instant, as the date box shows it. */
const toDateOnly = (instant: string): string => toUkDate(new Date(instant))

/** Where an expiry change starts: never, or the token's own date, kept to the second if left alone. */
const toCurrentExpiry = (token: ApiToken): ExpiryInput =>
  token.expiresAt === null
    ? { expiry: 'never', date: '' }
    : {
        expiry: 'custom',
        date: toDateOnly(token.expiresAt),
        current: token.expiresAt
      }

const toExpiryInput = (values: Record<string, string>): ExpiryInput => ({
  expiry: (values.expiry ?? defaultExpiry) as ExpiryInput['expiry'],
  date: values.date ?? ''
})

/** `Never`, or the date, as the Rotate and *Currently* lines say it. */
const toExpiryText = (expiresAt: string | null): string =>
  expiresAt === null ? 'Never' : toExpiryDay(new Date(expiresAt))

interface DialogContext {
  service: ClientService
  dialog: OpenDialog | null | undefined
  now: Date
}

interface TokenDialogContext extends DialogContext {
  token: ApiToken
  /** The dialog's id, less its suffix, and the token's address. */
  id: string
  action: string
}

const toRotateDialog = ({ token, dialog, id, action }: TokenDialogContext) => {
  const state = stateOf(dialog, 'rotate', token.tokenId)

  return {
    id: `${id}-rotate`,
    action: `${action}/rotate`,
    ...toOpenState(state),
    choices: toKeepOldChoices(
      token.inUse,
      state.values.keepOld as KeepOld | undefined
    ),
    lockedReason: inUseKeepOldReason,
    sameExpiry: toExpiryText(token.expiresAt)
  }
}

const toExpiryDialog = ({
  token,
  dialog,
  now,
  id,
  action
}: TokenDialogContext) => {
  const state = stateOf(dialog, 'expiry', token.tokenId)

  return {
    id: `${id}-expiry`,
    action: `${action}/expiry`,
    ...toOpenState(state),
    currently: toExpiryText(token.expiresAt),
    current: token.expiresAt ?? '',
    picker: toExpiryPicker(
      `${id}-expires`,
      state.open
        ? { ...toExpiryInput(state.values), current: token.expiresAt ?? '' }
        : toCurrentExpiry(token),
      state.errors.expiry,
      now,
      toCurrentExpiry(token)
    )
  }
}

const toRevokeDialog = ({ token, dialog, id, action }: TokenDialogContext) => {
  const state = stateOf(dialog, 'revoke', token.tokenId)
  const error = state.errors.confirm ?? null

  return {
    id: `${id}-revoke`,
    action: `${action}/revoke`,
    ...toOpenState(state),
    value: state.values.confirm ?? '',
    error
  }
}

const toDeleteDialog = ({ token, dialog, id, action }: TokenDialogContext) => ({
  id: `${id}-delete`,
  action: `${action}/delete`,
  ...toOpenState(stateOf(dialog, 'delete', token.tokenId))
})

const toTokenDialogs = (token: ApiToken, context: DialogContext) => {
  const tokenContext = {
    ...context,
    token,
    id: `token-${token.tokenId}`,
    action: `${toClientsPath(context.service)}/${token.clientId}/tokens/${token.tokenId}`
  }

  return {
    rotate: toRotateDialog(tokenContext),
    expiry: toExpiryDialog(tokenContext),
    revoke: toRevokeDialog(tokenContext),
    delete: toDeleteDialog(tokenContext)
  }
}

/** How many working tokens each client has, for the New token dialog to warn with. */
const toActiveCounts = (tokens: ApiToken[]): Record<string, number> => {
  const active = tokens.filter(
    (token) => token.status === 'ACTIVE' && token.clientId !== null
  )

  return Object.fromEntries(
    [...Map.groupBy(active, ({ clientId }) => clientId)].map(
      ([clientId, ofClient]) => [clientId, ofClient.length]
    )
  )
}

const toNewToken = (
  tokens: ApiToken[],
  { service, dialog, now }: DialogContext
) => {
  const { open, values, errors } = stateOf(dialog, 'new', null)

  return {
    id: 'token-new',
    action: `${toClientsPath(service)}/tokens`,
    open,
    formError: errors.form ?? null,
    clientId: values.clientId ?? '',
    clientError: errors.clientId ?? null,
    activeCounts: JSON.stringify(toActiveCounts(tokens)),
    picker: toExpiryPicker(
      'token-new-expires',
      toExpiryInput(values),
      errors.expiry,
      now,
      { expiry: defaultExpiry, date: '' }
    )
  }
}

const toRows = (tokens: ListedToken[], context: DialogContext) => {
  const byId = new Map(tokens.map((token) => [token.tokenId, token]))

  return toTokenRows(tokens, context.now).map((row) => ({
    ...row,
    dialogs: toTokenDialogs(byId.get(row.tokenId) as ApiToken, context)
  }))
}

const toList = (tokens: ListedToken[], context: DialogContext) => ({
  rows: toRows(tokens, context),
  newToken: toNewToken(tokens, context)
})

const toReveal = (reveal: Reveal | null | undefined) => reveal ?? null

/** The token whose drawer is open on arrival: the one a dialog came back for. */
const toOpenTokenId = (dialog: OpenDialog | null | undefined): string | null =>
  dialog?.tokenId ?? null

/** New token's dialog is always drawn; a token's only while the list still has it. */
const hasDialogFor = (tokens: ApiToken[] | null, tokenId: string | null) =>
  tokenId === null ||
  (tokens?.some((token) => token.tokenId === tokenId) ?? false)

/** A refusal for a token the fresh list no longer has: there is no dialog left to show it in. */
const toOrphanRefusal = (
  dialog: OpenDialog | null | undefined,
  tokens: ApiToken[] | null
): Toast | null => {
  const message = dialog?.errors.form

  return message && !hasDialogFor(tokens, dialog.tokenId)
    ? { role: 'error', parts: [{ text: message }] }
    : null
}

export const toAccessTokensPage = ({
  service,
  tokens,
  now,
  dialog,
  reveal,
  notice
}: AccessTokensPageInput) => {
  const words = serviceWords[service]
  const context = { service, dialog, now }

  return {
    pageTitle: `${words.short} access tokens`,
    service,
    words,
    navActive: toNavActive(service),
    path: toClientsPath(service),
    list: tokens === null ? null : toList(tokens, context),
    openTokenId: toOpenTokenId(dialog),
    reveal: toReveal(reveal),
    toast: toToast(notice, service) ?? toOrphanRefusal(dialog, tokens)
  }
}
