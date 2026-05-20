import { Button } from '@fluentui/react-components'
import { Folder20Regular } from '@fluentui/react-icons'

function isElectronShell(): boolean {
  return typeof window !== 'undefined' && 'squadboard' in window
}

async function pickFolder(): Promise<string | null> {
  if (!isElectronShell()) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).squadboard as { invoke: (ch: string) => Promise<unknown> }
  return api.invoke('dialog.openFolder') as Promise<string | null>
}

/**
 * Browse button shown only when running inside Electron.
 * Clicking it opens a native OS folder-picker and calls `onPath` with the result.
 * Renders nothing in a plain browser context (cross-platform safe).
 */
export default function BrowseFolderButton({ onPath }: { onPath: (path: string) => void }) {
  if (!isElectronShell()) return null

  async function handleClick() {
    const result = await pickFolder()
    if (result) onPath(result)
  }

  return (
    <Button
      appearance="subtle"
      size="small"
      icon={<Folder20Regular />}
      onClick={() => void handleClick()}
      title="Browse for a folder"
      style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
    >
      Browse…
    </Button>
  )
}
