import type { EventService } from '../use-cases/get-event.use-case.ts'

export const eventServices: { value: EventService; label: string }[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'CW-BE' }
]
