import type { StoredTransition } from '../use-cases/get-workflow-page.use-case.ts'

/** CW holds a caseworker's action to the action's own `checkTasks`, and a move GAS sends to the transition's. */
export const checksTasks = ({
  action,
  checkTasks
}: StoredTransition): boolean => (action ? action.checkTasks : checkTasks)
