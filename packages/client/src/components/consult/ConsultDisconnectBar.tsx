/**
 * components/consult/ConsultDisconnectBar.tsx — W28 J3
 *
 * Fluent2 MessageBar shown when the real-time stream has disconnected and
 * the automatic retry also failed. Provides a Retry button so the user can
 * manually re-establish the stream by reloading the session view.
 */

import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components'

interface ConsultDisconnectBarProps {
  onRetry: () => void
}

export function ConsultDisconnectBar({ onRetry }: ConsultDisconnectBarProps) {
  return (
    <MessageBar intent="warning" politeness="assertive">
      <MessageBarBody>
        <MessageBarTitle>Stream disconnected</MessageBarTitle>
        Live updates are unavailable. Your messages will still be sent, but new
        tokens will not appear until the connection is restored.
      </MessageBarBody>
      <MessageBarActions>
        <Button appearance="transparent" size="small" onClick={onRetry}>
          Retry
        </Button>
      </MessageBarActions>
    </MessageBar>
  )
}
