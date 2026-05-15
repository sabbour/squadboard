/**
 * api/workflows.ts — DEPRECATED Phase 10 shim.
 *
 * Re-exports the new ceremony hooks under their legacy names so any
 * call site that hasn't been migrated yet continues to compile and run.
 * New code MUST import from './ceremonies.ts'.
 *
 * Slated for removal once all importers are migrated.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'
import {
  useCeremonies,
  useCeremony,
  useCreateCeremony,
  useUpdateCeremony,
  useDeleteCeremony,
  useRunCeremony,
  useCeremonyTemplates,
  useStartCeremony,
  useCeremonyRun,
  type Ceremony,
  type CeremonyTemplate,
  type WorkflowRun,
} from './ceremonies.ts'

/** @deprecated Use Ceremony from api/ceremonies. */
export type Workflow = Ceremony
/** @deprecated Use CeremonyTemplate from api/ceremonies. */
export type WorkflowTemplate = CeremonyTemplate
/** @deprecated WorkflowRun is unchanged but lives in api/ceremonies now. */
export type { WorkflowRun }

/** @deprecated Use useCeremonies. */
export const useWorkflows = useCeremonies
/** @deprecated Use useCeremony. */
export const useWorkflow = useCeremony
/** @deprecated Use useCreateCeremony. */
export const useCreateWorkflow = useCreateCeremony
/** @deprecated Use useUpdateCeremony. */
export const useUpdateWorkflow = useUpdateCeremony
/** @deprecated Use useDeleteCeremony. */
export const useDeleteWorkflow = useDeleteCeremony
/** @deprecated Use useRunCeremony. */
export const useRunWorkflow = useRunCeremony
/** @deprecated Use useCeremonyTemplates. */
export const useWorkflowTemplates = useCeremonyTemplates
/** @deprecated Use useStartCeremony. */
export const useStartWorkflow = useStartCeremony
/** @deprecated Use useCeremonyRun. */
export const useWorkflowRun = useCeremonyRun

/**
 * @deprecated Legacy attach signature kept exact for backward compat.
 * Use useAttachCeremony from api/ceremonies.ts in new code.
 */
export function useAttachWorkflow(projectId: string, issueId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { workflowId: string }>({
    mutationFn: ({ workflowId }) =>
      apiFetch<void>(`/api/projects/${projectId}/issues/${issueId}/workflow`, {
        method: 'PUT',
        body: JSON.stringify({ workflowId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })
}
