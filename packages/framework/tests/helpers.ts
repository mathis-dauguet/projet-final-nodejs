import { randomBytes } from 'node:crypto'
import { loadConfig } from '../src/core/config'
import type { Config } from '../src/core/types'

/** Configuration valide pour les tests : le secret est tiré au hasard, rien n'est en dur. */
export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  ...loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: 'postgres://localhost:5432/test',
    JWT_SECRET: randomBytes(32).toString('hex'),
  }),
  ...overrides,
})
