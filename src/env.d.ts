/**
 * Secrets. These are not in `wrangler.jsonc` (that file is committed), so
 * `wrangler types` cannot see them — they are declared here and set with
 * `wrangler secret put`, or in the gitignored `.dev.vars` for local runs.
 *
 * Declaring them on `Cloudflare.Env` rather than in a per-module type is
 * deliberate: a module-local Env shadows the real one and hides the drift.
 */
declare namespace Cloudflare {
  interface Env {
    /** Wraps every per-workspace data key. Losing it makes all transcripts unreadable — which is the point. */
    MASTER_KEY: string

    /** Composio hosts notetaker sign-in and vaults the credential; we never hold a provider key. */
    COMPOSIO_API_KEY: string
    COMPOSIO_FATHOM_AUTH_CONFIG: string
    COMPOSIO_GONG_AUTH_CONFIG: string
    COMPOSIO_FIREFLIES_AUTH_CONFIG: string

    /** Optional founder-dogfood gate. Omit locally; set as a production secret. */
    TALLTRACK_ACCESS_TOKEN?: string

    /** Local-only demo seed switch. Never set in a deployed environment. */
    TALLTRACK_DEMO_MODE?: string
  }
}
