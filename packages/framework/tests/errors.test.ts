import { describe, expect, it } from 'vitest'
import { errorBody, errorToResponse, HttpError } from '../src/core/errors'

describe('HttpError', () => {
  it('stores status, code, details and headers', () => {
    const error = new HttpError(422, 'VALIDATION_ERROR', 'Invalid body', { email: 'required' }, { 'x-a': '1' })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('HttpError')
    expect(error.status).toBe(422)
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.message).toBe('Invalid body')
    expect(error.details).toEqual({ email: 'required' })
    expect(error.headers).toEqual({ 'x-a': '1' })
  })

  it('has null details and no headers by default', () => {
    const error = new HttpError(404, 'NOT_FOUND', 'Not found')
    expect(error.details).toBeNull()
    expect(error.headers).toEqual({})
  })
})

describe('errorBody', () => {
  it('builds the unique error format', () => {
    expect(errorBody('X', 'msg')).toEqual({ error: { code: 'X', message: 'msg', details: null } })
    expect(errorBody('X', 'msg', [1])).toEqual({ error: { code: 'X', message: 'msg', details: [1] } })
  })
})

describe('errorToResponse', () => {
  it('converts an HttpError with its status and headers', () => {
    const response = errorToResponse(new HttpError(405, 'METHOD_NOT_ALLOWED', 'No', null, { allow: 'GET' }), true)
    expect(response).toEqual({
      status: 405,
      headers: { allow: 'GET' },
      body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'No', details: null } },
      format: 'json',
    })
  })

  it('shows the internal message outside production', () => {
    const response = errorToResponse(new Error('db exploded'), false)
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'db exploded', details: null } })
  })

  it('hides the internal message in production', () => {
    const response = errorToResponse(new Error('password=1234'), true)
    expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error', details: null } })
  })

  it('handles values that are not errors', () => {
    expect(errorToResponse('boom', false).body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error', details: null },
    })
  })
})
