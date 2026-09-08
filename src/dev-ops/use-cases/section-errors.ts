import { logger } from '../../common/logger.ts'
import type { SectionError } from '../repositories/events.repository.ts'

/**
 * A section fg-gas-backend could not read is never silent: the endpoint names
 * it and says why, and this app writes one line per section.
 *
 * The two pages differ only in what they call the thing being read — an event
 * by its key, the list page by name — so the phrase is the parameter and the
 * sentence is written once. Two copies of this loop drifted apart once
 * already.
 */
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
