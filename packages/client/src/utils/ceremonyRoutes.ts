export function ceremonyRunsPath(projectId: string, ceremonyId: string): string {
  return `/projects/${projectId}/ceremonies/${ceremonyId}/runs`
}

export function issueRunLivePath(projectId: string, issueId: string, issueRunId: string): string {
  return `/projects/${projectId}/issues/${issueId}/runs/${issueRunId}/live`
}
