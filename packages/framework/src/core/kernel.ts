import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Route } from '../routing/router'
import { validateConfig } from './config'
import { errorToResponse, HttpError } from './errors'
import { compose } from './pipeline'
import { toPayload, writePayload, type Payload } from './response'
import type { Config, Context, Database, Handler, HttpResponse, Middleware } from './types'

export interface KernelOptions {
  /** Middlewares globaux, exécutés dans leur ordre d'enregistrement. */
  middlewares?: Middleware[]
  /** Base ouverte au démarrage et fermée à l'arrêt. */
  database?: Database
  /** Écoute SIGINT / SIGTERM pour un arrêt propre (true par défaut). */
  handleSignals?: boolean
}

/**
 * Le kernel porte le cycle de vie : validation de la configuration,
 * ouverture de la base, enregistrement des routes, démarrage, arrêt propre.
 */
export class Kernel {
  readonly config: Config
  readonly #middlewares: Middleware[]
  readonly #database: Database | undefined
  readonly #handleSignals: boolean
  #server: Server | undefined
  #port = 0
  #onSignal: (() => void) | undefined

  constructor(config: Config, options: KernelOptions = {}) {
    this.config = config
    this.#middlewares = [...(options.middlewares ?? [])]
    this.#database = options.database
    this.#handleSignals = options.handleSignals ?? true
  }

  /** Ajoute un middleware global. */
  use(middleware: Middleware): this {
    this.#middlewares.push(middleware)
    return this
  }

  get server(): Server | undefined {
    return this.#server
  }

  /** Port réellement écouté (utile avec le port 0 dans les tests), 0 si arrêté. */
  get port(): number {
    return this.#port
  }

  async start(): Promise<Server> {
    if (this.#server !== undefined) throw new Error('Kernel is already started')
    validateConfig(this.config)
    Route.setDefaultVersion(this.config.apiDefaultVersion)
    Route.compile()
    await this.#database?.connect()

    const server = createServer((req, res) => {
      void this.handle(req, res)
    })
    this.#server = server
    await new Promise<void>((resolve) => server.listen(this.config.port, this.config.host, resolve))
    // On écoute en TCP (host + port) : address() est donc toujours un AddressInfo.
    this.#port = (server.address() as AddressInfo).port

    if (this.#handleSignals) {
      this.#onSignal = () => {
        void this.stop().then(() => {
          process.exitCode = 0
        })
      }
      process.once('SIGINT', this.#onSignal)
      process.once('SIGTERM', this.#onSignal)
    }
    return server
  }

  /** Arrêt gracieux : plus de nouvelles connexions, requêtes en cours terminées, base fermée. */
  async stop(): Promise<void> {
    const server = this.#server
    if (server === undefined) return
    this.#server = undefined
    this.#port = 0
    if (this.#onSignal !== undefined) {
      process.off('SIGINT', this.#onSignal)
      process.off('SIGTERM', this.#onSignal)
      this.#onSignal = undefined
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeIdleConnections()
    })
    await this.#database?.close()
  }

  /** Traite une requête : contexte, résolution, pipeline, réponse unique. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const production = this.config.env === 'production'
    let payload: Payload
    try {
      const response = await this.#dispatch(req, res)
      payload = toPayload(response)
    } catch (err) {
      payload = toPayload(errorToResponse(err, production))
    }
    await writePayload(res, payload)
  }

  async #dispatch(req: IncomingMessage, res: ServerResponse): Promise<HttpResponse> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = (req.method ?? 'GET').toUpperCase()
    const ctx: Context = {
      req,
      res,
      method,
      path: url.pathname,
      headers: req.headers,
      ip: req.socket.remoteAddress ?? '',
      params: {},
      query: url.searchParams,
      version: this.config.apiDefaultVersion,
      route: undefined,
      body: undefined,
      state: {},
      config: this.config,
    }

    // Les middlewares globaux tournent même sans route (CORS, logs, 404 au bon format...).
    let routeMiddlewares: Middleware[] = []
    let handler: Handler
    const resolution = Route.resolve(method, url.pathname)
    ctx.version = resolution.version

    if (resolution.kind === 'found') {
      const { route } = resolution
      ctx.params = resolution.params
      ctx.route = { method: route.method, path: route.path, version: route.version, name: route.name }
      routeMiddlewares = route.middlewares
      handler = route.handler
    } else if (resolution.kind === 'method_not_allowed') {
      const allow = resolution.allow.join(', ')
      handler = () => {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Method ${method} is not allowed`, null, { allow })
      }
    } else {
      handler = () => {
        throw new HttpError(404, 'NOT_FOUND', `No route for ${method} ${url.pathname}`)
      }
    }

    return compose([...this.#middlewares, ...routeMiddlewares], handler)(ctx)
  }
}
