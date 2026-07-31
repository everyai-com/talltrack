import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// vitest-pool-workers 0.20 (Vitest 4) exposes the Workers runtime as a Vite
// plugin. The older defineWorkersConfig + poolOptions shape is gone.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['test/**/*.test.ts'],
  },
})
