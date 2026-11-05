import { randomBytes } from 'node:crypto'

import { generateToken } from './generate-token.ts'

vi.mock(import('node:crypto'), { spy: true })

describe('generateToken', () => {
  // The vector both backends hash a presented token to: if it ever differs,
  // every token this app issues is one neither service can find.
  test('hashes the token as GAS and Caseworking do', () => {
    vi.mocked(randomBytes).mockReturnValueOnce(Buffer.alloc(32, 7) as never)

    expect(generateToken()).toEqual({
      raw: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
      hash: 'dc4bf80c77473d130fa0de86ba4018fe98bb214005e6a5891d12ba91446f9e81',
      hint: 'HBwc'
    })
  })

  // The same vector fg-cw-backend pins in public-api.test.js, so all three
  // services provably hash a token the same way.
  test('hashes the shared FGP-1572 vector as Caseworking does', () => {
    vi.mocked(randomBytes).mockReturnValueOnce(
      Buffer.from('fgp-1572-hash-vector', 'base64url') as never
    )

    expect(generateToken()).toEqual({
      raw: 'fgp-1572-hash-vector',
      hash: '95ef91517beb2901c394cf3294bcbe82077e432cd1aac452bca75b6988fe06cb',
      hint: 'ctor'
    })
  })

  test('draws 256 random bits', () => {
    generateToken()

    expect(randomBytes).toHaveBeenCalledWith(32)
  })

  test('makes a base64url token whose hint is its last 4 characters', () => {
    const { raw, hash, hint } = generateToken()

    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(hint).toBe(raw.slice(-4))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('makes a different token every time', () => {
    expect(generateToken().raw).not.toBe(generateToken().raw)
  })
})
