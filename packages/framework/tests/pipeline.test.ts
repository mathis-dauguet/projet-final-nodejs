import { describe, expect, it } from 'vitest'
import { compose } from '../src/core/pipeline'
import { json } from '../src/core/response'
import type { Context, Middleware } from '../src/core/types'
import { testConfig } from './helpers'

// Le pipeline ne lit pas req/res : un contexte minimal suffit.
const fakeContext = (): Context => ({
  req: undefined as never,
  res: undefined as never,
  method: 'GET',
  path: '/',
  headers: {},
  ip: '',
  params: {},
  query: new URLSearchParams(),
  version: 'v1',
  route: undefined,
  body: undefined,
  state: {},
  config: testConfig(),
})

const tracer = (log: string[], name: string): Middleware => async (_ctx, next) => {
  log.push(`${name} before`)
  const response = await next()
  log.push(`${name} after`)
  return response
}

describe('compose', () => {
  it('runs as an onion: control comes back after next()', async () => {
    const log: string[] = []
    const run = compose([tracer(log, 'a'), tracer(log, 'b')], () => {
      log.push('handler')
      return json('done')
    })
    const response = await run(fakeContext())
    expect(response.body).toBe('done')
    expect(log).toEqual(['a before', 'b before', 'handler', 'b after', 'a after'])
  })

  it('lets a middleware change the response after the handler', async () => {
    const addHeader: Middleware = async (_ctx, next) => {
      const response = await next()
      return { ...response, headers: { ...response.headers, 'x-after': 'yes' } }
    }
    const response = await compose([addHeader], () => json({}))(fakeContext())
    expect(response.headers).toEqual({ 'x-after': 'yes' })
  })

  it('works with zero middleware', async () => {
    const response = await compose([], () => json('alone'))(fakeContext())
    expect(response.body).toBe('alone')
  })

  it('lets a middleware stop the chain without throwing', async () => {
    const log: string[] = []
    const stop: Middleware = () => json({ error: 'stopped' }, 401)
    const response = await compose([stop, tracer(log, 'never')], () => {
      log.push('handler')
      return json('x')
    })(fakeContext())
    expect(response.status).toBe(401)
    expect(log).toEqual([])
  })

  it('shares the context between middlewares and handler', async () => {
    const setUser: Middleware = (ctx, next) => {
      ctx.state.user = 'alice'
      return next()
    }
    const response = await compose([setUser], ({ state }) => json(state.user))(fakeContext())
    expect(response.body).toBe('alice')
  })

  it('propagates an error thrown after next() to the caller', async () => {
    const failAfter: Middleware = async (_ctx, next) => {
      await next()
      throw new Error('after next')
    }
    await expect(compose([failAfter], () => json('ok'))(fakeContext())).rejects.toThrow('after next')
  })

  it('lets an outer middleware catch an inner error', async () => {
    const catcher: Middleware = async (_ctx, next) => {
      try {
        return await next()
      } catch {
        return json('caught', 500)
      }
    }
    const response = await compose([catcher], () => {
      throw new Error('sync error')
    })(fakeContext())
    expect(response.body).toBe('caught')
  })

  it('turns synchronous and asynchronous errors into rejections', async () => {
    const syncThrow: Middleware = () => {
      throw new Error('sync')
    }
    await expect(compose([syncThrow], () => json('x'))(fakeContext())).rejects.toThrow('sync')
    await expect(
      compose([], async () => {
        await Promise.resolve()
        throw new Error('async')
      })(fakeContext()),
    ).rejects.toThrow('async')
  })

  it('refuses next() called twice', async () => {
    const twice: Middleware = async (_ctx, next) => {
      await next()
      return next()
    }
    await expect(compose([twice], () => json('x'))(fakeContext())).rejects.toThrow('next() called multiple times')
  })
})
