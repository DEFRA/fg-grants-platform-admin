export interface GasRefusal {
  statusCode: number
  message: string
}

interface GasError {
  output?: { statusCode?: number; payload?: { message?: string } }
  data?: { payload?: { message?: string } }
}

const refusedMessage = 'The backend refused the request.'

const asGasError = (error: unknown) => (error ?? {}) as GasError

const isRefusal = (statusCode?: number): statusCode is number =>
  statusCode != null && statusCode >= 400 && statusCode <= 499

const readBodyMessage = ({ data }: GasError) => data?.payload?.message

const readBoomMessage = ({ output }: GasError) => output?.payload?.message

const readMessage = (error: GasError) =>
  readBodyMessage(error) ?? readBoomMessage(error) ?? refusedMessage

/** A 4xx from fg-gas-backend, read off the error `@hapi/wreck` throws for it; anything else is not a refusal. */
export const toGasRefusal = (error: unknown): GasRefusal | undefined => {
  const gasError = asGasError(error)
  const statusCode = gasError.output?.statusCode

  return isRefusal(statusCode)
    ? { statusCode, message: readMessage(gasError) }
    : undefined
}

export const conflict = 409
