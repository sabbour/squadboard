import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Body1, Button, Caption1, Field, Input, tokens } from '@fluentui/react-components'
import type { Project } from '../../api/projects.ts'
import { useUpdateProject } from '../../api/projects.ts'

interface ProjectIdentityFormProps {
  project: Project
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ProjectIdentityForm({ project }: ProjectIdentityFormProps) {
  const updateProject = useUpdateProject(project.id)
  const [name, setName] = useState(project.name)
  const [path, setPath] = useState(project.squadPath)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(project.name)
    setPath(project.squadPath)
    setSaved(false)
    setError(null)
  }, [project.id, project.name, project.squadPath])

  const trimmedName = name.trim()
  const trimmedPath = path.trim()
  const isDirty = useMemo(
    () => trimmedName !== project.name || trimmedPath !== project.squadPath,
    [project.name, project.squadPath, trimmedName, trimmedPath],
  )
  const canSave = trimmedName.length > 0 && trimmedPath.length > 0 && isDirty && !updateProject.isPending

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave) return
    setSaved(false)
    setError(null)
    try {
      await updateProject.mutateAsync({ name: trimmedName, path: trimmedPath })
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        maxWidth: '560px',
      }}
    >
      <Field label="Project name" validationMessage={!trimmedName ? 'Project name is required.' : undefined}>
        <Input value={name} onChange={(_, data) => setName(data.value)} />
      </Field>

      <Field
        label="Squad folder path"
        hint="Point to the project folder or its .squad directory. This changes the registered path; it does not move files."
        validationMessage={!trimmedPath ? 'Squad folder path is required.' : undefined}
      >
        <Input value={path} onChange={(_, data) => setPath(data.value)} />
      </Field>

      {error && (
        <Body1 style={{ color: tokens.colorPaletteRedForeground1 }}>
          {error}
        </Body1>
      )}
      {saved && !error && (
        <Caption1 style={{ color: tokens.colorPaletteGreenForeground1 }}>
          Project settings saved.
        </Caption1>
      )}

      <div style={{ display: 'flex', gap: tokens.spacingHorizontalS }}>
        <Button type="submit" appearance="primary" disabled={!canSave}>
          {updateProject.isPending ? 'Saving...' : 'Save project settings'}
        </Button>
        <Button
          type="button"
          disabled={!isDirty || updateProject.isPending}
          onClick={() => {
            setName(project.name)
            setPath(project.squadPath)
            setError(null)
            setSaved(false)
          }}
        >
          Reset
        </Button>
      </div>
    </form>
  )
}
