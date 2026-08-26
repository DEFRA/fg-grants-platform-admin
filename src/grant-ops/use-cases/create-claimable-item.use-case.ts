import Boom from '@hapi/boom'

import { getClaimsUseCase } from './get-claims.use-case.ts'
import { findItemByCode } from './view-new-claimable-item.use-case.ts'
import type {
  EntitlementFieldValue,
  EntitlementTemplate,
  EntitlementTemplateField
} from '../repositories/claims.repository.ts'
import { createEntitlement } from '../repositories/claims.repository.ts'

const toValue = (field: EntitlementTemplateField, raw: string) =>
  field.unitType === 'decimal' ? Number(raw) : raw

// The template names the fields a case officer supplies; anything else posted
// with the form is dropped rather than sent on.
const toEntitlementData = (
  template: EntitlementTemplate,
  form: Record<string, string>
): Record<string, EntitlementFieldValue> =>
  Object.fromEntries(
    Object.entries(template.fields ?? {})
      .filter(([, field]) => field.input)
      .map(([key, field]) => [key, { value: toValue(field, form[key] ?? '') }])
  )

export const createClaimableItemUseCase = async (
  code: string,
  clientRef: string,
  claimCode: string,
  form: Record<string, string>
): Promise<void> => {
  const { availableEntitlements } = await getClaimsUseCase(code, clientRef)

  const template = findItemByCode(claimCode, availableEntitlements)

  if (!template) {
    throw Boom.notFound(`Claimable item ${claimCode} not found`)
  }

  await createEntitlement({
    clientRef,
    grantCode: code,
    claimCode,
    data: toEntitlementData(template, form)
  })
}
