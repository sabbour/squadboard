/** @deprecated Phase 10: routes redirect through App.tsx; this page no longer renders. */
import { Navigate, useParams } from 'react-router'

export default function WorkflowEditor() {
  const { id, workflowId } = useParams<{ id: string; workflowId?: string }>()
  const target = workflowId
    ? `/projects/${id}/ceremonies/${workflowId}`
    : `/projects/${id}/ceremonies/new`
  return <Navigate to={target} replace />
}
