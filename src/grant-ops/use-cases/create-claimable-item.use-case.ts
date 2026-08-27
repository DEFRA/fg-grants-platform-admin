import type {
  EntitlementFieldValue,
  EntitlementTemplate,
  EntitlementTemplateField
} from '../repositories/claims.repository.ts'
import { createEntitlement } from '../repositories/claims.repository.ts'

export interface CreateRefusal {
  statusCode: number
  errorCode?: string
  message: string
}

interface GasError {
  isBoom?: boolean
  output?: { statusCode?: number }
  data?: { payload?: { errorCode?: string; message?: string } }
}

const toValue = (field: EntitlementTemplateField, raw: string) =>
  field.unitType === 'decimal' || field.unitType === 'integer'
    ? Number(raw)
    : raw

const toEntitlementData = (
  template: EntitlementTemplate,
  form: Record<string, string>
): Record<string, EntitlementFieldValue> =>
  Object.fromEntries(
    Object.entries(template.fields ?? {})
      .filter(([, field]) => field.input)
      .map(([key, field]) => [
        key,
        { value: toValue(field, (form[key] ?? '').trim()) }
      ])
  )

const refusedMessage = 'The backend refused the request.'

const isRefusal = (statusCode?: number) =>
  statusCode != null && statusCode >= 400 && statusCode <= 499

const statusOf = (error: unknown) =>
  ((error ?? {}) as GasError).output?.statusCode

const payloadOf = (error: unknown) => (error as GasError).data?.payload

const asRefusal = (error: unknown): CreateRefusal | undefined => {
  const statusCode = statusOf(error)

  if (!isRefusal(statusCode)) {
    return undefined
  }

  const payload = payloadOf(error) ?? {}

  return {
    statusCode: statusCode as number,
    errorCode: payload.errorCode,
    message: payload.message ?? refusedMessage
  }
}

export const createClaimableItemUseCase = async (
  code: string,
  clientRef: string,
  template: EntitlementTemplate,
  form: Record<string, string>
): Promise<CreateRefusal | undefined> => {
  try {
    await createEntitlement({
      clientRef,
      grantCode: code,
      claimCode: template.claimCode,
      data: toEntitlementData(template, form)
    })

    return undefined
  } catch (error) {
    const refusal = asRefusal(error)

    if (!refusal) {
      throw error
    }

    return refusal
  }
}
