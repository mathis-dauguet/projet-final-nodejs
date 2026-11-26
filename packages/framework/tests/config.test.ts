import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkConfig, ConfigError, defaultSecurityHeaders, loadConfig, validateConfig } from '../src/core/config'
import { testConfig } from './helpers'

const secret = randomBytes(32).toString('hex')

describe('loadConfig', () => {
  it('reads every value from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '8080',
      DATABASE_URL: 'postgres://db',
      JWT_SECRET: secret,
      JWT_EXPIRES_IN: '60',
      BCRYPT_COST: '10',
      CORS_ENABLED: 'true',
      CORS_ORIGINS: 'https://a.fr, https://b.fr,',
      UPLOAD_DIR: '/data',
      UPLOAD_MAX_SIZE: '100',
      UPLOAD_ALLOWED_TYPES: 'image/png',
      RATE_LIMIT_MAX: '5',
      RATE_LIMIT_WINDOW_MS: '1000',
      BODY_LIMIT: '2048',
      API_DEFAULT_VERSION: 'v2',
    })
    expect(config).toEqual({
      env: 'production',
      host: '0.0.0.0',
      port: 8080,
      databaseUrl: 'postgres://db',
      jwt: { secret, expiresIn: 60 },
      bcryptCost: 10,
      cors: { enabled: true, origins: ['https://a.fr', 'https://b.fr'] },
      upload: { dir: '/data', maxSize: 100, allowedTypes: ['image/png'] },
      securityHeaders: defaultSecurityHeaders,
      rateLimit: { max: 5, windowMs: 1000 },
      bodyLimit: 2048,
      apiDefaultVersion: 'v2',
    })
  })

  it('uses safe defaults, but never for secrets', () => {
    const config = loadConfig({})
    expect(config.env).toBe('development')
    expect(config.port).toBe(3000)
    expect(config.cors).toEqual({ enabled: false, origins: [] })
    expect(config.jwt.secret).toBe('')
    expect(config.databaseUrl).toBe('')
  })
})

describe('validateConfig', () => {
  it('accepts a valid configuration', () => {
    const config = testConfig()
    expect(validateConfig(config)).toBe(config)
    expect(checkConfig(config)).toEqual([])
  })

  it('names the missing secrets', () => {
    expect(() => validateConfig(loadConfig({}))).toThrow(ConfigError)
    expect(checkConfig(loadConfig({}))).toEqual([
      'DATABASE_URL is required',
      'JWT_SECRET is required (at least 32 characters)',
    ])
  })

  it('reports every incoherent value with its name', () => {
    const config = testConfig({
      env: 'staging',
      host: '',
      port: Number('abc'),
      jwt: { secret: 'short', expiresIn: 0 },
      bcryptCost: 50,
      cors: { enabled: true, origins: [] },
      upload: { dir: '', maxSize: -1, allowedTypes: [] },
      rateLimit: { max: 0, windowMs: 1.5 },
      bodyLimit: 0,
      apiDefaultVersion: 'version1',
    })
    const problems = checkConfig(config)
    expect(problems).toEqual([
      'NODE_ENV must be development, production or test',
      'HOST is required',
      'PORT must be an integer between 0 and 65535',
      'JWT_SECRET is required (at least 32 characters)',
      'JWT_EXPIRES_IN must be a positive integer (seconds)',
      'BCRYPT_COST must be an integer between 4 and 31',
      'CORS_ORIGINS is required when CORS_ENABLED=true',
      'UPLOAD_DIR is required',
      'UPLOAD_MAX_SIZE must be a positive integer (bytes)',
      'UPLOAD_ALLOWED_TYPES is required',
      'RATE_LIMIT_MAX must be a positive integer',
      'RATE_LIMIT_WINDOW_MS must be a positive integer (ms)',
      'BODY_LIMIT must be a positive integer (bytes)',
      'API_DEFAULT_VERSION must look like v1, v2...',
    ])
    try {
      validateConfig(config)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      if (error instanceof ConfigError) {
        expect(error.problems).toEqual(problems)
        expect(error.message).toContain('- JWT_SECRET is required')
      }
    }
  })
})
