// Routes that still make more than one GAS call; each later PR removes its own, and none is added.
export const pendingOneCall: string[] = [
  'GET /dev-ops/{path*}',
  'POST /dev-ops/{path*}',
  'POST /dev-ops/events/{service}/{box}/{id}/purge',
  'POST /dev-ops/events/{service}/{box}/{id}/payload',
  'GET /dev-ops/workflows/{code}/{version}',
  'POST /dev-ops/clients/{service}/tokens',
  'POST /dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/rotate',
  'POST /dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/expiry',
  'POST /dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/revoke',
  'POST /dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/delete'
]
