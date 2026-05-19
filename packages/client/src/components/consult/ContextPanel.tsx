/**
 * components/consult/ContextPanel.tsx — W28 J5
 *
 * Collapsible "What context this agent has" panel.
 * Renders the coordinator context snapshot (token counts, truncation log,
 * redaction count) emitted via the `consult.context` WS event each turn.
 *
 * Design:
 *   - Accordion with a single panel; starts collapsed.
 *   - Header shows total token count and a coloured badge (green ≤6K, amber ≤8K, red >8K).
 *   - Body shows per-section breakdown + truncation log.
 */

import { useState, useEffect } from 'react'
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Badge,
  Body2,
  Caption1,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { DataBarVertical20Regular, Warning20Regular } from '@fluentui/react-icons'
import { useConsultStream } from '../../api/consult.ts'
import type { WsEventMap } from '../../realtime/ws-client.ts'

type ContextSnapshot = WsEventMap['consult.context']

const useStyles = makeStyles({
  root: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground3,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
  },
  sectionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `2px ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
  },
  sectionTruncated: {
    background: tokens.colorPaletteYellowBackground2,
  },
  sectionName: {
    flex: 1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
  },
  tokenBadge: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
  },
  truncationLog: {
    marginTop: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalXS,
    background: tokens.colorPaletteYellowBackground1,
    borderRadius: tokens.borderRadiusSmall,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    color: tokens.colorPaletteYellowForeground2,
  },
  redactionNote: {
    marginTop: tokens.spacingVerticalXS,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
  },
  panelBody: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    paddingBottom: tokens.spacingVerticalS,
  },
  progressBar: {
    height: '4px',
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralStroke2,
    marginBottom: tokens.spacingVerticalS,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
    borderRadius: tokens.borderRadiusMedium,
  },
})

const TOKEN_CAP = 8192

function tokenBadgeColor(total: number): 'success' | 'warning' | 'danger' {
  if (total <= 6000) return 'success'
  if (total <= TOKEN_CAP) return 'warning'
  return 'danger'
}

function progressFillColor(total: number): string {
  if (total <= 6000) return tokens.colorPaletteGreenBackground3
  if (total <= TOKEN_CAP) return tokens.colorPaletteYellowBackground3
  return tokens.colorPaletteRedBackground3
}

interface ContextPanelProps {
  sessionId: string | null
}

export function ContextPanel({ sessionId }: ContextPanelProps) {
  const styles = useStyles()
  const { entries: stream } = useConsultStream(sessionId)
  const [snapshot, setSnapshot] = useState<ContextSnapshot | null>(null)

  // Pick up the latest consult.context event from the stream.
  useEffect(() => {
    for (let i = stream.length - 1; i >= 0; i--) {
      if (stream[i].type === 'consult.context') {
        setSnapshot(stream[i].payload as ContextSnapshot)
        break
      }
    }
  }, [stream])

  if (!snapshot) return null

  const pct = Math.min(100, (snapshot.totalTokens / TOKEN_CAP) * 100)
  const color = tokenBadgeColor(snapshot.totalTokens)

  return (
    <div className={styles.root}>
      <Accordion collapsible defaultOpenItems={[]}>
        <AccordionItem value="ctx">
          <AccordionHeader
            icon={<DataBarVertical20Regular />}
            expandIconPosition="end"
          >
            <div className={styles.header}>
              <Body2>What context this agent has</Body2>
              <Badge
                color={color}
                size="small"
                appearance="filled"
              >
                {snapshot.totalTokens.toLocaleString()} / {TOKEN_CAP.toLocaleString()} tokens
              </Badge>
              {snapshot.redactionCount > 0 && (
                <Badge color="severe" size="small" appearance="outline">
                  {snapshot.redactionCount} redacted
                </Badge>
              )}
            </div>
          </AccordionHeader>
          <AccordionPanel>
            <div className={styles.panelBody}>
              {/* Token usage bar */}
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${pct}%`,
                    background: progressFillColor(snapshot.totalTokens),
                  }}
                />
              </div>

              {/* Per-section breakdown */}
              {snapshot.sections.map((sec, i) => (
                <div
                  key={i}
                  className={`${styles.sectionRow}${sec.truncated ? ` ${styles.sectionTruncated}` : ''}`}
                >
                  <Caption1 className={styles.sectionName}>
                    {sec.truncated && <Warning20Regular aria-label="Truncated" />}{sec.name}
                  </Caption1>
                  <Caption1 className={styles.tokenBadge}>
                    {sec.tokens.toLocaleString()} tok
                  </Caption1>
                </div>
              ))}

              {/* Truncation log */}
              {snapshot.truncationLog.length > 0 && (
                <div className={styles.truncationLog}>
                  <strong>Truncation log:</strong>
                  {snapshot.truncationLog.map((entry, i) => (
                    <div key={i}>• {entry}</div>
                  ))}
                </div>
              )}

              {/* Redaction note */}
              {snapshot.redactionCount > 0 && (
                <div className={styles.redactionNote}>
                  🔒 {snapshot.redactionCount} secret(s) redacted from context.
                </div>
              )}
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
