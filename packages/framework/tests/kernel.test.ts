import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigError } from '../src/core/config'
import { HttpError } from '../src/core/errors'
import { Kernel, type KernelOptions } from '../src/core/kernel'
import { json, respond, text, xml } from '../src/core/response'
import type { Config, Database, Middleware } from '../src/core/types'
import { Route } from '../src/routing/router'
import { testConfig } from './helpers'

let kernel: Kernel | undefined

/** Démarre un kernel sur un port libre et renvoie une fonction fetch relative. */
const boot = async (options: KernelOptions = {}, config: Config = testConfig()) => {
  kernel = new Kernel(config, { handleSignals: false, ...options })
  await kernel.start()
  const base = `http://127.0.0.1:${kernel.port}`
  return (path: string, init?: RequestInit) => fetch(base + path, init)
}

beforeEach(() => Route.clear())

afterEach(async () => {
  await kernel?.stop()
  kernel = undefined
})

describe('lifecycle', () => {
  it('refuses to start with an invalid configuration', async () => {
    const bad = new Kernel(testConfig({ databaseUrl: '' }), { handleSignals: false })
    await expect(bad.start()).rejects.toThrow(ConfigError)
    await expect(bad.start()).rejects.toThrow('DATABASE_URL is required')
  })

  it('refuses to start with a duplicated route name', async () => {
    Route.get('/a', () => json(1)).name('dup')
    Route.get('/b', () => json(2)).name('dup')
    await expect(new Kernel(testConfig(), { handleSignals: false }).start()).rejects.toThrow('already used')
  })

  it('opens and closes the database', async () => {
    const calls: string[] = []
    const database: Database = {
      connect: async () => void calls.push('connect'),
      close: async () => void calls.push('close'),
    }
    await boot({ database })
    expect(calls).toEqual(['connect'])
    await kernel?.stop()
    expect(calls).toEqual(['connect', 'close'])
  })

  it('cannot be started twice, and stop() is idempotent', async () => {
    await boot()
    await expect(kernel?.start()).rejects.toThrow('Kernel is already started')
    expect(kernel?.server).toBeDefined()
    await kernel?.stop()
    expect(kernel?.server).toBeUndefined()
    expect(kernel?.port).toBe(0)
    await kernel?.stop()
  })

  it('applies the default version from the configuration', async () => {
    Route.get('/users', ({ version }) => json(version)).name('users')
    const request = await boot({}, testConfig({ apiDefaultVersion: 'v2' }))
    expect(await (await request('/users')).json()).toBe('v2')
    expect(Route.url('users')).toBe('/v2/users')
  })

  it('lets in-flight requests finish during a graceful stop', async () => {
    let started = false
    let release = (): void => {}
    Route.get('/slow', async () => {
      await new Promise<void>((resolve) => {
        release = resolve
        started = true
      })
      return json('finished')
    })
    const request = await boot()
    const pending = request('/slow')
    await vi.waitFor(() => expect(started).toBe(true))
    const stopping = kernel?.stop()
    release()
    expect(await (await pending).json()).toBe('finished')
    await stopping
  })

  it('stops on SIGTERM and removes its signal listeners', async () => {
    const before = process.listenerCount('SIGTERM')
    const beforeInt = process.listenerCount('SIGINT')
    kernel = new Kernel(testConfig())
    await kernel.start()
    expect(process.listenerCount('SIGTERM')).toBe(before + 1)
    expect(process.listenerCount('SIGINT')).toBe(beforeInt + 1)
    process.emit('SIGTERM')
    await vi.waitFor(() => expect(kernel?.server).toBeUndefined())
    expect(process.listenerCount('SIGTERM')).toBe(before)
    expect(process.listenerCount('SIGINT')).toBe(beforeInt)
    await vi.waitFor(() => expect(process.exitCode).toBe(0))
    process.exitCode = undefined
  })
})

describe('requests', () => {
  it('gives the controller params, query, version and route', async () => {
    Route.get('/users/{id}', ({ params, query, version, route, method }) =>
      json({ id: params.id, q: query.get('q'), version, name: route?.name, method }),
    ).name('users.show')
    const request = await boot()
    const response = await request('/v1/users/42?q=hello%20world')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await response.json()).toEqual({ id: '42', q: 'hello world', version: 'v1', name: 'users.show', method: 'GET' })
  })

  it('answers 404 in the unique error format', async () => {
    const request = await boot()
    const response = await request('/nothing')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /nothing', details: null },
    })
  })

  it('answers 405 with the Allow header', async () => {
    Route.get('/users', () => json([]))
    Route.post('/users', () => json({}, 201))
    const request = await boot()
    const response = await request('/users', { method: 'DELETE' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST')
    expect((await response.json()).error.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('answers 400 on a malformed encoding', async () => {
    Route.get('/tags/{name}', () => json('x'))
    const request = await boot()
    expect((await request('/tags/%E0%A4%A')).status).toBe(400)
  })

  it('serves other formats', async () => {
    Route.get('/text', () => text('plain'))
    Route.get('/xml', () => xml({ a: 1 }))
    const request = await boot()
    expect(await (await request('/text')).text()).toBe('plain')
    const response = await request('/xml')
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(await response.text()).toContain('<response><a>1</a></response>')
  })

  it('converts thrown HttpErrors and hides internal errors in production', async () => {
    Route.get('/forbidden', () => {
      throw new HttpError(403, 'FORBIDDEN', 'No access')
    })
    Route.get('/crash', async () => {
      throw new Error('SELECT * FROM secret')
    })
    const request = await boot({}, testConfig({ env: 'production' }))
    const forbidden = await request('/forbidden')
    expect(forbidden.status).toBe(403)
    expect((await forbidden.json()).error.code).toBe('FORBIDDEN')
    const crash = await request('/crash')
    expect(crash.status).toBe(500)
    expect(await crash.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error', details: null },
    })
  })

  it('handles a request without url, method or remote address', async () => {
    Route.get('/', ({ ip, path }) => json({ ip, path }))
    const local = new Kernel(testConfig(), { handleSignals: false })
    const req = new IncomingMessage(new Socket())
    req.url = undefined
    req.method = undefined
    const res = new ServerResponse(req)
    let written = ''
    res.end = ((chunk: string) => {
      written = chunk
      return res
    }) as ServerResponse['end']
    await local.handle(req, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(written)).toEqual({ ip: '', path: '/' })
  })

  it('answers 500 when the format has no serializer', async () => {
    Route.get('/yaml', () => respond('yaml', 'a: 1'))
    const request = await boot()
    const response = await request('/yaml')
    expect(response.status).toBe(500)
    expect((await response.json()).error.message).toBe('No serializer registered for format "yaml"')
  })
})

describe('middlewares in the kernel', () => {
  const tracer = (log: string[], name: string): Middleware => async (_ctx, next) => {
    log.push(`${name}:in`)
    const response = await next()
    log.push(`${name}:out`)
    return response
  }

  it('runs global, then group (outer to inner), then route middlewares', async () => {
    const log: string[] = []
    Route.group({ prefix: '/g1', middlewares: [tracer(log, 'group1')] }, () => {
      Route.group({ prefix: '/g2', middlewares: [tracer(log, 'group2')] }, () => {
        Route.get('/r', () => {
          log.push('handler')
          return json('ok')
        }, { middlewares: [tracer(log, 'route')] })
      })
    })
    const request = await boot({ middlewares: [tracer(log, 'global1')] })
    kernel?.use(tracer(log, 'global2'))
    await request('/g1/g2/r')
    expect(log).toEqual([
      'global1:in',
      'global2:in',
      'group1:in',
      'group2:in',
      'route:in',
      'handler',
      'route:out',
      'group2:out',
      'group1:out',
      'global2:out',
      'global1:out',
    ])
  })

  it('runs global middlewares even when no route matches', async () => {
    const log: string[] = []
    const request = await boot({ middlewares: [tracer(log, 'global')] })
    expect((await request('/missing')).status).toBe(404)
    expect(log).toEqual(['global:in'])
  })

  it('lets a global middleware answer before the 404/405 (e.g. preflight)', async () => {
    const preflight: Middleware = (ctx, next) =>
      ctx.method === 'OPTIONS' ? json(undefined, 204, { 'access-control-allow-origin': '*' }) : next()
    Route.get('/users', () => json([]))
    const request = await boot({ middlewares: [preflight] })
    const response = await request('/users', { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('catches an exception thrown after next() with the same handler', async () => {
    const failAfter: Middleware = async (_ctx, next) => {
      await next()
      throw new HttpError(409, 'CONFLICT', 'after next')
    }
    Route.get('/r', () => json('ok'), { middlewares: [failAfter] })
    const request = await boot()
    const response = await request('/r')
    expect(response.status).toBe(409)
    expect((await response.json()).error.message).toBe('after next')
  })

  it('sends a single response when a middleware writes then continues', async () => {
    const writeThenNext: Middleware = async (ctx, next) => {
      ctx.res.writeHead(202, { 'content-type': 'text/plain' }).end('written by middleware')
      return next()
    }
    Route.get('/r', () => json('from handler'), { middlewares: [writeThenNext] })
    const request = await boot()
    const response = await request('/r')
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('written by middleware')
  })

  it('catches rejected promises from async handlers', async () => {
    Route.get('/async', () => Promise.reject(new HttpError(418, 'TEAPOT', 'async failure')))
    const request = await boot()
    const response = await request('/async')
    expect(response.status).toBe(418)
  })
})
