import { useEffect } from 'react'

const DEFAULT_MESSAGE = 'You have unsaved changes. Leave this page and discard them?'

export function useUnsavedChangesWarning(when: boolean, message = DEFAULT_MESSAGE) {
  useEffect(() => {
    if (!when) return

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = message
      return message
    }

    function handleDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return
      }

      const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) {
        return
      }

      const nextUrl = new URL(anchor.href, window.location.href)
      const currentUrl = new URL(window.location.href)
      if (
        nextUrl.origin !== currentUrl.origin ||
        (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search)
      ) {
        return
      }

      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload, { capture: true })
    document.addEventListener('click', handleDocumentClick, { capture: true })

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload, { capture: true })
      document.removeEventListener('click', handleDocumentClick, { capture: true })
    }
  }, [message, when])
}
