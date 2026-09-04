export const statusCodes = {
  ok: 200,
  noContent: 204,
  found: 302,
  // A POST that changed something answers 303, so the browser follows it
  // with a GET and a reload never re-submits the action.
  seeOther: 303,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  imATeapot: 418,
  internalServerError: 500,
  badGateway: 502,
  serviceUnavailable: 503
}
