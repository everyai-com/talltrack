/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from '@cloudflare/vitest-pool-workers'

// This version of the pool types `cloudflare:test`'s env as Cloudflare.Env, so
// the test-only binding is declared there — optional, because it exists only
// when vitest.config.ts injects it and production never provides it.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS?: D1Migration[]
    }
  }
}
