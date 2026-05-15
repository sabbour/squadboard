/** @deprecated Phase 10: routes redirect through App.tsx; this page no longer renders. */
import { Navigate, useParams } from 'react-router'

export default function Workflows() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/projects/${id}/ceremonies`} replace />
}
