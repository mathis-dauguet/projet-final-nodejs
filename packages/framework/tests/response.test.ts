import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  escapeHtml,
  getSerializer,
  html,
  json,
  noContent,
  registerSerializer,
  resetSerializers,
  respond,
  text,
  toPayload,
  writePayload,
  xml,
  type Payload,
} from '../src/core/response'

afterEach(() => resetSerializers())

describe('helpers', () => {
  it('build responses with a format', () => {
    expect(json({ a: 1 })).toEqual({ status: 200, headers: {}, body: { a: 1 }, format: 'json' })
    expect(json({ a: 1 }, 201, { location: '/a' })).toEqual({
      status: 201,
      headers: { location: '/a' },
      body: { a: 1 },
      format: 'json',
    })
    expect(text('hi').format).toBe('text')
    expect(html('<p>hi</p>').format).toBe('html')
    expect(xml({ a: 1 }).format).toBe('xml')
    expect(respond('csv', 'a,b', 202).status).toBe(202)
    expect(noContent()).toEqual({ status: 204, headers: {}, body: undefined, format: 'json' })
  })
})

describe('serializers', () => {
  it('serializes JSON', () => {
    expect(getSerializer('json').serialize({ a: [1, 'b'] })).toBe('{"a":[1,"b"]}')
  })

  it('serializes text and HTML (strings as is, other values as JSON)', () => {
    expect(getSerializer('text').serialize('hello')).toBe('hello')
    expect(getSerializer('text').serialize({ a: 1 })).toBe('{"a":1}')
    expect(getSerializer('html').serialize('<b>x</b>')).toBe('<b>x</b>')
  })

  it('serializes XML with escaping, arrays, null and invalid tag names', () => {
    const output = getSerializer('xml').serialize({
      title: 'a < b & "c"',
      tags: ['x', 'y'],
      empty: null,
      'bad key': 1,
      '1st': true,
    })
    expect(output).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><response>' +
        '<title>a &lt; b &amp; &quot;c&quot;</title>' +
        '<tags><item>x</item><item>y</item></tags>' +
        '<empty/><bad_key>1</bad_key><_1st>true</_1st>' +
        '</response>',
    )
  })

  it('is open to new formats', () => {
    registerSerializer('csv', { contentType: 'text/csv', serialize: (body) => String(body) })
    expect(toPayload(respond('csv', 'a,b'))).toEqual({
      status: 200,
      headers: { 'content-type': 'text/csv' },
      body: 'a,b',
    })
  })

  it('throws on an unknown format', () => {
    expect(() => getSerializer('yaml')).toThrow('No serializer registered for format "yaml"')
  })

  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})

describe('toPayload', () => {
  it('lets the controller override headers (lower-cased)', () => {
    const payload = toPayload(json({ ok: true }, 200, { 'Content-Type': 'application/vnd.api+json', 'X-A': '1' }))
    expect(payload.headers).toEqual({ 'content-type': 'application/vnd.api+json', 'x-a': '1' })
    expect(payload.body).toBe('{"ok":true}')
  })

  it('sends no body and no content-type for 204, 304 and undefined bodies', () => {
    expect(toPayload(noContent())).toEqual({ status: 204, headers: {}, body: undefined })
    expect(toPayload(json({ a: 1 }, 304)).body).toBeUndefined()
    expect(toPayload(json(undefined, 200)).body).toBeUndefined()
  })

  it('keeps Buffers and streams untouched', () => {
    const buffer = Buffer.from('raw')
    const stream = Readable.from(['a'])
    expect(toPayload(json(buffer)).body).toBe(buffer)
    expect(toPayload(json(stream)).body).toBe(stream)
  })
})

/** Démarre un vrai serveur qui écrit `payload`, et renvoie la réponse reçue. */
const serve = async (write: (res: ServerResponse) => Promise<void>): Promise<Response> => {
  const server = createServer((_req, res) => void write(res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    return await fetch(`http://127.0.0.1:${port}/`)
  } finally {
    server.closeAllConnections()
    server.close()
  }
}

describe('writePayload', () => {
  const payload = (body: Payload['body']): Payload => ({ status: 200, headers: { 'x-test': '1' }, body })

  it('writes a string body', async () => {
    const response = await serve((res) => writePayload(res, payload('hello')))
    expect(response.headers.get('x-test')).toBe('1')
    expect(await response.text()).toBe('hello')
  })

  it('streams a Readable body', async () => {
    const response = await serve((res) => writePayload(res, payload(Readable.from(['a', 'b', 'c']))))
    expect(await response.text()).toBe('abc')
  })

  it('destroys the socket when the stream fails', async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error('disk error'))
      },
    })
    await expect(
      serve((res) => writePayload(res, payload(failing))).then((response) => response.text()),
    ).rejects.toThrow()
  })

  it('never writes twice', async () => {
    const response = await serve(async (res) => {
      res.writeHead(201).end('first')
      await writePayload(res, payload('second'))
    })
    expect(response.status).toBe(201)
    expect(await response.text()).toBe('first')
  })
})
