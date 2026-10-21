const workflowsPath = '/dev-ops/workflows'

export const toWorkflowHref = ({
  code,
  version
}: {
  code: string
  version: string
}): string =>
  `${workflowsPath}/${encodeURIComponent(code)}/${encodeURIComponent(version)}`
