import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// vitest-pool-workers 0.20 (Vitest 4) exposes the Workers runtime as a Vite
// plugin. The older defineWorkersConfig + poolOptions shape is gone.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('migrations')

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Hands the migration list to test/setup.ts, which applies it to the
          // fresh per-run D1 before any test touches a table.
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['test/setup.ts'],
    },
  }
})
