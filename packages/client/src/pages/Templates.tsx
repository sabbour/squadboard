/**
 * Templates.tsx — Workload template catalog (Phase 10+).
 *
 * Displays the built-in ceremony/workflow templates so users can browse
 * before creating a ceremony.  Handles loading, empty-catalog, and API-error
 * states without ever throwing or rendering a stack trace.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  Subtitle1,
  Body1,
  Caption1,
  Button,
  Spinner,
  tokens,
  makeStyles,
} from '@fluentui/react-components'
import { useCeremonyTemplates } from '../api/ceremonies.ts'
import PageHeader from '../components/layout/PageHeader.tsx'

const useStyles = makeStyles({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: tokens.spacingVerticalL,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXXL}`,
  },
  card: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXS,
  },
  tag: {
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    borderRadius: tokens.borderRadiusMedium,
    padding: `2px ${tokens.spacingHorizontalS}`,
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalM,
    padding: '80px 24px',
    textAlign: 'center',
  },
})

export default function Templates() {
  const styles = useStyles()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: templates, isLoading, isError, error } = useCeremonyTemplates()

  function handleRetry() {
    void queryClient.invalidateQueries({ queryKey: ['ceremony-templates'] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <PageHeader
        title="Workload Templates"
        description="Built-in ceremony templates — pick one to jump-start a new workflow."
      />

      {isLoading && (
        <div className={styles.center}>
          <Spinner size="medium" />
          <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading templates…</Body1>
        </div>
      )}

      {isError && (
        <div className={styles.center}>
          <Subtitle1 style={{ color: tokens.colorPaletteRedForeground1 }}>
            Couldn't load templates — try again
          </Subtitle1>
          {error && (
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {error instanceof Error ? error.message : String(error)}
            </Caption1>
          )}
          <Button appearance="primary" onClick={handleRetry}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (!templates || templates.length === 0) && (
        <div className={styles.center}>
          <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
            No workload templates yet.
          </Body1>
        </div>
      )}

      {!isLoading && !isError && templates && templates.length > 0 && (
        <div className={styles.grid}>
          {templates.map((tpl) => (
            <div key={tpl.slug} className={styles.card}>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>{tpl.name}</span>
              {tpl.description && (
                <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                  {tpl.description}
                </Caption1>
              )}
              {tpl.tags && tpl.tags.length > 0 && (
                <div className={styles.tagRow}>
                  {tpl.tags.map((tag) => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                </div>
              )}
              <Button
                appearance="outline"
                size="small"
                style={{ alignSelf: 'flex-end', marginTop: tokens.spacingVerticalXS }}
                onClick={() => navigate(`/ceremonies/new?template=${tpl.slug}`)}
              >
                Use template
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
