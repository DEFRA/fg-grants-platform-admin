import { logger } from '../../common/logger.ts'
import type { SectionError } from '../repositories/events.repository.ts'

export const logSectionErrors = (
  context: string,
  sectionErrors: SectionError[] = []
): void => {
  for (const { section, message } of sectionErrors) {
    logger.error(
      `fg-gas-backend could not read the ${section} for ${context}: ${message}`
    )
  }
}
