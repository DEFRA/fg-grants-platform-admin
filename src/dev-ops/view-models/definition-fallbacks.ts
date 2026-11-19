/**
 * GAS's fallback rules for a grant version's agreement and payment
 * definitions, in the words every page uses: an agreement falls back to the
 * newest usable one of its major, a payment has no fallback.
 */

export const majorOf = (version: string): string => version.split('.')[0]

/** What GAS does without this version's agreement definition. */
export const agreementFallback = (version: string) => {
  const major = majorOf(version)

  return {
    failed: `GAS won’t use this agreement definition: new agreements use the newest usable ${major}.x one at or below ${version}, and actions before acceptance use the newest usable ${major}.x one.`,
    unusable: `GAS has marked this file unusable. New agreements use the newest usable ${major}.x agreement definition at or below ${version}; actions before acceptance use the newest usable ${major}.x one, which may be later.`,
    missingUrls: `GAS won’t load this agreement definition while any service it names has no URL. On this environment, agreements that resolve to it can’t be created, and while it’s the newest usable ${major}.x definition, actions on ${major}.x agreements before acceptance fail too.`,
    states: `Until an agreement is accepted, GAS runs its actions with the newest usable ${major}.x agreement definition, which may not be this one. From accepted on, it stays on the version it was accepted under.`
  }
}

export const paymentNoFallback =
  'Payments for this version will fail: GAS has no fallback for a payment definition.'

/** What this version's payment definition is used for, and that nothing stands in for it. */
export const paymentUsedFor = (version: string): string =>
  `Agreement payments whose agreement is on ${version} (the version it was created or accepted under), and claims on applications currently on ${version}. GAS has no fallback: if this file can’t load, those payments fail.`
