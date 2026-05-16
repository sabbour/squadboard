// Singleton WebSocket client — Multi-User + Live Ops
// Connects to the Squadboard server and fans out typed events to subscribers.

const WS_BASE = (() => {
  const apiBase = import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.host}`
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
  // Live multi-agent sessions (Squad-IRL run-first slice)
  'session.started':   { sessionId: string; title?: string; agentName?: string; model?: string; sdkSessionId?: string }
  'session.message':   { sessionId: string; role: 'user' | 'assistant'; messageId?: string; content: string }
  'session.delta':     { sessionId: string; delta: string; kind?: 'reasoning' | 'message' }
  'session.tool':      { sessionId: string; phase: string; raw?: unknown }
  'session.usage':     { sessionId: string; inputTokens: number; outputTokens: number; model?: string | null; cost: number }
  'session.error':     { sessionId: string; message: string }
  'session.completed': { sessionId: string; reason: 'completed' | 'cancelled' | 'failed' }
  'session.steered':   { sessionId: string; action: 'inject' | 'interrupt' | 'handoff' | 'invite'; actor?: string; honoured?: boolean; reason?: string; note?: string; deferred?: boolean; toAgentId?: string; agentId?: string }
  // Multi-actor comments timeline (Phase 9)
  'comment.created':   { issueId: string; comment: Record<string, unknown> }
  'comment.deleted':   { issueId: string; commentId: string }
  // Deliverables (Phase 9)
  'deliverable.created':    { issueId: string; deliverable: Record<string, unknown>; source?: 'auto-extract' | 'manual' }
  'deliverable.updated':    { deliverableId: string; deliverable: Record<string, unknown> }
  'deliverable.reviewed':   { deliverableId: string; verb: string; newStatus: string; reviewerName?: string; revisionRunId?: string | null }
  'deliverable.superseded': { deliverableId: string; supersededBy: string }
  // Phase 17: Ask / Consult mode events (per-consult room: subscribeRoom('consult:<sessionId>'))
  'consult.started':           { sessionId: string; projectId: string | null; mode: 'agent' | 'model'; agentName?: string | null; model?: string | null }
  'consult.user_message':      { sessionId: string; messageId: string; content: string }
  'consult.message_delta':     { sessionId: string; delta: string }
  'consult.reasoning_delta':   { sessionId: string; delta: string }
  'consult.message_complete':  { sessionId: string; messageId: string; sdkMessageId?: string; content: string; reasoningContent?: string | null; role: 'assistant' | 'system' | 'tool'; coordinatorQuickReply?: boolean; category?: string; confidence?: string }
  'consult.tool_call':         { sessionId: string; toolName: string; args?: unknown; result?: unknown }
  'consult.proposal_created':  { sessionId: string; proposal: Record<string, unknown> }
  'consult.proposal_decided':  { sessionId: string; proposalId: string; status: 'accepted' | 'edited' | 'discarded' | 'pending'; artifact?: unknown }
  'consult.usage':             { sessionId: string; inputTokens: number; outputTokens: number; model?: string | null; cost: number }
  'consult.error':             { sessionId: string; message: string }
  'consult.completed':         { sessionId: string; reason: 'completed' | 'cancelled' | 'failed' }
  /** W28 J5: coordinator context snapshot, emitted per turn for the UI panel. */
  'consult.context':           { sessionId: string; sections: Array<{ name: string; tokens: number; truncated: boolean }>; totalTokens: number; variableTokens: number; truncationLog: string[]; redactionCount: number }
  // Stream G: GitHub integration — git push + PR lifecycle
  'git.push.complete': { runId: string; branch: string; branchUrl: string; pushOutput: string }
  'git.pr.created':    { runId: string; branch: string; prUrl: string; prNumber?: number }
  'git.comment.posted': { runId: string; commentUrl: string; issueNumber: number }
  'git.pr.merged':     { runId: string; prUrl: string; sha: string; method: 'merge' | 'squash' | 'rebase' }
  // Stream J — Chat polish: agent thinking indicator
  'assistant.thinking.start': { sessionId: string; agentName?: string | null }
  'assistant.thinking.stop':  { sessionId: string }
  // W25 — Sweep timeline animation. Fired server-side on every heartbeat
  // sweep completion (success + error) and fanned out to '__global__'
  // subscribers (Heartbeat + Now pages).
  'sweep.tick': { sweepName: string; timestamp: string; agentsActivated: string[]; durationMs: number; status: 'success' | 'error' | 'skip' }
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
  /**
   * Phase 17 Ask: extra room subscriptions beyond the primary `projectId`.
   * Used for cross-project consult sessions whose room is `consult:<sessionId>`.
   * Tracked separately so they survive reconnect.
   */
  private extraRooms = new Set<string>()

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
    // Cancel any pending reconnect timer from a prior connection — otherwise a
    // stale timer can fire after this connect() runs and spawn a second socket
    // racing the new one, leaving the state machine stuck in 'reconnecting'.
    this.cancelReconnect()
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

  /**
   * Phase 17 Ask: subscribe to an additional room (e.g. 'consult:<sessionId>').
   * Idempotent. The subscription is remembered and re-sent on reconnect.
   * Connects with a project-less WebSocket if not already connected — useful
   * for cross-project consult sessions opened from the global Ask launcher.
   */
  subscribeRoom(room: string) {
    if (this.extraRooms.has(room)) return
    this.extraRooms.add(room)
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.safeSend({ type: 'subscribe', projectId: room })
      return
    }
    // Lazy-connect when no project session is active. Use the room id as the
    // primary projectId so the open handler subscribes to it; track the
    // distinction via extraRooms (which is unioned on resub).
    if (!this.projectId) {
      this.projectId = room
      this.reconnectAttempts = 0
      this.open()
    }
  }

  /** Phase 17 Ask: unsubscribe from an extra room. */
  unsubscribeRoom(room: string) {
    if (!this.extraRooms.delete(room)) return
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.safeSend({ type: 'unsubscribe', projectId: room })
    }
    if (this.projectId === room && this.extraRooms.size === 0) {
      this.disconnect()
    }
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
      // Re-subscribe any extra rooms (Phase 17 consult sessions etc.) that
      // were registered before the socket was open or before reconnect.
      for (const room of this.extraRooms) {
        if (room === pid) continue
        this.safeSend({ type: 'subscribe', projectId: room })
      }
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
