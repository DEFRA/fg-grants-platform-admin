const grantsPath = '/dev-ops/grants'

export const toGrantHref = ({
  code,
  version
}: {
  code: string
  version: string
}): string =>
  `${grantsPath}/${encodeURIComponent(code)}/${encodeURIComponent(version)}`
