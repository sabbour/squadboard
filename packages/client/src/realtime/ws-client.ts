// Singleton WebSocket client for Demo 12 — Multi-User + Live Ops
// Connects to the Squadboard server and fans out typed events to subscribers.

const WS_BASE = (() => {
  const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
  return apiBase.replace(/^http/, 'ws')
})()

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

// ── Typed event payloads ──────────────────────────────────────────────────────

export interface WsEventMap {
  // Issue lifecycle
  'issue.created': { projectId: string; issue: Record<string, unknown> }
  'issue.updated': { projectId: string; issue: Record<string, unknown> }
  'issue.moved': { projectId: string; issueId: string; column: string; position: number }
  'issue.deleted': { projectId: string; issueId: string }
  // Run lifecycle
  'run.started': { projectId: string; issueId: string; runId: string }
  'run.output': { runId: string; line: string }
  'run.completed': { projectId: string; issueId: string; runId: string; status: string }
  'run.failed': { projectId: string; issueId: string; runId: string; error: string }
  'run.cancelled': { projectId: string; issueId: string; runId: string }
  // Workflow
  'workflow.advanced': { projectId: string; issueId: string; runId: string; step: string }
  // Presence
  'presence.joined': { userId: string; projectId: string; issueId?: string }
  'presence.left': { userId: string; projectId: string }
  'presence.updated': { userId: string; projectId: string; issueId?: string | null }
  'presence.snapshot': { users: PresenceUser[] }
  // Connection control (sent by server)
  connected: { serverId: string }
  error: { message: string }
}

export type WsEventType = keyof WsEventMap
export type WsHandler<T extends WsEventType> = (payload: WsEventMap[T]) => void

export interface PresenceUser {
  userId: string
  issueId?: string | null
  connectedAt: string
}

// ── WsClient class ────────────────────────────────────────────────────────────

class WsClient {
  private socket: WebSocket | null = null
  private projectId: string | null = null
  private connectionState: ConnectionState = 'disconnected'
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private readonly maxBackoff = 30_000

  // Typed handler map: { eventType: Set<handler> }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers = new Map<string, Set<(payload: any) => void>>()

  // Connection-state listeners (for UI indicators)
  private stateListeners = new Set<(state: ConnectionState) => void>()

  // ── Public API ──────────────────────────────────────────────────────────────

  connect(projectId: string) {
    if (this.socket && this.projectId === projectId && this.socket.readyState === WebSocket.OPEN) {
      return // already connected to same project
    }
    if (this.socket) {
      this.cleanup(false) // close old connection without notifying "disconnect"
    }
    this.projectId = projectId
    this.reconnectAttempts = 0
    this.open()
  }

  disconnect() {
    this.projectId = null
    this.cancelReconnect()
    if (this.socket) {
      // Send unsubscribe before closing
      if (this.socket.readyState === WebSocket.OPEN) {
        this.safeSend({ type: 'unsubscribe' })
      }
      this.cleanup(true)
    }
  }

  on<T extends WsEventType>(type: T, handler: WsHandler<T>): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler as (p: unknown) => void)
  }

  off<T extends WsEventType>(type: T, handler: WsHandler<T>): void {
    this.handlers.get(type)?.delete(handler as (p: unknown) => void)
  }

  sendPresence(issueId: string | null) {
    this.safeSend({ type: 'presence', issueId })
  }

  /** Send any arbitrary message to the server (no-op if not connected). */
  send(data: unknown) {
    this.safeSend(data)
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    // Immediately fire with current state
    listener(this.connectionState)
    return () => this.stateListeners.delete(listener)
  }

  get state(): ConnectionState {
    return this.connectionState
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private open() {
    const pid = this.projectId
    if (!pid) return
    this.setConnectionState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')
    const url = `${WS_BASE}/api/ws`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = ws

    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.setConnectionState('connected')
      this.safeSend({ type: 'subscribe', projectId: pid })
    }

    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: { type: string; payload?: unknown }
      try {
        msg = JSON.parse(ev.data) as { type: string; payload?: unknown }
      } catch {
        return
      }
      this.emit(msg.type, msg.payload ?? {})
    }

    ws.onerror = () => {
      // onerror is always followed by onclose
    }

    ws.onclose = () => {
      this.socket = null
      if (this.projectId) {
        // Intentional disconnect would have cleared projectId already
        this.setConnectionState('reconnecting')
        this.scheduleReconnect()
      } else {
        this.setConnectionState('disconnected')
      }
    }
  }

  private cleanup(notifyDisconnect: boolean) {
    if (this.socket) {
      this.socket.onopen = null
      this.socket.onmessage = null
      this.socket.onerror = null
      this.socket.onclose = null
      try { this.socket.close() } catch { /* ignore */ }
      this.socket = null
    }
    if (notifyDisconnect) {
      this.setConnectionState('disconnected')
    }
  }

  private safeSend(data: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data))
    }
  }

  private emit(type: string, payload: unknown) {
    const set = this.handlers.get(type)
    if (set) {
      for (const handler of set) {
        try { handler(payload) } catch { /* isolate handler errors */ }
      }
    }
  }

  private setConnectionState(state: ConnectionState) {
    if (this.connectionState === state) return
    this.connectionState = state
    for (const listener of this.stateListeners) {
      try { listener(state) } catch { /* ignore */ }
    }
  }

  private scheduleReconnect() {
    this.cancelReconnect()
    const delay = Math.min(
      500 * Math.pow(2, this.reconnectAttempts), // 500ms, 1s, 2s, 4s, …
      this.maxBackoff,
    )
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private cancelReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

// Singleton export
export const wsClient = new WsClient()
