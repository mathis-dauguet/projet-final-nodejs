import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

/** Configuration complète du framework (construite par loadConfig). */
export interface Config {
  env: string
  host: string
  port: number
  databaseUrl: string
  jwt: { secret: string; expiresIn: number }
  bcryptCost: number
  cors: { enabled: boolean; origins: string[] }
  upload: { dir: string; maxSize: number; allowedTypes: string[] }
  securityHeaders: Record<string, string>
  rateLimit: { max: number; windowMs: number }
  bodyLimit: number
  apiDefaultVersion: string
}

/** Informations sur la route résolue, exposées dans le contexte. */
export interface RouteInfo {
  method: string
  path: string
  version: string
  name: string | undefined
}

/** Tout ce qu'un contrôleur ou un middleware peut utiliser. */
export interface Context {
  req: IncomingMessage
  res: ServerResponse
  method: string
  path: string
  headers: IncomingHttpHeaders
  ip: string
  params: Record<string, string>
  query: URLSearchParams
  /** Version résolue (celle de l'URL, ou la version par défaut). */
  version: string
  route: RouteInfo | undefined
  /** Corps de la requête, rempli par un middleware de lecture du corps. */
  body: unknown
  /** Espace libre pour les middlewares (utilisateur authentifié, etc.). */
  state: Record<string, unknown>
  config: Config
}

/** Réponse renvoyée par un contrôleur, écrite par le framework. */
export interface HttpResponse {
  status: number
  headers: Record<string, string>
  /** Valeur à sérialiser, Buffer déjà prêt, ou flux Readable (envoyé en streaming). */
  body: unknown
  /** Nom du sérialiseur à utiliser : json, text, html, xml... */
  format: string
}

export type Next = () => Promise<HttpResponse>
export type Handler = (ctx: Context) => HttpResponse | Promise<HttpResponse>
export type Middleware = (ctx: Context, next: Next) => HttpResponse | Promise<HttpResponse>

/** Base de données ouverte et fermée par le kernel (ex. le pool du Query Builder). */
export interface Database {
  connect(): Promise<void>
  close(): Promise<void>
}
