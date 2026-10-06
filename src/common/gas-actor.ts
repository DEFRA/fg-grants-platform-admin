import { AsyncLocalStorage } from 'node:async_hooks'

/** The signed in operator, as GAS's audit names them: a display name and their Entra object id. */
export interface GasActor {
  name?: string
  id?: string
}

const storage = new AsyncLocalStorage<GasActor>()

/** Every GAS call made inside `work` goes as this operator. */
export const asGasActor = <T>(actor: GasActor, work: () => T): T =>
  storage.run(actor, work)

/** Nobody outside a request: a background call names no operator. */
export const currentGasActor = (): GasActor => storage.getStore() ?? {}
