import {
  toIdentifier,
  toSessionUser,
  toTrimmed
} from '../../common/view-models/actor.ts'

export interface SignedInUser {
  name: string
  email: string
  initials: string
}

/** "Ada Lovelace" is AL; a lone name or an email stands for one letter. */
export const toInitials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')

/** Who the shell says is signed in: the name, or the email standing in for it; null when the session carries neither. */
export const toSignedInUser = (user: unknown): SignedInUser | null => {
  const session = toSessionUser(user)
  const name = toIdentifier(session)

  return name
    ? { name, email: toTrimmed(session.email), initials: toInitials(name) }
    : null
}
