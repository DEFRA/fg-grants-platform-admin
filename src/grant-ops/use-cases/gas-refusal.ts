export interface AllowListIdentifierProblems {
  invalid: string[]
  duplicate: string[]
}

export interface AllowListValidationDetails {
  sbi: AllowListIdentifierProblems
  crn: AllowListIdentifierProblems
}

export interface GasRefusal {
  statusCode: number
  message: string
  errorCode?: string
  details?: AllowListValidationDetails
}

export interface ConflictRefusal {
  kind: 'refusal'
  message: string
}

interface GasPayload {
  message?: string
  errorCode?: string
  details?: AllowListValidationDetails
}

interface GasError {
  output?: { statusCode?: number; payload?: GasPayload }
  data?: { payload?: GasPayload }
}

export const conflict = 409

export const gasErrorCodes = {
  CONFIGURATION_CHANGED: 'CONFIGURATION_CHANGED',
  ENTITLEMENT_CLAIMED: 'ENTITLEMENT_CLAIMED',
  ALLOW_LIST_VALIDATION_FAILED: 'ALLOW_LIST_VALIDATION_FAILED'
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

const readDetails = (error: GasError) =>
  readBodyPayload(error).details ?? readBoomPayload(error).details

/** A 4xx from fg-gas-backend, read off the error `@hapi/wreck` throws for it; anything else is not a refusal. */
export const toGasRefusal = (error: unknown): GasRefusal | undefined => {
  const gasError = asGasError(error)
  const statusCode = gasError.output?.statusCode

  return isRefusal(statusCode)
    ? {
        statusCode,
        message: readMessage(gasError),
        errorCode: readErrorCode(gasError),
        details: readDetails(gasError)
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

/** GAS refused specific SBI/CRN entries; `details` says which ones and why. */
export const isAllowListValidationFailure = (
  refusal: GasRefusal
): refusal is GasRefusal & { details: AllowListValidationDetails } =>
  refusal.errorCode === gasErrorCodes.ALLOW_LIST_VALIDATION_FAILED &&
  refusal.details !== undefined
