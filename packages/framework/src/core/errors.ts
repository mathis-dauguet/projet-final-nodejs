import type { HttpResponse } from './types'

/** Format d'erreur unique de toute l'API. */
export interface ErrorBody {
  error: {
    code: string
    message: string
    details: unknown
  }
}

/** Erreur HTTP : levée n'importe où, transformée en réponse par le framework. */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  readonly headers: Record<string, string>

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown = null,
    headers: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
    this.headers = headers
  }
}

export function errorBody(code: string, message: string, details: unknown = null): ErrorBody {
  return { error: { code, message, details } }
}

/**
 * Transforme n'importe quelle erreur en réponse JSON au format unique.
 * En production, une erreur interne ne révèle jamais son message.
 */
export function errorToResponse(err: unknown, production: boolean): HttpResponse {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      headers: { ...err.headers },
      body: errorBody(err.code, err.message, err.details),
      format: 'json',
    }
  }
  const message = !production && err instanceof Error ? err.message : 'Internal Server Error'
  return {
    status: 500,
    headers: {},
    body: errorBody('INTERNAL_ERROR', message),
    format: 'json',
  }
}
