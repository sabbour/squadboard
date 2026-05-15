import { useState } from 'react'
import type { Project } from '../api/projects.ts'
import { useDeleteProject } from '../api/projects.ts'
import { ClipboardTaskListLtr20Regular } from '@fluentui/react-icons'
import {
  Card,
  CardHeader,
  Button,
  Caption1,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { Delete20Regular } from '@fluentui/react-icons'

interface ProjectCardProps {
  project: Project
  onClick: () => void
}

const useStyles = makeStyles({
  card: {
    cursor: 'pointer',
    width: '100%',
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
    padding: `0 ${tokens.spacingHorizontalM} ${tokens.spacingVerticalM}`,
  },
})

export default function ProjectCard({ project, onClick }: ProjectCardProps) {
  const [hovered, setHovered] = useState(false)
  const { mutate: deleteProject, isPending: isDeleting } = useDeleteProject()
  const styles = useStyles()

  const createdDate = new Date(project.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    if (window.confirm('Remove this project from Squadboard? The files will not be deleted.')) {
      deleteProject(project.id)
    }
  }

  return (
    <Card
      className={styles.card}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <CardHeader
        image={<ClipboardTaskListLtr20Regular />}
        header={
          <Text weight="semibold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </Text>
        }
        action={
          hovered ? (
            <Button
              appearance="transparent"
              icon={<Delete20Regular />}
              size="small"
              onClick={handleRemove}
              disabled={isDeleting}
              title="Remove from Squadboard"
              style={{ color: isDeleting ? undefined : tokens.colorPaletteRedForeground1 }}
            />
          ) : undefined
        }
      />
      <div className={styles.metaRow}>
        <Caption1
          style={{
            fontFamily: 'monospace',
            color: tokens.colorNeutralForeground3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {project.squadPath}
        </Caption1>
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
          Created {createdDate}
        </Caption1>
      </div>
    </Card>
  )
}
