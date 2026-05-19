import { useCallback } from 'react'
import { unstable_usePrompt as usePrompt, useBeforeUnload } from 'react-router'

const DEFAULT_MESSAGE = 'You have unsaved changes. Leave this page and discard them?'

export function useUnsavedChangesWarning(when: boolean, message = DEFAULT_MESSAGE) {
  usePrompt({
    message,
    when: ({ currentLocation, nextLocation }) =>
      when &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  })

  useBeforeUnload(
    useCallback((event: BeforeUnloadEvent) => {
      if (!when) return
      event.preventDefault()
      event.returnValue = message
      return message
    }, [message, when]),
    { capture: true },
  )
}
