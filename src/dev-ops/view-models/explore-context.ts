import type {
  EventBox,
  EventService,
  ExploreContext
} from '../use-cases/explore-calls.ts'

/** What to make of each context a row's record sits beside. */
export interface ContextCases<T> {
  none: () => T
  box: (box: { service: EventService; box: EventBox }) => T
  definition: (definition: string | null) => T
  agreement: (agreement: string | null) => T
}

/** A row's context by what it is: none, an event's service and box, or a joined record, as base64 BSON or null. */
export const contextOf = <T>(
  context: ExploreContext | null | undefined,
  cases: ContextCases<T>
): T => {
  if (!context) {
    return cases.none()
  }

  if ('service' in context) {
    return cases.box(context)
  }

  return 'definition' in context
    ? cases.definition(context.definition)
    : cases.agreement(context.agreement)
}
