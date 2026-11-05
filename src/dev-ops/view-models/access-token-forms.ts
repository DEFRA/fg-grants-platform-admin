import type { KeepOld } from '../use-cases/access-tokens.use-case.ts'
import {
  dayMs,
  toExpiryDay,
  toUkDate,
  toUkEndOfDay
} from './access-token-dates.ts'

export type DialogKind = 'new' | 'rotate' | 'expiry' | 'revoke' | 'delete'

/**
 * A dialog a POST answers with, open again: what was typed, and what was
 * wrong with it, by field. The raw token is never part of it.
 */
export interface OpenDialog {
  kind: DialogKind
  /** Null for New token, which belongs to no token yet. */
  tokenId: string | null
  values: Record<string, string>
  errors: Record<string, string>
}

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> }

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })

const refused = <T>(field: string, message: string): Parsed<T> => ({
  ok: false,
  errors: { [field]: message }
})

export const expiryChoices = [
  { value: 'never', label: 'Never' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'custom', label: 'Custom date' }
] as const

export type ExpiryChoice = (typeof expiryChoices)[number]['value']

export const expiryChoiceValues = expiryChoices.map(({ value }) => value)

export const defaultExpiry: ExpiryChoice = '90'

export interface ExpiryInput {
  expiry: ExpiryChoice
  /** `yyyy-mm-dd`, read only for a custom expiry. */
  date: string
  /** The expiry the token has now: a custom date left on its day keeps it to the second. */
  current?: string
}

const presetDays: Record<string, number> = { 30: 30, 90: 90, 365: 365 }

const datePattern = /^\d{4}-\d{2}-\d{2}$/

const isRealDate = (date: string): boolean => {
  const midnight = new Date(`${date}T00:00:00.000Z`)

  return (
    datePattern.test(date) &&
    !Number.isNaN(midnight.getTime()) &&
    midnight.toISOString().startsWith(date)
  )
}

/** The end of that day in the UK, or null for anything that is not a real date. */
const toEndOfDay = (date: string): Date | null =>
  isRealDate(date) ? toUkEndOfDay(date) : null

/**
 * A date left on the day the token already expires keeps its exact instant,
 * which must still be ahead: an untouched date never brings a stopped token
 * back.
 */
const isCurrentDay = (date: string, current: string): boolean =>
  current !== '' && toUkDate(new Date(current)) === date

const keepCurrent = (current: string, now: Date): Parsed<string> =>
  new Date(current) > now
    ? ok(current)
    : refused('expiry', 'Pick a date in the future.')

const parseNewDate = (date: string, now: Date): Parsed<string> => {
  const end = toEndOfDay(date)

  if (end === null) {
    return refused('expiry', 'Pick a date.')
  }

  return end > now
    ? ok(end.toISOString())
    : refused('expiry', 'Pick a date in the future.')
}

const parseCustomDate = (
  date: string,
  now: Date,
  current = ''
): Parsed<string> =>
  isCurrentDay(date, current)
    ? keepCurrent(current, now)
    : parseNewDate(date, now)

/** The end of the day that many days from now, in the UK. */
const toPresetEnd = (days: number, now: Date): Date =>
  toUkEndOfDay(toUkDate(new Date(now.getTime() + days * dayMs)))

/** Null is never. A preset's day counts from today; it and a custom date end at 23:59:59 UK time. */
export const parseExpiry = (
  { expiry, date, current }: ExpiryInput,
  now: Date
): Parsed<string | null> => {
  if (expiry === 'never') {
    return ok(null)
  }

  return expiry === 'custom'
    ? parseCustomDate(date, now, current)
    : ok(toPresetEnd(presetDays[expiry], now).toISOString())
}

/** The line under the picker: the date the choice comes to, or what is wrong with it. */
export const toExpirySummary = (input: ExpiryInput, now: Date): string => {
  const parsed = parseExpiry(input, now)

  if (!parsed.ok) {
    return parsed.errors.expiry
  }

  if (parsed.value === null) {
    return 'Never expires.'
  }

  return `Expires ${toExpiryDay(new Date(parsed.value))}.`
}

export interface ExpiryPicker {
  id: string
  choices: { value: string; label: string; checked: boolean }[]
  date: string
  /** Today: a custom date ends at the close of its day, so today is still ahead. */
  min: string
  summary: string
  error: string | null
  /** The expiry the token has now, kept to the second if its day is left alone. */
  current: string
  /** Where the picker goes back to each time its dialog is opened afresh. */
  resetTo: string
  resetDate: string
}

/** An error the server sent stands in for the summary. */
const toSummaryAndError = (
  input: ExpiryInput,
  error: string | undefined,
  now: Date
) => ({
  summary: error ?? toExpirySummary(input, now),
  error: error ?? null
})

export const toExpiryPicker = (
  id: string,
  input: ExpiryInput,
  error: string | undefined,
  now: Date,
  reset: ExpiryInput = input
): ExpiryPicker => ({
  id,
  choices: expiryChoices.map((choice) => ({
    ...choice,
    checked: choice.value === input.expiry
  })),
  date: input.date,
  min: toUkDate(now),
  ...toSummaryAndError(input, error, now),
  current: input.current ?? '',
  resetTo: reset.expiry,
  resetDate: reset.date
})

export const clientIdMax = 64

/** The services' name rule, which the routes' paths check too. */
export const clientNamePattern = /^[a-z0-9-]{1,64}$/

export const parseClientId = (value: string): Parsed<string> => {
  const clientId = value.trim()

  if (clientId === '') {
    return refused('clientId', 'Enter a client ID.')
  }

  if (clientId.length > clientIdMax) {
    return refused('clientId', `Use ${clientIdMax} characters or fewer.`)
  }

  return clientNamePattern.test(clientId)
    ? ok(clientId)
    : refused('clientId', 'Use lowercase letters, digits and hyphens only.')
}

export interface NewTokenInput extends ExpiryInput {
  clientId: string
}

const errorsOf = <T>(parsed: Parsed<T>): Record<string, string> =>
  parsed.ok ? {} : parsed.errors

/** Both fields are checked, so one submit shows every mistake. */
export const parseNewToken = (
  input: NewTokenInput,
  now: Date
): Parsed<{ clientId: string; expiresAt: string | null }> => {
  const clientId = parseClientId(input.clientId)
  const expiresAt = parseExpiry(input, now)

  return clientId.ok && expiresAt.ok
    ? ok({ clientId: clientId.value, expiresAt: expiresAt.value })
    : { ok: false, errors: { ...errorsOf(clientId), ...errorsOf(expiresAt) } }
}

/**
 * The refusals of a new token that a different answer in the dialog can
 * fix. The client ones come from a race: the page's list was read before
 * someone else created or emptied the client.
 */
const issueFieldErrors: Record<string, Record<string, string>> = {
  API_CLIENT_INVALID_NAME: {
    clientId: 'Use lowercase letters, digits and hyphens only.'
  },
  API_CLIENT_EXISTS: {
    clientId:
      'Someone has just created this client. Create again to add a token to it.'
  },
  API_CLIENT_NOT_FOUND: {
    clientId:
      'This client has just lost its last token. Create again to make it afresh.'
  },
  API_TOKEN_INVALID_EXPIRY: { expiry: 'Pick a date in the future.' }
}

export const toIssueFieldErrors = (
  errorCode: string | null
): Record<string, string> | null => issueFieldErrors[errorCode ?? ''] ?? null

export const toExpiryFieldErrors = (
  errorCode: string | null
): Record<string, string> | null =>
  errorCode === 'API_TOKEN_INVALID_EXPIRY'
    ? issueFieldErrors.API_TOKEN_INVALID_EXPIRY
    : null

/** Typed exactly, but for the spaces a paste brings along. */
export const confirmsRevoke = (typed: string, clientId: string): boolean =>
  typed.trim() === clientId

export const revokeMismatch = "That doesn't match."

export const keepOldChoices: {
  value: KeepOld
  label: string
  hint: string
}[] = [
  {
    value: 'none',
    label: 'Expire immediately',
    hint: 'The caller fails until it has the new token.'
  },
  {
    value: '24h',
    label: 'Keep valid until end of tomorrow',
    hint: 'Enough for a same-day redeploy of the caller.'
  },
  {
    value: '7d',
    label: 'Keep valid for 7 days, to end of day',
    hint: 'For callers released on a slower cycle.'
  }
]

export const defaultKeepOld: KeepOld = '24h'

/** Why the token a request is made with can't be ended at once. */
export const inUseKeepOldReason =
  'Not for the token in use: its caller would be locked out until it has the new token.'

/**
 * The token a request is made with can't be ended at once, so that choice is
 * offered disabled, with the reason. A refused rotation comes back on the
 * choice it was sent with, unless that is the disabled one.
 */
export const toKeepOldChoices = (
  inUse: boolean,
  sent: KeepOld = defaultKeepOld
) => {
  const chosen = inUse && sent === 'none' ? defaultKeepOld : sent

  return keepOldChoices.map((choice) => ({
    ...choice,
    checked: choice.value === chosen,
    resetChecked: choice.value === defaultKeepOld,
    disabled: inUse && choice.value === 'none'
  }))
}
