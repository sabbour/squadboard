import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { MemoryRouter, Route, Routes } from 'react-router'
import Skills from '../Skills'

const apiMock = vi.hoisted(() => ({
  project: { id: 'project-1', name: 'Feature Kanban' },
  skills: [] as Array<{
    id: string
    projectId: string
    key: string
    name: string
    description: string | null
    category: string | null
    promptAddendum: string
    curatedKey: string | null
    source: 'curated' | 'imported' | 'custom' | 'project'
    sourceUri: string | null
    createdAt: string
    updatedAt: string
  }>,
  curatedSkills: [] as Array<{
    key: string
    name: string
    description: string
    category: string
    promptAddendum: string
  }>,
  mutation: {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null as Error | null,
  },
}))

vi.mock('../../api/projects.ts', () => ({
  useProject: () => ({ data: apiMock.project }),
}))

vi.mock('../../api/skills.ts', () => ({
  useSkills: () => ({ data: apiMock.skills, isLoading: false }),
  useCuratedSkills: () => ({ data: apiMock.curatedSkills, isLoading: false }),
  useDeleteSkill: () => apiMock.mutation,
  useImportSkillFromMd: () => apiMock.mutation,
  useCloneCuratedSkill: () => apiMock.mutation,
  useCreateSkill: () => apiMock.mutation,
  useUpdateSkill: () => apiMock.mutation,
  useFormulateSkill: () => apiMock.mutation,
}))

function renderSkills() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={['/projects/project-1/skills']}>
        <Routes>
          <Route path="/projects/:id/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  )
}

describe('Skills page', () => {
  beforeEach(() => {
    apiMock.skills = []
    apiMock.curatedSkills = []
    apiMock.mutation.mutate.mockReset()
    apiMock.mutation.mutateAsync.mockReset()
    apiMock.mutation.isPending = false
    apiMock.mutation.error = null
  })

  it('surfaces imported SKILL.md source and clickable content instead of prompt-addendum jargon', () => {
    apiMock.skills = [{
      id: 'skill-1',
      projectId: 'project-1',
      key: 'prd-writing',
      name: 'PRD Writing',
      description: 'Write concise PRDs with testable requirements, metrics, risks, and rollout plans.',
      category: 'product-management',
      promptAddendum: [
        '---',
        'name: prd-writing',
        'description: Produce concise PRDs that connect customer problems to requirements and launch criteria.',
        '---',
        '',
        '## PRD sections',
        '',
        '1. Summary',
        '2. Customer problem',
        '3. Target users and scenarios',
      ].join('\n'),
      curatedKey: null,
      source: 'imported',
      sourceUri: 'bundle:feature-kanban/skills/prd-writing/SKILL.md',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }]

    renderSkills()

    expect(screen.getByText('PRD Writing')).toBeInTheDocument()
    expect(screen.getByText(/bundle:feature-kanban\/skills\/prd-writing\/SKILL\.md/)).toBeInTheDocument()
    expect(screen.getByText('View imported SKILL.md content')).toBeInTheDocument()
    expect(screen.getByText(/## PRD sections/)).toBeInTheDocument()
    expect(screen.queryByText('Prompt addendum')).not.toBeInTheDocument()
  })
})
