/**
 * Workspace identity.
 *
 * TallTrack has no sign-in yet, so this is a single-tenant placeholder — and it
 * is written as a function precisely so that every call site is already asking
 * "whose workspace is this?" rather than passing a literal around. When real
 * sessions land, this is the one place that changes.
 *
 * The rule it exists to protect, borrowed from AIOS's hardest identity bug:
 * **a workspace id must never come from the request body or a query parameter.**
 * It comes from a signed session, or it is a constant. Anything else means one
 * customer can read another's calls by editing a field.
 */

const SOLO_WORKSPACE = 'solo'

export function workspaceOf(_req: Request): string {
  return SOLO_WORKSPACE
}
