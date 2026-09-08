import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

// This hotfix deliberately calls the existing shared HTTP client directly.
// eslint-disable-next-line import-x/no-restricted-paths
import { wreck } from '../../common/wreck.ts'

// The migration runs synchronously inside the GAS request.
const migrationTimeoutMs = 50_000
const confirmationValue = 'APPLY_WOODLAND_MIGRATION'

interface GasRequestOptions {
  headers?: Record<string, string>
  payload?: Record<string, unknown>
}

const gasRequest = (path: string, options: GasRequestOptions) =>
  wreck.post(`${process.env.GAS_API_URL}${path}`, {
    ...options,
    json: true,
    headers: {
      Authorization: `Bearer ${process.env.GAS_SERVICE_TOKEN}`,
      ...options.headers
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
    confirmationValue,
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

const echoedDryRun = (payload: Record<string, unknown>) => ({
  valid: true,
  failures: 0,
  agreements: payload.expectedAgreements,
  versions: payload.expectedVersions,
  sourceChecksum: payload.sourceChecksum
})

export const woodlandMigrationRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/operations/woodland-migration/dry-run',
    options: { auth },
    async handler(request: Request, h: ResponseToolkit) {
      try {
        const { res, payload } = await gasRequest(
          '/admin/migrations/woodland/dry-run',
          {}
        )

        if (res.statusCode! >= 400) {
          return renderOperations(request, h, {
            migrationError: gasErrorMessage(payload, res.statusCode!)
          })
        }

        return renderOperations(request, h, { dryRun: payload })
      } catch (error) {
        request.logger.error(error)
        return renderOperations(request, h, {
          migrationError: 'Dry-run request to GAS failed.'
        })
      }
    }
  },
  {
    method: 'POST',
    path: '/operations/woodland-migration/apply',
    options: { auth },
    async handler(request: Request, h: ResponseToolkit) {
      const requestPayload = request.payload as Record<string, unknown>
      const payload = {
        confirmation: requestPayload.confirmation,
        expectedAgreements: Number(requestPayload.expectedAgreements),
        expectedVersions: Number(requestPayload.expectedVersions),
        sourceChecksum: requestPayload.sourceChecksum
      }
      const dryRun = echoedDryRun(requestPayload)

      try {
        const { res, payload: result } = await gasRequest(
          '/admin/migrations/woodland/apply',
          { payload }
        )

        if (res.statusCode! >= 400) {
          return renderOperations(request, h, {
            dryRun,
            migrationError: gasErrorMessage(result, res.statusCode!)
          })
        }

        return renderOperations(request, h, { applyResult: result })
      } catch (error) {
        request.logger.error(error)
        return renderOperations(request, h, {
          dryRun,
          migrationError: 'Apply request to GAS failed.'
        })
      }
    }
  }
]
