import { describe, expect, it } from 'vitest'
import * as framework from '../src/index'

describe('framework', () => {
  it('exposes an importable module', () => {
    expect(framework).toBeTypeOf('object')
  })
})
