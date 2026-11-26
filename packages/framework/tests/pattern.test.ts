import { describe, expect, it } from 'vitest'
import { compilePattern, encodeParam, extractParams, normalizePath } from '../src/routing/pattern'

/** Teste un chemin contre un motif ; null si pas de correspondance. */
const match = (pattern: string, path: string): Record<string, string> | null => {
  const compiled = compilePattern(pattern)
  const result = compiled.regex.exec(path)
  return result === null ? null : extractParams(compiled, result)
}

describe('normalizePath', () => {
  it('adds the leading slash and removes the trailing one', () => {
    expect(normalizePath('users')).toBe('/users')
    expect(normalizePath('/users/')).toBe('/users')
    expect(normalizePath('')).toBe('/')
    expect(normalizePath('/')).toBe('/')
  })
})

describe('compilePattern', () => {
  it('compares literals exactly', () => {
    const compiled = compilePattern('/users')
    expect(compiled.isStatic).toBe(true)
    expect(match('/users', '/users')).toEqual({})
    expect(match('/users', '/Users')).toBeNull()
    expect(match('/users', '/users/1')).toBeNull()
    expect(match('/a.b', '/axb')).toBeNull()
  })

  it('matches a single parameter, never empty', () => {
    const compiled = compilePattern('/users/{id}')
    expect(compiled.isStatic).toBe(false)
    expect(compiled.paramNames).toEqual(['id'])
    expect(match('/users/{id}', '/users/42')).toEqual({ id: '42' })
    expect(match('/users/{id}', '/users/')).toBeNull()
    expect(match('/users/{id}', '/users//')).toBeNull()
    expect(match('/users/{id}', '/users/42/extra')).toBeNull()
  })

  it('matches several parameters on different segments', () => {
    expect(match('/users/{userId}/articles/{articleId}', '/users/1/articles/2')).toEqual({
      userId: '1',
      articleId: '2',
    })
  })

  it('matches a parameter followed by a fixed extension', () => {
    expect(match('/export/{name}.json', '/export/report.json')).toEqual({ name: 'report' })
    expect(match('/export/{name}.json', '/export/a.b.json')).toEqual({ name: 'a.b' })
    expect(match('/export/{name}.json', '/export/report.xml')).toBeNull()
    expect(match('/export/{name}.json', '/export/.json')).toBeNull()
  })

  it('matches a whole path tail with separators', () => {
    const compiled = compilePattern('/files/{path*}')
    expect(compiled.wildcard).toBe('path')
    expect(match('/files/{path*}', '/files/a/b/c.png')).toEqual({ path: 'a/b/c.png' })
    expect(match('/files/{path*}', '/files/')).toBeNull()
  })

  it('decodes parameters, keeping encoded separators inside the segment', () => {
    expect(match('/tags/{name}', '/tags/a%2Fb%3F%20c')).toEqual({ name: 'a/b? c' })
    expect(match('/files/{path*}', '/files/dir%20x/a%2Fb')).toEqual({ path: 'dir x/a/b' })
  })

  it('throws on malformed encoding', () => {
    expect(() => match('/tags/{name}', '/tags/%E0%A4%A')).toThrow(URIError)
  })

  it('rejects invalid patterns', () => {
    expect(() => compilePattern('/a/{id}/b/{id}')).toThrow('Duplicate parameter "{id}"')
    expect(() => compilePattern('/files/{path*}/edit')).toThrow('must be a whole last segment')
    expect(() => compilePattern('/files/x{path*}')).toThrow('must be a whole last segment')
    expect(() => compilePattern('/users/{id')).toThrow('Invalid parameter syntax')
    expect(() => compilePattern('/users/{a-b}')).toThrow('Invalid parameter syntax')
  })
})

describe('encodeParam', () => {
  it('encodes a value into a single segment', () => {
    expect(encodeParam('a/b? c', false)).toBe('a%2Fb%3F%20c')
  })

  it('keeps the separators of a path tail', () => {
    expect(encodeParam('dir x/a.png', true)).toBe('dir%20x/a.png')
  })
})
