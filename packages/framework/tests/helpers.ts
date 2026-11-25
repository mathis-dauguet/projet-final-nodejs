import { loadConfig } from '../src/core/config'
import type { Config } from '../src/core/types'

/** Configuration valide pour les tests (aucun secret réel). */
export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  ...loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    JWT_SECRET: 'test-secret-test-secret-test-secret',
  }),
  ...overrides,
})
