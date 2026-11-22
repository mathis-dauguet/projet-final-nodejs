import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/framework/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/framework/src/**'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
})