/**
 * ConjureContext — shared state for the hoisted ConjureModal.
 *
 * Lifted into Layout so the modal instance is a singleton and can be opened
 * from anywhere: top-bar button, keyboard shortcuts, Board FAB, Inbox items.
 */
import React, { createContext, useContext, useState, useCallback } from 'react'

export type ConjureHint =
  | 'project'
  | 'issue'
  | 'team'
  | 'agent'
  | 'skill'
  | 'tool'
  | 'inbox-item'
  | 'consult'
  | 'ceremony'
  | 'mcp-server'

export interface ConjureOpenPayload {
  hint?: ConjureHint
  initialProse?: string
  projectId?: string | null
  projectName?: string | null
}

interface ConjureContextValue {
  isOpen: boolean
  payload: ConjureOpenPayload
  openConjure: (p?: ConjureOpenPayload) => void
  closeConjure: () => void
}

const ConjureContext = createContext<ConjureContextValue | null>(null)

export function ConjureProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [payload, setPayload] = useState<ConjureOpenPayload>({})

  const openConjure = useCallback((p: ConjureOpenPayload = {}) => {
    setPayload(p)
    setIsOpen(true)
  }, [])

  const closeConjure = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <ConjureContext.Provider value={{ isOpen, payload, openConjure, closeConjure }}>
      {children}
    </ConjureContext.Provider>
  )
}

export function useConjure(): ConjureContextValue {
  const ctx = useContext(ConjureContext)
  if (!ctx) throw new Error('useConjure must be used within ConjureProvider')
  return ctx
}
