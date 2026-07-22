/**
 * A stub rather than an automock: pino writes its log methods onto the instance
 * as plain functions, so automocking leaves them untouched. Building the real
 * logger also fails once config is mocked out from under it.
 *
 * Add methods here as tests need them.
 */
export const logger = {
  info: vi.fn(),
  error: vi.fn()
}
