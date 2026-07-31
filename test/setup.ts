import { applyD1Migrations, env } from 'cloudflare:test'

// The test D1 starts empty every run; give it the same schema production has.
// TEST_MIGRATIONS is injected by vitest.config.ts via readD1Migrations().
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? [])
