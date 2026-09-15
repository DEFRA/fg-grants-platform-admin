import { eventServices } from './event-filters.ts'

const boxLabels = new Map([
  ['inbox', 'Inbox'],
  ['outbox', 'Outbox']
])

interface ServiceOption {
  value: string
  label: string
}

const labelIn = (
  services: ServiceOption[],
  service: string
): string | undefined => services.find(({ value }) => value === service)?.label

export const toServiceLabel = (
  service: string,
  services: ServiceOption[] = eventServices
): string => labelIn(services, service) ?? service

export const toBoxLabel = (box: string): string => boxLabels.get(box) ?? box
