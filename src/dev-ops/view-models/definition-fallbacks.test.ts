import {
  agreementFallback,
  majorOf,
  paymentNoFallback,
  paymentUsedFor
} from './definition-fallbacks.ts'

describe('definition fallbacks', () => {
  test.each([
    ['1.2.0', '1'],
    ['12.0.3', '12']
  ])('the major of %s is %s', (version, major) => {
    expect(majorOf(version)).toBe(major)
  })

  test('an agreement falls back to the newest usable one of its major, at or below its version', () => {
    expect(agreementFallback('2.4.1')).toEqual({
      failed:
        'GAS won’t use this agreement definition: new agreements use the newest usable 2.x one at or below 2.4.1, and actions before acceptance use the newest usable 2.x one.',
      unusable:
        'GAS has marked this file unusable. New agreements use the newest usable 2.x agreement definition at or below 2.4.1; actions before acceptance use the newest usable 2.x one, which may be later.',
      missingUrls:
        'GAS won’t load this agreement definition while any service it names has no URL. On this environment, agreements that resolve to it can’t be created, and while it’s the newest usable 2.x definition, actions on 2.x agreements before acceptance fail too.',
      states:
        'Until an agreement is accepted, GAS runs its actions with the newest usable 2.x agreement definition, which may not be this one. From accepted on, it stays on the version it was accepted under.'
    })
  })

  test('a payment has no fallback', () => {
    expect(paymentNoFallback).toBe(
      'Payments for this version will fail: GAS has no fallback for a payment definition.'
    )
    expect(paymentUsedFor('2.4.1')).toContain(
      'GAS has no fallback: if this file can’t load, those payments fail.'
    )
  })
})
