import { useState } from 'react'
import type { Project } from '../api/projects.ts'
import { useDeleteProject } from '../api/projects.ts'
import { ClipboardTaskListLtr20Regular } from '@fluentui/react-icons'

interface ProjectCardProps {
  project: Project
  onClick: () => void
}

export default function ProjectCard({ project, onClick }: ProjectCardProps) {
  const [hovered, setHovered] = useState(false)
  const { mutate: deleteProject, isPending: isDeleting } = useDeleteProject()

  const createdDate = new Date(project.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    if (
      window.confirm('Remove this project from Squadboard? The files will not be deleted.')
    ) {
      deleteProject(project.id)
    }
  }

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onClick}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '16px',
          color: 'var(--text)',
          textAlign: 'left',
          width: '100%',
          cursor: 'pointer',
          transition: 'border-color 0.1s ease',
          borderColor: hovered ? 'var(--accent)' : 'var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
          <ClipboardTaskListLtr20Regular style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: '15px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </span>
        </div>

        <p
          style={{
            fontFamily: 'monospace',
            fontSize: '11px',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
        >
          {project.squadPath}
        </p>

        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 'auto' }}>
          Created {createdDate}
        </p>
      </button>

      {/* Remove button — appears on hover */}
      <button
        onClick={handleRemove}
        disabled={isDeleting}
        title="Remove from Squadboard"
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          display: hovered ? 'flex' : 'none',
          alignItems: 'center',
          gap: '4px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '3px 8px',
          fontSize: '11px',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          opacity: isDeleting ? 0.5 : 1,
          lineHeight: 1.4,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger, #cf222e)'
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--danger, #cf222e)'
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
        }}
      >
        ✕ Remove
      </button>
    </div>
  )
}
