// Routes that still make more than one GAS call; each later PR removes its own, and none is added.
export const pendingOneCall: string[] = [
  'POST /dev-ops/clients/{service}/tokens',
  'POST /dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/rotate',
  'POST /dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/expiry',
  'POST /dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/revoke',
  'POST /dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/delete'
]
