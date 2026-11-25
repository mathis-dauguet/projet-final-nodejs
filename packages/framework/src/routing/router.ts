import { HttpError } from '../core/errors'
import type { Handler, Middleware } from '../core/types'
import { compilePattern, encodeParam, extractParams, normalizePath, type CompiledPattern } from './pattern'

export interface RouteOptions {
  middlewares?: Middleware[]
  version?: string
}

export interface GroupOptions {
  prefix?: string
  middlewares?: Middleware[]
  /** Préfixe de nom, ex. "users." */
  name?: string
  version?: string
}

interface RouteEntry {
  method: string
  path: string
  version: string | undefined
  handler: Handler
  middlewares: Middleware[]
  namePrefix: string
  name: string | undefined
}

export interface CompiledRoute {
  method: string
  path: string
  version: string
  handler: Handler
  middlewares: Middleware[]
  name: string | undefined
  pattern: CompiledPattern
}

export type Resolution =
  | { kind: 'found'; route: CompiledRoute; params: Record<string, string>; version: string }
  | { kind: 'not_found'; version: string }
  | { kind: 'method_not_allowed'; allow: string[]; version: string }

interface Table {
  /** clé "v1 /users" → méthode → route */
  statics: Map<string, Map<string, CompiledRoute>>
  /** version → routes dynamiques, dans l'ordre de déclaration */
  dynamics: Map<string, CompiledRoute[]>
  names: Map<string, CompiledRoute>
}

/** Retour de Route.get(...) : permet d'enchaîner .name() et .middleware(). */
export class RouteDefinition {
  readonly #entry: RouteEntry

  constructor(entry: RouteEntry) {
    this.#entry = entry
  }

  name(name: string): this {
    this.#entry.name = this.#entry.namePrefix + name
    Route.invalidate()
    return this
  }

  middleware(...middlewares: Middleware[]): this {
    this.#entry.middlewares.push(...middlewares)
    return this
  }
}

const VERSION_IN_PATH = /^\/(v\d+)(\/.*)?$/

/**
 * Registre de routes statique, style Laravel :
 *   Route.get('/users/{id}', show).name('users.show')
 *   Route.group({ prefix: '/admin', middlewares: [auth], name: 'admin.' }, () => { ... })
 */
export class Route {
  static #routes: RouteEntry[] = []
  static #groups: GroupOptions[] = []
  static #defaultVersion = 'v1'
  static #table: Table | null = null

  static get(path: string, handler: Handler, options: RouteOptions = {}): RouteDefinition {
    return Route.add('GET', path, handler, options)
  }

  static post(path: string, handler: Handler, options: RouteOptions = {}): RouteDefinition {
    return Route.add('POST', path, handler, options)
  }

  static put(path: string, handler: Handler, options: RouteOptions = {}): RouteDefinition {
    return Route.add('PUT', path, handler, options)
  }

  static patch(path: string, handler: Handler, options: RouteOptions = {}): RouteDefinition {
    return Route.add('PATCH', path, handler, options)
  }

  static delete(path: string, handler: Handler, options: RouteOptions = {}): RouteDefinition {
    return Route.add('DELETE', path, handler, options)
  }

  static add(method: string, path: string, handler: Handler, options: RouteOptions = {}): RouteDefinition {
    const groups = Route.#groups
    const prefix = groups.map((group) => group.prefix ?? '').join('')
    const groupVersion = groups.findLast((group) => group.version !== undefined)?.version
    const entry: RouteEntry = {
      method: method.toUpperCase(),
      path: normalizePath(prefix + normalizePath(path)),
      version: options.version ?? groupVersion,
      handler,
      // Ordre exigé : groupe le plus externe → plus interne → route.
      middlewares: [...groups.flatMap((group) => group.middlewares ?? []), ...(options.middlewares ?? [])],
      namePrefix: groups.map((group) => group.name ?? '').join(''),
      name: undefined,
    }
    Route.#routes.push(entry)
    Route.invalidate()
    return new RouteDefinition(entry)
  }

  /** Les groupes s'imbriquent : préfixes, middlewares et noms se concatènent. */
  static group(options: GroupOptions, callback: () => void): void {
    Route.#groups.push(options)
    try {
      callback()
    } finally {
      Route.#groups.pop()
    }
  }

  /** Vide le registre : indispensable pour isoler les tests. */
  static clear(): void {
    Route.#routes = []
    Route.#groups = []
    Route.#defaultVersion = 'v1'
    Route.#table = null
  }

  static setDefaultVersion(version: string): void {
    Route.#defaultVersion = version
    Route.invalidate()
  }

  static invalidate(): void {
    Route.#table = null
  }

  /**
   * Construit les tables de résolution. Appelé par le kernel au démarrage :
   * un nom ou une route en double est une erreur, pas un écrasement.
   */
  static compile(): Table {
    if (Route.#table !== null) return Route.#table
    const table: Table = { statics: new Map(), dynamics: new Map(), names: new Map() }
    const seen = new Set<string>()

    for (const entry of Route.#routes) {
      const version = entry.version ?? Route.#defaultVersion
      const route: CompiledRoute = {
        method: entry.method,
        path: entry.path,
        version,
        handler: entry.handler,
        middlewares: entry.middlewares,
        name: entry.name,
        pattern: compilePattern(entry.path),
      }

      const key = `${entry.method} /${version}${entry.path}`
      if (seen.has(key)) throw new Error(`Route "${key}" is declared twice`)
      seen.add(key)

      if (route.name !== undefined) {
        if (table.names.has(route.name)) throw new Error(`Route name "${route.name}" is already used`)
        table.names.set(route.name, route)
      }

      if (route.pattern.isStatic) {
        const staticKey = `${version} ${route.path}`
        const byMethod = table.statics.get(staticKey) ?? new Map<string, CompiledRoute>()
        byMethod.set(route.method, route)
        table.statics.set(staticKey, byMethod)
      } else {
        const list = table.dynamics.get(version) ?? []
        list.push(route)
        table.dynamics.set(version, list)
      }
    }

    Route.#table = table
    return table
  }

  /** Trouve la route : statiques d'abord (Map), puis dynamiques. */
  static resolve(method: string, rawPath: string): Resolution {
    const table = Route.compile()
    const fullPath = normalizePath(rawPath)
    const versioned = VERSION_IN_PATH.exec(fullPath)
    const version = versioned?.[1] ?? Route.#defaultVersion
    const path = versioned === null ? fullPath : (versioned[2] ?? '/')
    const allow = new Set<string>()

    const byMethod = table.statics.get(`${version} ${path}`)
    const staticRoute = byMethod?.get(method)
    if (staticRoute !== undefined) return { kind: 'found', route: staticRoute, params: {}, version }
    for (const allowed of byMethod?.keys() ?? []) allow.add(allowed)

    for (const route of table.dynamics.get(version) ?? []) {
      const match = route.pattern.regex.exec(path)
      if (match === null) continue
      if (route.method !== method) {
        allow.add(route.method)
        continue
      }
      try {
        return { kind: 'found', route, params: extractParams(route.pattern, match), version }
      } catch {
        throw new HttpError(400, 'BAD_REQUEST', 'Malformed URL encoding')
      }
    }

    if (allow.size > 0) return { kind: 'method_not_allowed', allow: [...allow].sort(), version }
    return { kind: 'not_found', version }
  }

  /** Génère l'URL d'une route nommée, version incluse. */
  static url(
    name: string,
    params: Record<string, string | number> = {},
    query: Record<string, string | number> = {},
  ): string {
    const route = Route.compile().names.get(name)
    if (route === undefined) throw new Error(`Route "${name}" is not defined`)

    let path = route.path
    for (const param of route.pattern.paramNames) {
      const value = params[param]
      if (value === undefined) throw new Error(`Missing parameter "${param}" for route "${name}"`)
      const wildcard = param === route.pattern.wildcard
      const encoded = encodeParam(String(value), wildcard)
      path = path.replace(wildcard ? `{${param}*}` : `{${param}}`, () => encoded)
    }

    const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
    const queryString = search.size > 0 ? `?${search.toString()}` : ''
    return normalizePath(`/${route.version}${path}`) + queryString
  }
}
