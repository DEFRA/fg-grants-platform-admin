import {
  Binary,
  BSON,
  BSONRegExp,
  BSONSymbol,
  Code,
  Decimal128,
  Double,
  EJSON,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID
} from 'bson'

import { readDocument, toEjson, toIdText, toPrinted } from './explore-bson.ts'
import type { BsonValue, Stored } from './explore-bson.ts'
import type { DocText } from '../views/components/core/doc.ts'

const hex = '6741a0c2e4b0f1a2b3c4d5e6'

const bytesOf = (document: object): Uint8Array =>
  BSON.serialize(document, { ignoreUndefined: false })

/** BSON written by hand, for what the driver can't write: an element is its type, its key, then its value's bytes. */
const element = (type: number, key: string, value: Buffer): Buffer =>
  Buffer.concat([Buffer.from([type]), Buffer.from(`${key}\0`, 'latin1'), value])

const rawDocument = (...elements: Buffer[]): Buffer => {
  const body = Buffer.concat([...elements, Buffer.from([0])])
  const size = Buffer.alloc(4)

  size.writeInt32LE(body.length + 4)

  return Buffer.concat([size, body])
}

const int32 = (n: number): Buffer => {
  const bytes = Buffer.alloc(4)

  bytes.writeInt32LE(n)

  return bytes
}

const int64 = (n: bigint): Buffer => {
  const bytes = Buffer.alloc(8)

  bytes.writeBigInt64LE(n)

  return bytes
}

const stringValue = (text: Buffer): Buffer =>
  Buffer.concat([int32(text.length + 1), text, Buffer.from([0])])

const cString = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf8')

const ejsonOf = (bytes: Uint8Array): string => toEjson(readDocument(bytes))

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype

/** What an `{ $explore: … }` object stands for: one key, the escape's name, and what it holds. */
const innerOf = (value: unknown): unknown => {
  const object = isPlainObject(value) ? value : {}

  return Object.keys(object).length === 1 ? object.$explore : null
}

const escapeOf = (value: unknown): [string, unknown] | null => {
  const inner = innerOf(value)

  return isPlainObject(inner) ? Object.entries(inner)[0] : null
}

/** A key as stored: its text, or the bytes a `utf8` escape holds. */
const keyBytes = (key: unknown): Buffer => {
  const escaped = escapeOf(key)

  return escaped
    ? Buffer.concat([
        Buffer.from(String(escaped[1]), 'base64'),
        Buffer.from([0])
      ])
    : Buffer.from(`${String(key)}\0`, 'utf8')
}

/** A value's BSON element under a key given as bytes; one with no escape in it as the driver writes it. */
const elementOf = (key: Buffer, value: unknown): Buffer => {
  const [kind, held] = escapeOf(value) ?? ['', null]
  const typed: Record<string, () => Buffer> = {
    utf8: () =>
      Buffer.concat([
        Buffer.from([2]),
        key,
        stringValue(Buffer.from(String(held), 'base64'))
      ]),
    list: () =>
      Buffer.concat([
        Buffer.from([4]),
        key,
        documentOf(held as [unknown, unknown][])
      ]),
    bson: () => {
      const whole = Buffer.from(String(held), 'base64')

      return Buffer.concat([
        whole.subarray(4, 5),
        key,
        whole.subarray(7, whole.length - 1)
      ])
    },
    entries: () =>
      Buffer.concat([
        Buffer.from([3]),
        key,
        documentOf(held as [unknown, unknown][])
      ])
  }

  return (typed[kind] ?? (() => plainElement(key, value)))()
}

const plainElement = (key: Buffer, value: unknown): Buffer => {
  if (Array.isArray(value)) {
    return Buffer.concat([
      Buffer.from([4]),
      key,
      documentOf(value.map((item, n) => [String(n), item]))
    ])
  }

  if (isPlainObject(value)) {
    return Buffer.concat([
      Buffer.from([3]),
      key,
      documentOf(Object.entries(value))
    ])
  }

  const one = Buffer.from(BSON.serialize({ x: value }))

  return Buffer.concat([
    one.subarray(4, 5),
    key,
    one.subarray(7, one.length - 1)
  ])
}

/** A document's BSON from its entries, each key as text or a `utf8` escape: what a reader of the file writes back. */
const documentOf = (entries: [unknown, unknown][]): Buffer =>
  rawDocument(...entries.map(([key, value]) => elementOf(keyBytes(key), value)))

/** The file's text read back as a reader would: canonical Extended JSON, every escape undone, written again as BSON. */
const readBack = (text: string): Uint8Array => {
  const parsed: unknown = EJSON.parse(text, { relaxed: false })
  const [kind, held] = escapeOf(parsed) ?? ['', null]

  return kind === 'entries'
    ? documentOf(held as [unknown, unknown][])
    : documentOf(Object.entries(parsed as Record<string, unknown>))
}

const entriesOf = (value: Stored): [DocText, BsonValue][] => {
  const printed = toPrinted(value)

  return printed.t === 'object' ? printed.entries : []
}

describe('readDocument', () => {
  test.each<[string, unknown, BsonValue]>([
    ['text', 'it’s', { t: 'string', v: 'it’s' }],
    ['an Int32', new Int32(5), { t: 'int32', v: 5 }],
    [
      'an Int64',
      Long.fromString('9007199254740993'),
      { t: 'int64', v: '9007199254740993' }
    ],
    ['a Double', new Double(5), { t: 'double', v: 5 }],
    ['minus zero', new Double(-0), { t: 'double', v: -0 }],
    ['not a number', new Double(NaN), { t: 'double', v: NaN }],
    ['infinity', new Double(-Infinity), { t: 'double', v: -Infinity }],
    ['a Decimal128', new Decimal128('1.10'), { t: 'decimal128', v: '1.10' }],
    ['true', true, { t: 'bool', v: true }],
    ['null', null, { t: 'null' }],
    ['a date before 1970', new Date(-1), { t: 'date', v: '-1' }],
    ['an ObjectId', new ObjectId(hex), { t: 'objectId', v: hex }],
    [
      'binary',
      new Binary(Buffer.from('hi'), 0),
      { t: 'binary', v: 'aGk=', sub: 0 }
    ],
    [
      'a UUID',
      new UUID('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'),
      { t: 'binary', v: 'Dx4tPEtaaXiHlqW0w9Lh8A==', sub: 4 }
    ],
    [
      'user binary',
      new Binary(Buffer.from([1]), 128),
      { t: 'binary', v: 'AQ==', sub: 128 }
    ],
    [
      'a timestamp',
      new Timestamp({ t: 5, i: 2 }),
      { t: 'timestamp', ts: 5, i: 2 }
    ],
    [
      'a pattern',
      new BSONRegExp('a/b', 'i'),
      { t: 'regex', pattern: 'a/b', flags: 'i' }
    ],
    ['MinKey', new MinKey(), { t: 'minKey' }],
    ['MaxKey', new MaxKey(), { t: 'maxKey' }],
    ['code', new Code('x()'), { t: 'javascript', code: 'x()' }],
    [
      'code with its scope',
      new Code('x()', { a: 1 }),
      {
        t: 'javascriptWithScope',
        code: 'x()',
        scope: { t: 'object', entries: [['a', { t: 'int32', v: 1 }]] }
      }
    ],
    ['a symbol', new BSONSymbol('s'), { t: 'symbol', v: 's' }],
    [
      'a list',
      [1, 'a', []],
      {
        t: 'array',
        items: [
          { t: 'int32', v: 1 },
          { t: 'string', v: 'a' },
          { t: 'array', items: [] }
        ]
      }
    ]
  ])('reads %s with its type', (_, value, typed) => {
    expect(entriesOf(readDocument(bytesOf({ a: value })))).toEqual([
      ['a', typed]
    ])
  })

  test('keeps every key in stored order, `__proto__`, `constructor`, dotted, empty and $ keys among them', () => {
    const stored = rawDocument(
      element(16, 'z', int32(1)),
      element(16, '__proto__', int32(2)),
      element(16, 'constructor', int32(3)),
      element(16, 'a.b', int32(4)),
      element(16, '', int32(5)),
      element(16, '$schema', int32(6))
    )

    expect(entriesOf(readDocument(stored)).map(([key]) => key)).toEqual([
      'z',
      '__proto__',
      'constructor',
      'a.b',
      '',
      '$schema'
    ])
  })

  test('reads a list 20 deep', () => {
    const deep = Array.from({ length: 19 }).reduce<unknown>(
      (inner) => [inner],
      [1]
    )
    let value = toPrinted(readDocument(bytesOf({ a: deep })))

    for (let n = 0; n < 21; n += 1) {
      value =
        value.t === 'object'
          ? value.entries[0][1]
          : (value as { items: BsonValue[] }).items[0]
    }

    expect(value).toEqual({ t: 'int32', v: 1 })
  })

  test('throws for bytes that aren’t BSON', () => {
    expect(() => readDocument(Buffer.from('AAAA', 'base64'))).toThrow(
      /BSON|size|length|offset/i
    )
  })
})

describe('what the driver would change, as stored', () => {
  test('a date past what JavaScript holds, as its int64', () => {
    const stored = rawDocument(
      element(9, 'at', int64(9_000_000_000_000_000_000n))
    )

    expect(entriesOf(readDocument(stored))).toEqual([
      ['at', { t: 'date', v: '9000000000000000000' }]
    ])
    expect(ejsonOf(stored)).toBe(
      '{"at":{"$date":{"$numberLong":"9000000000000000000"}}}'
    )
  })

  test('BSON undefined, kept as undefined', () => {
    const stored = rawDocument(element(6, 'u', Buffer.alloc(0)))

    expect(ejsonOf(stored)).toBe('{"u":{"$undefined":true}}')
  })

  test('a DBPointer, its namespace and ObjectId', () => {
    const stored = rawDocument(
      element(
        12,
        'p',
        Buffer.concat([
          stringValue(Buffer.from('db.cases')),
          Buffer.from(hex, 'hex')
        ])
      )
    )

    expect(entriesOf(readDocument(stored))).toEqual([
      ['p', { t: 'dbPointer', ns: 'db.cases', id: hex }]
    ])
    expect(ejsonOf(stored)).toBe(
      `{"p":{"$dbPointer":{"$ref":"db.cases","$id":{"$oid":"${hex}"}}}}`
    )
  })

  test('a key stored twice, both times', () => {
    const stored = rawDocument(
      element(16, 'a', int32(1)),
      element(16, 'a', int32(2))
    )

    expect(ejsonOf(stored)).toBe(
      '{"a":{"$numberInt":"1"},"a":{"$numberInt":"2"}}'
    )
  })

  test('a list whose keys aren’t its places, its items in stored order', () => {
    const list = rawDocument(
      element(16, '5', int32(1)),
      element(16, 'x', int32(2))
    )
    const stored = rawDocument(element(4, 'l', list))

    expect(ejsonOf(stored)).toBe(
      '{"l":{"$explore":{"list":[["5",{"$numberInt":"1"}],["x",{"$numberInt":"2"}]]}}}'
    )
    expect(readBack(ejsonOf(stored))).toEqual(stored)
  })

  test('regex flags as stored, not sorted', () => {
    const stored = rawDocument(
      element(11, 'r', Buffer.concat([cString('^a'), cString('mi')]))
    )

    expect(entriesOf(readDocument(stored))).toEqual([
      ['r', { t: 'regex', pattern: '^a', flags: 'mi' }]
    ])
    expect(ejsonOf(stored)).toBe(
      '{"r":{"$regularExpression":{"pattern":"^a","options":"mi"}}}'
    )
  })

  test('text that isn’t UTF-8, said with its bytes', () => {
    const stored = rawDocument(
      element(2, 's', stringValue(Buffer.from([0x61, 0xff, 0x62])))
    )

    expect(entriesOf(readDocument(stored))).toEqual([
      ['s', { t: 'invalid', text: 'a�b', bytes: 3 }]
    ])
    expect(ejsonOf(stored)).toBe('{"s":{"$explore":{"utf8":"Yf9i"}}}')
    expect(readBack(ejsonOf(stored))).toEqual(stored)
  })

  test('a key that isn’t UTF-8, decoded and flagged, its bytes back from the file', () => {
    const key = Buffer.from([0x6b, 0xfe])
    const stored = rawDocument(
      Buffer.concat([Buffer.from([16]), key, Buffer.from([0]), int32(1)]),
      element(16, 'b', int32(2))
    )

    expect(entriesOf(readDocument(stored)).map(([name]) => name)).toEqual([
      { text: 'k�', bytes: 2 },
      'b'
    ])
    expect(ejsonOf(stored)).toBe(
      '{"$explore":{"entries":[[{"$explore":{"utf8":"a/4="}},{"$numberInt":"1"}],["b",{"$numberInt":"2"}]]}}'
    )
    expect(readBack(ejsonOf(stored))).toEqual(stored)
  })

  test.each<[string, Buffer, BsonValue]>([
    [
      'a pattern',
      element(
        11,
        'r',
        Buffer.concat([Buffer.from([0x61, 0xff, 0]), cString('i')])
      ),
      { t: 'regex', pattern: { text: 'a�', bytes: 2 }, flags: 'i' }
    ],
    [
      'code',
      element(13, 'c', stringValue(Buffer.from([0xff]))),
      { t: 'javascript', code: { text: '�', bytes: 1 } }
    ],
    [
      'a symbol',
      element(14, 's', stringValue(Buffer.from([0xff]))),
      { t: 'symbol', v: { text: '�', bytes: 1 } }
    ],
    [
      'a namespace',
      element(
        12,
        'p',
        Buffer.concat([
          stringValue(Buffer.from([0xff])),
          Buffer.from(hex, 'hex')
        ])
      ),
      { t: 'dbPointer', ns: { text: '�', bytes: 1 }, id: hex }
    ],
    [
      'a key in code’s scope',
      element(
        15,
        'w',
        (() => {
          const code = stringValue(Buffer.from('x'))
          const scope = rawDocument(
            element(2, 'a', stringValue(Buffer.from([0x61]))),
            Buffer.concat([Buffer.from([16]), Buffer.from([0xff, 0]), int32(1)])
          )

          return Buffer.concat([
            int32(4 + code.length + scope.length),
            code,
            scope
          ])
        })()
      ),
      {
        t: 'javascriptWithScope',
        code: 'x',
        scope: {
          t: 'object',
          entries: [
            ['a', { t: 'string', v: 'a' }],
            [
              { text: '�', bytes: 1 },
              { t: 'int32', v: 1 }
            ]
          ]
        }
      }
    ]
  ])(
    'prints %s that isn’t UTF-8 decoded, with its bytes for the printout to flag',
    (_, stored, printed) => {
      expect(entriesOf(readDocument(rawDocument(stored)))[0]?.[1]).toEqual(
        printed
      )
    }
  )

  test.each([
    [
      'a pattern',
      element(
        11,
        'r',
        Buffer.concat([Buffer.from([0x61, 0xff, 0]), cString('i')])
      )
    ],
    [
      'flags',
      element(11, 'r', Buffer.concat([cString('a'), Buffer.from([0xff, 0])]))
    ],
    ['code', element(13, 'c', stringValue(Buffer.from([0xff])))],
    ['a symbol', element(14, 's', stringValue(Buffer.from([0xff])))],
    [
      'a namespace',
      element(
        12,
        'p',
        Buffer.concat([
          stringValue(Buffer.from([0xff])),
          Buffer.from(hex, 'hex')
        ])
      )
    ],
    [
      'code with its scope',
      element(
        15,
        'w',
        (() => {
          const code = stringValue(Buffer.from([0xff]))
          const scope = rawDocument(element(16, 'a', int32(1)))

          return Buffer.concat([
            int32(4 + code.length + scope.length),
            code,
            scope
          ])
        })()
      )
    ]
  ])(
    'writes %s that isn’t UTF-8 as its BSON, which reads back as stored',
    (_, value) => {
      const stored = rawDocument(value, element(16, 'n', int32(1)))
      const text = ejsonOf(stored)

      expect(text).toMatch(
        /^\{"[a-z]":\{"\$explore":\{"bson":"[A-Za-z0-9+/=]+"\}\},"n":/
      )
      expect(readBack(text)).toEqual(stored)
    }
  )

  test('keeps a leading byte-order mark, in a key and in text, on the page and in the file', () => {
    const stored = bytesOf({ '\ufeffk': '\ufeffv' })

    expect(entriesOf(readDocument(stored))).toEqual([
      ['\ufeffk', { t: 'string', v: '\ufeffv' }]
    ])
    expect(ejsonOf(stored)).toBe('{"\ufeffk":"\ufeffv"}')
    expect(readBack(ejsonOf(stored))).toEqual(stored)
  })

  test('prints text that is UTF-8 as plain text', () => {
    expect(
      entriesOf(
        readDocument(
          bytesOf({
            a: 'é',
            r: new BSONRegExp('é', 'i'),
            c: new Code('é', { k: 'é' })
          })
        )
      )
    ).toEqual([
      ['a', { t: 'string', v: 'é' }],
      ['r', { t: 'regex', pattern: 'é', flags: 'i' }],
      [
        'c',
        {
          t: 'javascriptWithScope',
          code: 'é',
          scope: { t: 'object', entries: [['k', { t: 'string', v: 'é' }]] }
        }
      ]
    ])
  })

  test('a DBRef shape with $db after other keys, an object as stored, escaped', () => {
    const stored = bytesOf({
      link: { other: 1, $ref: 'cases', $id: new ObjectId(hex), $db: 'cw' }
    })

    expect(ejsonOf(stored)).toBe(
      `{"link":{"$explore":{"entries":[["other",{"$numberInt":"1"}],["$ref","cases"],["$id",{"$oid":"${hex}"}],["$db","cw"]]}}}`
    )
    expect(readBack(ejsonOf(stored))).toEqual(stored)
  })

  test('a stored $explore, escaped, so the file’s last item is never a stored key', () => {
    const stored = bytesOf({ $explore: { stopped: 'rows' } })

    expect(ejsonOf(stored)).toBe(
      '{"$explore":{"entries":[["$explore",{"stopped":"rows"}]]}}'
    )
    expect(readBack(ejsonOf(stored))).toEqual(stored)
  })

  test('keys `document` and `context`, as stored, inside the item’s own', () => {
    const stored = bytesOf({ document: 1, context: 2 })

    expect(ejsonOf(stored)).toBe(
      '{"document":{"$numberInt":"1"},"context":{"$numberInt":"2"}}'
    )
  })
})

describe('toEjson', () => {
  test.each<[string, unknown, string]>([
    ['an Int32', new Int32(5), '{"$numberInt":"5"}'],
    ['a whole Double', new Double(5), '{"$numberDouble":"5.0"}'],
    ['minus zero', new Double(-0), '{"$numberDouble":"-0.0"}'],
    ['not a number', new Double(NaN), '{"$numberDouble":"NaN"}'],
    ['infinity', new Double(Infinity), '{"$numberDouble":"Infinity"}'],
    ['an Int64', Long.fromString('-5'), '{"$numberLong":"-5"}'],
    ['a Decimal128', new Decimal128('1.10'), '{"$numberDecimal":"1.10"}'],
    ['a date', new Date(-1), '{"$date":{"$numberLong":"-1"}}'],
    ['an ObjectId', new ObjectId(hex), `{"$oid":"${hex}"}`],
    [
      'user binary',
      new Binary(Buffer.from([1]), 128),
      '{"$binary":{"base64":"AQ==","subType":"80"}}'
    ],
    [
      'a timestamp',
      new Timestamp({ t: 5, i: 2 }),
      '{"$timestamp":{"t":5,"i":2}}'
    ],
    ['MinKey', new MinKey(), '{"$minKey":1}'],
    ['MaxKey', new MaxKey(), '{"$maxKey":1}'],
    ['code', new Code('x()'), '{"$code":"x()"}'],
    [
      'code with its scope',
      new Code('x()', { a: 1 }),
      '{"$code":"x()","$scope":{"a":{"$numberInt":"1"}}}'
    ],
    ['a symbol', new BSONSymbol('s'), '{"$symbol":"s"}'],
    ['null', null, 'null'],
    ['text with quotes and a line break', 'a"\nb', '"a\\"\\nb"']
  ])('writes %s canonically', (_, value, text) => {
    expect(ejsonOf(bytesOf({ a: value }))).toBe(`{"a":${text}}`)
  })

  test('reads back, through EJSON.parse, to the stored bytes for every type the driver writes', () => {
    const stored = bytesOf({
      _id: new ObjectId(hex),
      int: new Int32(5),
      long: Long.fromString('9007199254740993'),
      double: new Double(5),
      negativeZero: new Double(-0),
      nan: new Double(NaN),
      infinity: new Double(Infinity),
      decimal: new Decimal128('1.10'),
      before1970: new Date(-86_400_000),
      after9999: new Date(253_402_300_800_000),
      bin0: new Binary(Buffer.from('hi'), 0),
      uuid: new UUID('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'),
      bin128: new Binary(Buffer.from([1, 2]), 128),
      ts: new Timestamp({ t: 5, i: 2 }),
      re: new BSONRegExp('^a', 'i'),
      min: new MinKey(),
      max: new MaxKey(),
      none: null,
      code: new Code('x()'),
      scope: new Code('x()', { a: 1 }),
      symbol: new BSONSymbol('s'),
      __proto__: 1,
      constructor: 2,
      'a.b': 3,
      '': 4,
      unicode: 'ünïcødé 🌳',
      parcels: Array.from({ length: 3552 }, (_, n) => ({ n })),
      $schema: 'x',
      ref: { $ref: '#/a' },
      dbRef: { $ref: 'cases', $id: new ObjectId(hex) }
    })

    expect(readBack(ejsonOf(stored))).toEqual(stored)
  })

  test.each([
    '$oid',
    '$date',
    '$numberInt',
    '$numberLong',
    '$numberDouble',
    '$numberDecimal',
    '$binary',
    '$uuid',
    '$regularExpression',
    '$timestamp',
    '$code',
    '$scope',
    '$symbol',
    '$minKey',
    '$maxKey',
    '$undefined',
    '$dbPointer',
    '$regex',
    '$explore'
  ])(
    'escapes an object with the key %s, which reads back to its stored keys',
    (key) => {
      const stored = bytesOf({ field: { before: 1, [key]: 'x' } })
      const text = ejsonOf(stored)

      expect(text).toBe(
        `{"field":{"$explore":{"entries":[["before",{"$numberInt":"1"}],[${JSON.stringify(key)},"x"]]}}}`
      )
      expect(readBack(text)).toEqual(stored)
    }
  )

  test('escapes $ref only with $id, leaving a JSON Schema $ref as stored', () => {
    expect(ejsonOf(bytesOf({ items: { $ref: '#/$defs/a' } }))).toBe(
      '{"items":{"$ref":"#/$defs/a"}}'
    )
  })
})

/** As GAS sends a record's `_id`: base64 BSON of `{ _id }`. */
const idOf = (_id: unknown) =>
  Buffer.from(BSON.serialize({ _id })).toString('base64')

/** A date's milliseconds written into its BSON by hand, as `bson` won't make one past JavaScript's range. */
const dateIdOf = (ms: bigint) => {
  const bytes = Buffer.from(BSON.serialize({ _id: new Date(0) }))

  bytes.writeBigInt64LE(ms, 9)

  return bytes.toString('base64')
}

describe('toIdText', () => {
  test.each([
    [
      'an ObjectId',
      idOf(new ObjectId('6741a0c2e4b0f1a2b3c4d5e6')),
      "ObjectId('6741a0c2e4b0f1a2b3c4d5e6')"
    ],
    ['text, escaped', idOf("WMP-it's\nnext"), "'WMP-it\\'s\\\nnext'"],
    ['an Int32', idOf(new Int32(5)), '5'],
    ['a Double', idOf(new Double(1.5)), '1.5'],
    ['minus zero', idOf(new Double(-0)), '-0'],
    ['infinity', idOf(Infinity), 'Infinity'],
    ['not a number', idOf(NaN), 'NaN'],
    [
      'a Long past a double',
      idOf(Long.fromString('9007199254740993')),
      "Long('9007199254740993')"
    ],
    [
      'a date',
      idOf(new Date('2026-11-20T10:00:00.000Z')),
      "ISODate('2026-11-20T10:00:00.000Z')"
    ],
    [
      'a date past what a date shows',
      dateIdOf(9_000_000_000_000_000n),
      "ISODate('Invalid Date')"
    ],
    ['a Decimal128', idOf(new Decimal128('1.10')), "Decimal128('1.10')"],
    [
      'binary',
      idOf(new Binary(Buffer.from('hi'), 0)),
      "Binary.createFromBase64('aGk=', 0)"
    ],
    [
      'old binary, its inner length left out',
      idOf(new Binary(Buffer.from('hi'), 2)),
      "Binary.createFromBase64('aGk=', 2)"
    ],
    [
      'a UUID',
      idOf(new UUID('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0')),
      "UUID('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0')"
    ],
    [
      'a timestamp',
      idOf(new Timestamp({ t: 5, i: 2 })),
      'Timestamp({ t: 5, i: 2 })'
    ],
    ['a pattern', idOf(new BSONRegExp('a/b', 'i')), '/a\\/b/i'],
    [
      'a pattern, its escapes kept and line breaks escaped',
      idOf({ p: new BSONRegExp('a\\/b\nc', 'm') }),
      '{ p: /a\\/b\\nc/m }'
    ],
    [
      'a pattern, an escaped line break as its escape',
      idOf({ p: new BSONRegExp('a\\\nb\\\\\nc', '') }),
      '{ p: /a\\nb\\\\\\nc/ }'
    ],
    ['MinKey', idOf(new MinKey()), 'MinKey()'],
    ['MaxKey', idOf(new MaxKey()), 'MaxKey()'],
    ['code', idOf(new Code('x()')), "Code('x()')"],
    [
      'code with its scope',
      idOf(new Code('x()', { a: 1 })),
      "Code('x()', { a: 1 })"
    ],
    ['a symbol', idOf(new BSONSymbol('s')), "BSONSymbol('s')"],
    ['true', idOf(true), 'true'],
    ['null', idOf(null), 'null'],
    [
      'an object, its keys bare unless they need quotes',
      idOf({ a: 1, $b: [1, 'x'], 'c-d': {} }),
      "{ a: 1, '$b': [1, 'x'], 'c-d': {} }"
    ],
    [
      'bytes that aren’t BSON, without failing',
      'AAAA',
      '(not readable as BSON)'
    ]
  ])('writes %s as mongosh does', (_, id, text) => {
    expect(toIdText(id)).toBe(text)
  })
})
