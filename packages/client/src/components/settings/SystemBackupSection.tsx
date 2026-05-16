/**
 * SystemBackupSection — W17 Deliverable 1 (w16-restore-ui)
 *
 * Renders the Backup and Restore sections on the Settings page.
 *
 * Backup:
 *   - Lists backups from GET /api/system/backups
 *   - "Back up now" → POST /api/system/backup → toast on success
 *   - Shows next scheduled time (from config, read-only) and retention setting
 *
 * Restore:
 *   - "Restore from backup" button → Dialog
 *   - Radio list of backups (default = most recent)
 *   - Warning MessageBar with safety invariants
 *   - Checkbox confirmation required before Submit
 *   - POST /api/system/restore → spinner → reload on success
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Body1,
  Caption1,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  tokens,
} from '@fluentui/react-components'
import {
  ArrowCounterclockwise20Regular,
  CloudArrowUp20Regular,
  Database20Regular,
  Warning20Regular,
} from '@fluentui/react-icons'
import { apiFetch } from '../../api/client.ts'
import { SectionLoading } from '../loading/index.tsx'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BackupEntry {
  filename: string
  path: string
  sizeBytes: number
  sizeMB: number
  createdAt: string
}

interface BackupsResponse {
  ok: boolean
  backups: BackupEntry[]
}

interface BackupNowResponse {
  ok: boolean
  path: string
  sizeMB: number
  durationMs: number
  pruned: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function fmtSize(mb: number): string {
  return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`
}

// ── BackupList ────────────────────────────────────────────────────────────────

function BackupList({
  backups,
  selectedPath,
  onSelect,
  radioMode,
}: {
  backups: BackupEntry[]
  selectedPath: string | null
  onSelect?: (path: string) => void
  radioMode: boolean
}) {
  if (backups.length === 0) {
    return (
      <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
        No backups found in ~/.squadboard/backups/.
      </Caption1>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {backups.map((b) => {
        const isSelected = selectedPath === b.path
        return (
          <div
            key={b.path}
            onClick={() => onSelect?.(b.path)}
            role={radioMode ? 'radio' : undefined}
            aria-checked={radioMode ? isSelected : undefined}
            tabIndex={radioMode ? 0 : undefined}
            onKeyDown={radioMode ? (e) => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(b.path) } : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              borderRadius: '6px',
              border: `1px solid ${isSelected && radioMode ? tokens.colorBrandStroke1 : 'var(--border)'}`,
              background: isSelected && radioMode ? 'rgba(56,139,253,0.07)' : 'var(--surface)',
              cursor: radioMode ? 'pointer' : 'default',
              transition: 'border-color 0.12s, background 0.12s',
            }}
          >
            {radioMode && (
              <div
                style={{
                  width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${isSelected ? tokens.colorBrandBackground : tokens.colorNeutralStroke1}`,
                  background: isSelected ? tokens.colorBrandBackground : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {isSelected && (
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'white' }} />
                )}
              </div>
            )}
            <Database20Regular style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Caption1
                style={{
                  display: 'block',
                  fontFamily: tokens.fontFamilyMonospace,
                  color: tokens.colorNeutralForeground1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {b.filename}
              </Caption1>
              <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                {fmtDate(b.createdAt)} · {fmtSize(b.sizeMB)}
              </Caption1>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── RestoreDialog ─────────────────────────────────────────────────────────────

function RestoreDialog({
  open,
  backups,
  onClose,
}: {
  open: boolean
  backups: BackupEntry[]
  onClose: () => void
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    backups.length > 0 ? backups[0]!.path : null,
  )
  const [understood, setUnderstood] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const restore = useMutation({
    mutationFn: async (backupPath: string) => {
      const res = await apiFetch('/api/system/restore', {
        method: 'POST',
        body: JSON.stringify({ backupPath }),
      })
      return res as { ok: boolean; message?: string; error?: string; rollbackPath?: string }
    },
    onSuccess: (data) => {
      if (data.ok) {
        // Full page reload — daemon restart will invalidate all state
        setTimeout(() => { window.location.reload() }, 800)
      } else {
        setRestoreError(data.error ?? data.message ?? 'Restore failed')
      }
    },
    onError: (err) => {
      setRestoreError(err instanceof Error ? err.message : 'Restore failed')
    },
  })

  function handleSubmit() {
    if (!selectedPath || !understood) return
    setRestoreError(null)
    restore.mutate(selectedPath)
  }

  const canSubmit = !!selectedPath && understood && !restore.isPending

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open && !restore.isPending) onClose() }}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>Restore from backup</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>

            {/* Backup selection */}
            {backups.length === 0 ? (
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No backups available.</Caption1>
            ) : (
              <>
                <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                  Select a backup to restore:
                </Caption1>
                <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <BackupList
                    backups={backups}
                    selectedPath={selectedPath}
                    onSelect={setSelectedPath}
                    radioMode
                  />
                </div>
              </>
            )}

            {/* Warning block */}
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>⚠️ Restoring will:</MessageBarTitle>
                <ul style={{ margin: '6px 0 0', paddingLeft: '18px', lineHeight: 1.6 }}>
                  <li>Stop the Squadboard daemon</li>
                  <li>Move your current data to <code style={{ fontFamily: tokens.fontFamilyMonospace }}>~/.squadboard/data/pglite.pre-restore-&#123;timestamp&#125;/</code></li>
                  <li>Replace it with the selected backup</li>
                  <li>Restart the daemon</li>
                </ul>
                <p style={{ margin: '8px 0 0' }}>
                  The pre-restore copy is preserved so you can roll back manually.
                  Restore is irreversible from the UI — do it knowing.
                </p>
              </MessageBarBody>
            </MessageBar>

            {/* Confirmation checkbox */}
            <Checkbox
              id="restore-understand"
              label="I understand. Restore."
              checked={understood}
              onChange={(_, d) => setUnderstood(!!d.checked)}
            />

            {/* Loading / error states */}
            {restore.isPending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Spinner size="tiny" />
                <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                  Restoring… this may take a few seconds.
                </Caption1>
              </div>
            )}
            {restoreError && (
              <MessageBar intent="error">
                <MessageBarBody>{restoreError}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              onClick={onClose}
              disabled={restore.isPending}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              disabled={!canSubmit}
              onClick={handleSubmit}
              icon={restore.isPending ? <Spinner size="tiny" /> : <ArrowCounterclockwise20Regular />}
            >
              {restore.isPending ? 'Restoring…' : 'Restore'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

// ── SystemBackupSection (main export) ─────────────────────────────────────────

export function SystemBackupSection() {
  const queryClient = useQueryClient()
  const [showRestoreDialog, setShowRestoreDialog] = useState(false)
  const [backupToast, setBackupToast] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery<BackupsResponse>({
    queryKey: ['system', 'backups'],
    queryFn: () => apiFetch('/api/system/backups') as Promise<BackupsResponse>,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const backupNow = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/system/backup', { method: 'POST' }) as Promise<BackupNowResponse>
    },
    onSuccess: (result) => {
      setBackupError(null)
      const name = result.path.split('/').pop() ?? result.path
      setBackupToast(`Backup complete: ${name} (${fmtSize(result.sizeMB)}, ${result.durationMs}ms)`)
      setTimeout(() => setBackupToast(null), 7000)
      void queryClient.invalidateQueries({ queryKey: ['system', 'backups'] })
    },
    onError: (err) => {
      setBackupError(err instanceof Error ? err.message : 'Backup failed')
      setTimeout(() => setBackupError(null), 8000)
    },
  })

  const backups = data?.backups ?? []

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    gap: '16px',
    flexWrap: 'wrap',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 620 }}>

      {/* ── Backup actions ── */}
      <div style={rowStyle}>
        <div>
          <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>Back up now</Body1>
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            Create a snapshot of the live PGlite cluster to ~/.squadboard/backups/.
          </Caption1>
        </div>
        <Button
          appearance="secondary"
          icon={backupNow.isPending ? <Spinner size="tiny" /> : <CloudArrowUp20Regular />}
          disabled={backupNow.isPending}
          onClick={() => { setBackupError(null); backupNow.mutate() }}
        >
          {backupNow.isPending ? 'Backing up…' : 'Back up now'}
        </Button>
      </div>

      {/* Success / error toast inline */}
      {backupToast && (
        <MessageBar intent="success">
          <MessageBarBody>{backupToast}</MessageBarBody>
        </MessageBar>
      )}
      {backupError && (
        <MessageBar intent="error">
          <MessageBarBody>{backupError}</MessageBarBody>
        </MessageBar>
      )}

      {/* ── Backup list ── */}
      <div
        style={{
          padding: '16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>Available backups</Body1>
          <Button
            appearance="transparent"
            size="small"
            onClick={() => void refetch()}
          >
            Refresh
          </Button>
        </div>

        {isLoading && <SectionLoading label="Loading backups…" size="tiny" />}
        {isError && (
          <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
            Failed to load backup list.
          </Caption1>
        )}
        {!isLoading && !isError && (
          <BackupList backups={backups} selectedPath={null} onSelect={undefined} radioMode={false} />
        )}
      </div>

      {/* ── Retention info ── */}
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <Caption1
          style={{
            display: 'block',
            color: tokens.colorNeutralForeground3,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: tokens.fontWeightSemibold,
            fontSize: '11px',
          }}
        >
          Retention
        </Caption1>
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground2 }}>
          7 most-recent backups kept (configurable in <code style={{ fontFamily: tokens.fontFamilyMonospace }}>~/.squadboard/config.json</code>). Editing via UI is planned for W18.
        </Caption1>
      </div>

      {/* ── Restore ── */}
      <div style={rowStyle}>
        <div>
          <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>Restore from backup</Body1>
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            Replace the current database cluster with a backup. Pre-restore copy is always preserved.
          </Caption1>
        </div>
        <Button
          appearance="secondary"
          icon={<Warning20Regular />}
          onClick={() => setShowRestoreDialog(true)}
          disabled={backups.length === 0}
        >
          Restore…
        </Button>
      </div>

      {showRestoreDialog && (
        <RestoreDialog
          open={showRestoreDialog}
          backups={backups}
          onClose={() => setShowRestoreDialog(false)}
        />
      )}
    </div>
  )
}
