import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

// This hotfix deliberately calls the existing shared HTTP client directly.
// eslint-disable-next-line import-x/no-restricted-paths
import { wreck } from '../../common/wreck.ts'

// The migration runs synchronously inside the GAS request.
const migrationTimeoutMs = 50_000

const gasRequest = (path: string) =>
  wreck.post(`${process.env.GAS_API_URL}${path}`, {
    json: true,
    headers: {
      Authorization: `Bearer ${process.env.GAS_SERVICE_TOKEN}`
    },
    timeout: migrationTimeoutMs
  })

const renderOperations = (
  request: Request,
  h: ResponseToolkit,
  extra: Record<string, unknown>
) =>
  h.view('index', {
    pageTitle: 'Operations Admin',
    heading: 'Operations Admin',
    name: request.auth.credentials.user.name,
    ...extra
  })

const gasErrorMessage = (payload: unknown, statusCode: number) => {
  const message = (payload as { message?: unknown } | null)?.message

  return typeof message === 'string'
    ? message
    : `GAS request failed with status ${statusCode}.`
}

const auth = {
  strategy: 'session',
  scope: ['FCP.GrantOperationsAdmin']
}

const migrationRoute = ({
  name,
  path,
  gasPath
}: {
  name: 'dryRun' | 'catchUpResult'
  path: string
  gasPath: string
}): ServerRoute => ({
  method: 'POST',
  path,
  options: { auth },
  async handler(request: Request, h: ResponseToolkit) {
    try {
      const { res, payload } = await gasRequest(gasPath)

      if (res.statusCode! >= 400) {
        return renderOperations(request, h, {
          migrationError: gasErrorMessage(payload, res.statusCode!)
        })
      }

      return renderOperations(request, h, { [name]: payload })
    } catch (error) {
      request.logger.error(error)
      return renderOperations(request, h, {
        migrationError: `${name === 'dryRun' ? 'Dry-run' : 'Catch-up'} request to GAS failed.`
      })
    }
  }
})

export const woodlandMigrationRoutes: ServerRoute[] = [
  migrationRoute({
    name: 'dryRun',
    path: '/operations/woodland-migration/dry-run',
    gasPath: '/admin/migrations/woodland/dry-run'
  }),
  migrationRoute({
    name: 'catchUpResult',
    path: '/operations/woodland-migration/catch-up',
    gasPath: '/admin/migrations/woodland/catch-up'
  })
]
