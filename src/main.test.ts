import process from 'node:process'

import { main, onUnhandledRejection } from './main.ts'
import { logger } from './common/logger.ts'
import { devOps } from './dev-ops/index.ts'
import { grantOps } from './grant-ops/index.ts'

const server = { register: vi.fn(), start: vi.fn() }

vi.mock(import('./server/index.ts'), () => ({
  createServer: vi.fn(async () => server as never)
}))

vi.mock(import('./common/logger.ts'))

describe('main', () => {
  test('starts a server holding the domain modules', async () => {
    await main()

    expect(server.register).toHaveBeenCalledWith([devOps, grantOps])
    expect(server.start).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      'Server started at http://localhost:3000'
    )
  })

  test('handles a rejection nothing else did', () => {
    const error = new Error('Nothing awaited this')

    onUnhandledRejection(error)

    expect(logger.info).toHaveBeenCalledWith('Unhandled rejection')
    expect(logger.error).toHaveBeenCalledWith(error)
    expect(process.exitCode).toBe(1)
  })
})
