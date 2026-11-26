import type { Config } from './types'

/** Les variables d'environnement, typées comme inconnues tant qu'elles ne sont pas vérifiées. */
export type Env = Record<string, string | undefined>

export class ConfigError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}

export const defaultSecurityHeaders: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')

/**
 * Seul endroit du projet qui lit l'environnement.
 * Les secrets n'ont pas de valeur par défaut : ils restent vides et
 * validateConfig refusera de démarrer.
 */
export const loadConfig = (env: Env): Config => ({
  env: env.NODE_ENV ?? 'development',
  host: env.HOST ?? '127.0.0.1',
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? '',
  jwt: {
    secret: env.JWT_SECRET ?? '',
    expiresIn: Number(env.JWT_EXPIRES_IN ?? 3600),
  },
  bcryptCost: Number(env.BCRYPT_COST ?? 12),
  cors: {
    enabled: env.CORS_ENABLED === 'true',
    origins: list(env.CORS_ORIGINS),
  },
  upload: {
    dir: env.UPLOAD_DIR ?? './uploads',
    maxSize: Number(env.UPLOAD_MAX_SIZE ?? 5 * 1024 * 1024),
    allowedTypes: list(env.UPLOAD_ALLOWED_TYPES ?? 'image/jpeg,image/png,image/webp'),
  },
  securityHeaders: { ...defaultSecurityHeaders },
  rateLimit: {
    max: Number(env.RATE_LIMIT_MAX ?? 100),
    windowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  },
  bodyLimit: Number(env.BODY_LIMIT ?? 1024 * 1024),
  apiDefaultVersion: env.API_DEFAULT_VERSION ?? 'v1',
})

const isInt = (value: number, min: number, max = Number.MAX_SAFE_INTEGER): boolean =>
  Number.isInteger(value) && value >= min && value <= max

/** Décrit toutes les anomalies au lieu de lever à la première (fonction pure). */
export const checkConfig = (config: Config): string[] => {
  const problems: string[] = []
  if (!['development', 'production', 'test'].includes(config.env)) {
    problems.push('NODE_ENV must be development, production or test')
  }
  if (config.host === '') problems.push('HOST is required')
  if (!isInt(config.port, 0, 65535)) problems.push('PORT must be an integer between 0 and 65535')
  if (config.databaseUrl === '') problems.push('DATABASE_URL is required')
  if (config.jwt.secret.length < 32) problems.push('JWT_SECRET is required (at least 32 characters)')
  if (!isInt(config.jwt.expiresIn, 1)) problems.push('JWT_EXPIRES_IN must be a positive integer (seconds)')
  if (!isInt(config.bcryptCost, 4, 31)) problems.push('BCRYPT_COST must be an integer between 4 and 31')
  if (config.cors.enabled && config.cors.origins.length === 0) {
    problems.push('CORS_ORIGINS is required when CORS_ENABLED=true')
  }
  if (config.upload.dir === '') problems.push('UPLOAD_DIR is required')
  if (!isInt(config.upload.maxSize, 1)) problems.push('UPLOAD_MAX_SIZE must be a positive integer (bytes)')
  if (config.upload.allowedTypes.length === 0) problems.push('UPLOAD_ALLOWED_TYPES is required')
  if (!isInt(config.rateLimit.max, 1)) problems.push('RATE_LIMIT_MAX must be a positive integer')
  if (!isInt(config.rateLimit.windowMs, 1)) problems.push('RATE_LIMIT_WINDOW_MS must be a positive integer (ms)')
  if (!isInt(config.bodyLimit, 1)) problems.push('BODY_LIMIT must be a positive integer (bytes)')
  if (!/^v\d+$/.test(config.apiDefaultVersion)) problems.push('API_DEFAULT_VERSION must look like v1, v2...')
  return problems
}

/** Lève une ConfigError nommant chaque valeur fautive. */
export const validateConfig = (config: Config): Config => {
  const problems = checkConfig(config)
  if (problems.length > 0) throw new ConfigError(problems)
  return config
}
