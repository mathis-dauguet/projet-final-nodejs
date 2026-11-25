import { beforeEach, describe, expect, it } from 'vitest'
import { HttpError } from '../src/core/errors'
import { json } from '../src/core/response'
import type { Handler, Middleware } from '../src/core/types'
import { Route } from '../src/routing/router'

const ok: Handler = () => json({ ok: true })
const handler = (label: string): Handler => () => json({ label })
const mw = (): Middleware => (_ctx, next) => next()

/** Raccourci : renvoie le handler trouvé, ou le type d'échec. */
const found = (method: string, path: string) => {
  const result = Route.resolve(method, path)
  if (result.kind !== 'found') throw new Error(`expected a route, got ${result.kind}`)
  return result
}

beforeEach(() => Route.clear())

describe('declaration', () => {
  it('registers every HTTP verb', () => {
    Route.get('/r', ok)
    Route.post('/r', ok)
    Route.put('/r', ok)
    Route.patch('/r', ok)
    Route.delete('/r', ok)
    Route.add('options', '/r', ok)
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(found(method, '/r').route.method).toBe(method)
    }
  })

  it('can be cleared', () => {
    Route.get('/users', ok).name('users')
    Route.clear()
    expect(Route.resolve('GET', '/users').kind).toBe('not_found')
    expect(() => Route.url('users')).toThrow('Route "users" is not defined')
  })

  it('chains .name() and .middleware()', () => {
    const a = mw()
    const b = mw()
    Route.get('/users', ok, { middlewares: [a] }).name('users.index').middleware(b)
    const { route } = found('GET', '/users')
    expect(route.name).toBe('users.index')
    expect(route.middlewares).toEqual([a, b])
  })

  it('refuses duplicate names at compile time', () => {
    Route.get('/a', ok).name('same')
    Route.get('/b', ok).name('same')
    expect(() => Route.compile()).toThrow('Route name "same" is already used')
  })

  it('refuses the same method and path twice', () => {
    Route.get('/a', ok)
    Route.get('/a/', ok)
    expect(() => Route.compile()).toThrow('Route "GET /v1/a" is declared twice')
  })

  it('caches the compiled table until a new route is added', () => {
    Route.get('/a', ok)
    const first = Route.compile()
    expect(Route.compile()).toBe(first)
    Route.get('/b', ok)
    expect(Route.compile()).not.toBe(first)
  })
})

describe('groups', () => {
  it('concatenate prefixes, middlewares and names, outer to inner', () => {
    const outer = mw()
    const inner = mw()
    const own = mw()
    Route.group({ prefix: '/admin', middlewares: [outer], name: 'admin.' }, () => {
      Route.group({ prefix: '/users', middlewares: [inner], name: 'users.' }, () => {
        Route.get('/{id}', ok, { middlewares: [own] }).name('show')
      })
      Route.get('/stats', ok).name('stats')
    })
    Route.get('/outside', ok).name('outside')

    const { route, params } = found('GET', '/admin/users/7')
    expect(route.name).toBe('admin.users.show')
    expect(route.middlewares).toEqual([outer, inner, own])
    expect(params).toEqual({ id: '7' })
    expect(Route.url('admin.users.show', { id: 7 })).toBe('/v1/admin/users/7')
    expect(found('GET', '/admin/stats').route.middlewares).toEqual([outer])
    expect(found('GET', '/outside').route.middlewares).toEqual([])
  })

  it('accept empty options', () => {
    Route.group({}, () => {
      Route.get('/a', ok).name('a')
    })
    expect(Route.url('a')).toBe('/v1/a')
  })

  it('are closed even if the callback throws', () => {
    expect(() =>
      Route.group({ prefix: '/broken' }, () => {
        throw new Error('oops')
      }),
    ).toThrow('oops')
    Route.get('/after', ok)
    expect(found('GET', '/after').route.path).toBe('/after')
  })
})

describe('resolution', () => {
  it('prefers a static route even when the dynamic one is declared first', () => {
    Route.get('/users/{id}', handler('dynamic'))
    Route.get('/users/me', handler('static'))
    expect(found('GET', '/users/me').route.path).toBe('/users/me')
    expect(found('GET', '/users/42').params).toEqual({ id: '42' })
  })

  it('stops at the first matching dynamic route', () => {
    Route.get('/a/{x}', handler('first'))
    Route.get('/a/{y}', handler('second'))
    expect(found('GET', '/a/1').params).toEqual({ x: '1' })
  })

  it('ignores the trailing slash', () => {
    Route.get('/users', ok)
    expect(found('GET', '/users/').route.path).toBe('/users')
  })

  it('returns not_found when nothing matches', () => {
    Route.get('/users/{id}', ok)
    expect(Route.resolve('GET', '/posts')).toEqual({ kind: 'not_found', version: 'v1' })
    expect(Route.resolve('GET', '/users//').kind).toBe('not_found')
  })

  it('returns method_not_allowed with the allowed methods (static and dynamic)', () => {
    Route.get('/users', ok)
    Route.post('/users', ok)
    Route.delete('/users/{id}', ok)
    Route.put('/users/{id}', ok)
    expect(Route.resolve('PATCH', '/users')).toEqual({ kind: 'method_not_allowed', allow: ['GET', 'POST'], version: 'v1' })
    expect(Route.resolve('GET', '/users/1')).toEqual({
      kind: 'method_not_allowed',
      allow: ['DELETE', 'PUT'],
      version: 'v1',
    })
  })

  it('falls back to a dynamic route when the static path has another method', () => {
    Route.get('/users/me', ok)
    Route.delete('/users/{id}', ok)
    expect(found('DELETE', '/users/me').params).toEqual({ id: 'me' })
  })

  it('turns a malformed encoding into a 400', () => {
    Route.get('/tags/{name}', ok)
    try {
      Route.resolve('GET', '/tags/%E0%A4%A')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      if (error instanceof HttpError) expect(error.status).toBe(400)
    }
  })
})

describe('versions', () => {
  it('uses the default version for routes and requests without version', () => {
    Route.get('/users', ok)
    expect(found('GET', '/users').version).toBe('v1')
    expect(found('GET', '/v1/users').route.version).toBe('v1')
    expect(Route.resolve('GET', '/v2/users')).toEqual({ kind: 'not_found', version: 'v2' })
  })

  it('lets v1 and v2 of the same path live side by side', () => {
    Route.get('/journeys', handler('v1')).name('journeys.v1')
    Route.get('/journeys', handler('v2'), { version: 'v2' }).name('journeys.v2')
    expect(found('GET', '/journeys').route.name).toBe('journeys.v1')
    expect(found('GET', '/v1/journeys').route.name).toBe('journeys.v1')
    expect(found('GET', '/v2/journeys').route.name).toBe('journeys.v2')
    expect(found('GET', '/v2/journeys').version).toBe('v2')
  })

  it('takes the version from the innermost group, unless the route overrides it', () => {
    Route.group({ version: 'v2' }, () => {
      Route.group({ prefix: '/a' }, () => {
        Route.get('/', ok).name('a')
        Route.get('/three', ok, { version: 'v3' }).name('three')
      })
    })
    expect(Route.url('a')).toBe('/v2/a')
    expect(Route.url('three')).toBe('/v3/a/three')
  })

  it('can change the default version', () => {
    Route.get('/users', ok).name('users')
    Route.setDefaultVersion('v2')
    expect(found('GET', '/users').version).toBe('v2')
    expect(Route.url('users')).toBe('/v2/users')
  })

  it('resolves the version root', () => {
    Route.get('/', ok).name('home')
    expect(found('GET', '/v1').route.path).toBe('/')
    expect(found('GET', '/').route.path).toBe('/')
    expect(Route.url('home')).toBe('/v1')
  })
})

describe('url generation', () => {
  it('builds the URL with the version and the parameters', () => {
    Route.get('/users/{userId}/articles/{articleId}', ok).name('articles.show')
    expect(Route.url('articles.show', { userId: 1, articleId: 'abc' })).toBe('/v1/users/1/articles/abc')
  })

  it('uses the same encoding as the resolution (round trip)', () => {
    Route.get('/tags/{name}', ok).name('tags.show')
    const url = Route.url('tags.show', { name: 'a/b? c$&' })
    expect(url).toBe('/v1/tags/a%2Fb%3F%20c%24%26')
    expect(found('GET', url).params).toEqual({ name: 'a/b? c$&' })
  })

  it('handles extensions and path tails', () => {
    Route.get('/export/{name}.json', ok).name('export')
    Route.get('/files/{path*}', ok).name('files')
    expect(Route.url('export', { name: 'report' })).toBe('/v1/export/report.json')
    const url = Route.url('files', { path: 'my dir/a.png' })
    expect(url).toBe('/v1/files/my%20dir/a.png')
    expect(found('GET', url).params).toEqual({ path: 'my dir/a.png' })
  })

  it('appends query parameters', () => {
    Route.get('/journeys', ok).name('journeys')
    expect(Route.url('journeys', {}, { page: 2, q: 'a b' })).toBe('/v1/journeys?page=2&q=a+b')
  })

  it('names the route and the missing parameter', () => {
    Route.get('/users/{id}', ok).name('users.show')
    expect(() => Route.url('users.show')).toThrow('Missing parameter "id" for route "users.show"')
    expect(() => Route.url('nope')).toThrow('Route "nope" is not defined')
  })
})
