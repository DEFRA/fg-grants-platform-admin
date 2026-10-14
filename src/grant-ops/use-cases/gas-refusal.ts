export interface GasRefusal {
  statusCode: number
  message: string
  errorCode?: string
  /** The full response body GAS answered with, for callers that need more than message/errorCode. */
  body: unknown
}

export interface ConflictRefusal {
  kind: 'refusal'
  message: string
}

interface GasPayload {
  message?: string
  errorCode?: string
  [key: string]: unknown
}

interface GasError {
  output?: { statusCode?: number; payload?: GasPayload }
  data?: { payload?: GasPayload }
}

export const conflict = 409
const serviceUnavailable = 503

const gasErrorCodes = {
  CASEWORKING_ROLES_UNAVAILABLE: 'CASEWORKING_ROLES_UNAVAILABLE',
  CONFIGURATION_CHANGED: 'CONFIGURATION_CHANGED',
  ENTITLEMENT_CLAIMED: 'ENTITLEMENT_CLAIMED'
} as const

const refusedMessage = 'The backend refused the request.'

const asGasError = (error: unknown) => (error ?? {}) as GasError

const isRefusal = (statusCode?: number): statusCode is number =>
  statusCode != null && statusCode >= 400 && statusCode <= 499

const readBodyPayload = ({ data }: GasError): GasPayload => data?.payload ?? {}

const readBoomPayload = ({ output }: GasError): GasPayload =>
  output?.payload ?? {}

const readMessage = (error: GasError) =>
  readBodyPayload(error).message ??
  readBoomPayload(error).message ??
  refusedMessage

const readErrorCode = (error: GasError) =>
  readBodyPayload(error).errorCode ?? readBoomPayload(error).errorCode

/** The body payload if the transport carried one, falling back to Boom's own - whichever actually has content. */
const readBody = (error: GasError): unknown => {
  const bodyPayload = readBodyPayload(error)
  return Object.keys(bodyPayload).length > 0
    ? bodyPayload
    : readBoomPayload(error)
}

/** A 4xx from fg-gas-backend, read off the error `@hapi/wreck` throws for it; anything else is not a refusal. */
export const toGasRefusal = (error: unknown): GasRefusal | undefined => {
  const gasError = asGasError(error)
  const statusCode = gasError.output?.statusCode

  return isRefusal(statusCode)
    ? {
        statusCode,
        message: readMessage(gasError),
        errorCode: readErrorCode(gasError),
        body: readBody(gasError)
      }
    : undefined
}

/** A conflict for the page to explain; any other failure is thrown on. */
export const toConflictRefusal = (error: unknown): ConflictRefusal => {
  const refusal = toGasRefusal(error)

  if (refusal?.statusCode !== conflict) {
    throw error
  }

  return { kind: 'refusal', message: refusal.message }
}

/** The grant's configuration moved under the save: the same values may go through once the page has caught up. */
export const isConfigurationChange = (refusal: GasRefusal) =>
  refusal.errorCode === gasErrorCodes.CONFIGURATION_CHANGED

/** GAS could not determine the operator's Caseworking roles: a 503 rather than a refusal, but one a page can explain. */
export const isCaseworkingRolesUnavailable = (error: unknown) => {
  const gasError = asGasError(error)

  return (
    gasError.output?.statusCode === serviceUnavailable &&
    readErrorCode(gasError) === gasErrorCodes.CASEWORKING_ROLES_UNAVAILABLE
  )
}
