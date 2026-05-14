import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface Label {
  id: string
  projectId: string
  name: string
  color: string
}

export interface CreateLabelInput {
  name: string
  color: string
}

export function useLabels(projectId: string) {
  return useQuery<Label[]>({
    queryKey: ['labels', projectId],
    queryFn: () => apiFetch<Label[]>(`/api/projects/${projectId}/labels`),
    enabled: Boolean(projectId),
  })
}

export function useCreateLabel(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<Label, Error, CreateLabelInput>({
    mutationFn: (input) =>
      apiFetch<Label>(`/api/projects/${projectId}/labels`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['labels', projectId] })
    },
  })
}
