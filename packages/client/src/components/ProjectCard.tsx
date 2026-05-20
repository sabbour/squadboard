import { useState } from 'react'
import type { Project } from '../api/projects.ts'
import { useDeleteProject } from '../api/projects.ts'
import { ClipboardTaskListLtr20Regular } from '@fluentui/react-icons'
import {
  Card,
  CardHeader,
  Button,
  Badge,
  Caption1,
  Checkbox,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { Delete20Regular } from '@fluentui/react-icons'

interface ProjectCardProps {
  project: Project
  onClick: () => void
  selectable?: boolean
  selected?: boolean
  onSelectedChange?: (selected: boolean) => void
}

const useStyles = makeStyles({
  card: {
    cursor: 'pointer',
    width: '100%',
    height: '100%',
    minHeight: '150px',
    display: 'flex',
    flexDirection: 'column',
    alignSelf: 'stretch',
    // Wave 10 B4: hover treatment must NOT change the bounding box. The
    // previous behaviour scaled the tile (Fluent's default Card hover plus an
    // implicit transform) which pushed neighbouring grid cells around. Lock
    // the layout dimensions and use elevation for the hover affordance — same
    // visual feedback, zero reflow.
    transform: 'none',
    transition: `box-shadow ${tokens.durationFast} ${tokens.curveEasyEase}`,
    ':hover': {
      transform: 'none',
      boxShadow: tokens.shadow16,
    },
    ':focus-visible': {
      transform: 'none',
    },
    ':active': {
      transform: 'none',
    },
  },
  metaRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginTop: 'auto',
    padding: `0 ${tokens.spacingHorizontalM} ${tokens.spacingVerticalM}`,
  },
})

function isTestWorkspace(project: Project): boolean {
  return project.squadPath.includes('/.e2e-workspaces/')
    || project.squadPath.includes('\\.e2e-workspaces\\')
    || /\be2e\b/i.test(project.name)
}

function projectFolder(project: Project): string {
  return project.squadPath.replace(/[\\/]?\.squad[\\/]?$/, '')
}

export default function ProjectCard({
  project,
  onClick,
  selectable = false,
  selected = false,
  onSelectedChange,
}: ProjectCardProps) {
  const [hovered, setHovered] = useState(false)
  const { mutate: deleteProject, isPending: isDeleting } = useDeleteProject()
  const styles = useStyles()
  const testWorkspace = isTestWorkspace(project)
  const folder = projectFolder(project)
  const hasSquadFolder = project.squadPath.endsWith('.squad')

  const createdDate = new Date(project.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    if (window.confirm('Remove this project from Squadboard? The files will not be deleted.')) {
      deleteProject(
        { id: project.id },
        {
          onError: (err) => {
            window.alert(err instanceof Error ? err.message : 'Could not remove project from Squadboard.')
          },
        },
      )
    }
  }

  return (
    <Card
      className={styles.card}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderColor: selected ? tokens.colorBrandStroke1 : undefined,
        boxShadow: selected ? tokens.shadow8 : undefined,
      }}
    >
      <CardHeader
        image={<ClipboardTaskListLtr20Regular />}
        header={
          <Text weight="semibold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </Text>
        }
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS }}>
            {selectable && (
              <Checkbox
                checked={selected}
                aria-label={`Select ${project.name}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(_, data) => onSelectedChange?.(data.checked === true)}
              />
            )}
            {hovered && (
              <Button
                appearance="transparent"
                icon={<Delete20Regular />}
                size="small"
                onClick={handleRemove}
                disabled={isDeleting}
                title="Remove from Squadboard"
                style={{ color: isDeleting ? undefined : tokens.colorPaletteRedForeground1 }}
              />
            )}
          </div>
        }
      />
      <div className={styles.metaRow}>
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalXS, flexWrap: 'wrap' }}>
          {testWorkspace && <Badge appearance="tint" color="warning" size="small">Test workspace</Badge>}
          <Badge
            appearance="tint"
            color={hasSquadFolder ? 'success' : 'subtle'}
            size="small"
            title={hasSquadFolder
              ? 'This project points to a .squad folder on disk. CLI/Copilot can share this project when they use the same folder or connect through the Squadboard broker.'
              : 'This project has a folder path, but it does not currently point at a .squad directory.'}
          >
            {hasSquadFolder ? 'Local .squad folder' : 'Folder path set'}
          </Badge>
        </div>
        <Caption1
          style={{
            fontFamily: 'monospace',
            color: tokens.colorNeutralForeground3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {folder}
        </Caption1>
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
          Created {createdDate}
        </Caption1>
      </div>
    </Card>
  )
}
