# WebSocket Protocol

Real-time bidirectional communication for Squadboard live events and presence.

## Connection

### URL

```
ws://localhost:3000/api/ws?token=<JWT>
```

### Authentication

The JWT token is passed as a query parameter or Authorization header. The server validates the token on upgrade:

- **Missing/invalid token** → connection rejected (401)
- **Valid token** → connection established
- Token must contain `projectId` claim (determines authorization scope)

### Upgrade Example (JavaScript)

```javascript
const token = localStorage.getItem('squadboard:authToken');
const ws = new WebSocket(`ws://localhost:3000/api/ws?token=${token}`);

ws.addEventListener('open', () => {
  console.log('Connected');
});
```

---

## Message Format

All messages are JSON objects with a required `type` field and optional `payload`:

```json
{
  "type": "message_type",
  "payload": { /* message-specific data */ }
}
```

---

## Client → Server Messages

### subscribe

Subscribe to events from a specific project.

```json
{
  "type": "subscribe",
  "payload": {
    "projectId": "project-123"
  }
}
```

**Response:** `{ "type": "subscribed", "payload": { "projectId": "project-123", "userId": "user-456" } }`

**Special rooms:**
- `"__global__"` — Subscribe to all events across all projects (for dashboard pages)

### unsubscribe

Stop receiving events from a project.

```json
{
  "type": "unsubscribe",
  "payload": {
    "projectId": "project-123"
  }
}
```

**Response:** `{ "type": "unsubscribed", "payload": { "projectId": "project-123" } }`

### presence.cursor

Report user's current cursor position and focused issue.

```json
{
  "type": "presence.cursor",
  "payload": {
    "projectId": "project-123",
    "issueId": "issue-456" | null
  }
}
```

**Sent by client:** ~200ms debounce when user moves focus. No response.

**Broadcast to others:** `presence.updated` event (see below).

### resubscribe

Reconnect and replay missed events from last known sequence.

```json
{
  "type": "resubscribe",
  "payload": {
    "projectId": "consult:session-789",
    "lastSeq": 42
  }
}
```

**Response:** `{ "type": "resubscribed", "payload": { "projectId": "consult:session-789", "replayed": true } }`

**Use case:** Consult (chat) rooms maintain a 15-minute buffer; clients can recover messages on reconnect.

---

## Server → Client Events

All events are broadcast to subscribed clients in real-time.

### Subscription Control

#### subscribed

```json
{
  "type": "subscribed",
  "payload": {
    "projectId": "project-123",
    "userId": "user-456"
  }
}
```

#### unsubscribed

```json
{
  "type": "unsubscribed",
  "payload": {
    "projectId": "project-123"
  }
}
```

#### error

```json
{
  "type": "error",
  "payload": {
    "message": "Invalid project ID"
  }
}
```

---

### Issue Lifecycle

#### issue.created

```json
{
  "type": "issue.created",
  "payload": {
    "projectId": "project-123",
    "issue": {
      "id": "issue-456",
      "title": "Fix login bug",
      "description": "Users can't log in on mobile",
      "status": "open",
      "createdAt": "2024-05-20T10:30:00Z",
      ...
    }
  }
}
```

#### issue.updated

```json
{
  "type": "issue.updated",
  "payload": {
    "projectId": "project-123",
    "issue": {
      "id": "issue-456",
      "title": "Fix login bug [URGENT]",
      ...
    }
  }
}
```

#### issue.moved

```json
{
  "type": "issue.moved",
  "payload": {
    "projectId": "project-123",
    "issueId": "issue-456",
    "column": "in-progress",
    "position": 2
  }
}
```

#### issue.deleted

```json
{
  "type": "issue.deleted",
  "payload": {
    "projectId": "project-123",
    "issueId": "issue-456"
  }
}
```

---

### Run Lifecycle (Agent Execution)

#### issue.run.start

Agent run begins.

```json
{
  "type": "issue.run.start",
  "payload": {
    "runId": "run-789",
    "seq": 0,
    "createdAt": "2024-05-20T10:30:00Z",
    "agentName": "ReviewAgent",
    "model": "gpt-4"
  }
}
```

#### issue.run.turn

User or assistant message in the run.

```json
{
  "type": "issue.run.turn",
  "payload": {
    "runId": "run-789",
    "seq": 1,
    "role": "assistant",
    "content": "I'll analyze the code...",
    "createdAt": "2024-05-20T10:30:05Z"
  }
}
```

#### issue.run.token

Token usage metrics.

```json
{
  "type": "issue.run.token",
  "payload": {
    "runId": "run-789",
    "seq": 2,
    "inputTokens": 150,
    "outputTokens": 200,
    "model": "gpt-4",
    "cost": 0.0042
  }
}
```

#### issue.run.tool_call

Tool invocation.

```json
{
  "type": "issue.run.tool_call",
  "payload": {
    "runId": "run-789",
    "seq": 3,
    "toolName": "github_create_pr",
    "args": { "branch": "fix/login", "title": "Fix mobile login" }
  }
}
```

#### issue.run.tool_result

Tool result.

```json
{
  "type": "issue.run.tool_result",
  "payload": {
    "runId": "run-789",
    "seq": 4,
    "toolName": "github_create_pr",
    "result": { "prUrl": "https://github.com/...", "prNumber": 42 }
  }
}
```

#### issue.run.finish

Run complete.

```json
{
  "type": "issue.run.finish",
  "payload": {
    "runId": "run-789",
    "seq": 5,
    "durationMs": 45000,
    "outputSummary": "Created PR #42",
    "cost": "0.0098",
    "tokenCounts": { "input": 1500, "output": 2000, "total": 3500 }
  }
}
```

#### issue.run.error

Run failed.

```json
{
  "type": "issue.run.error",
  "payload": {
    "runId": "run-789",
    "seq": 6,
    "message": "Tool execution timeout after 60s"
  }
}
```

---

### Presence (Real-Time Collaboration)

#### presence.snapshot

Initial presence state when subscribing.

```json
{
  "type": "presence.snapshot",
  "payload": {
    "users": [
      { "userId": "user-1", "issueId": "issue-42", "connectedAt": "2024-05-20T10:25:00Z" },
      { "userId": "user-2", "issueId": null, "connectedAt": "2024-05-20T10:28:00Z" }
    ]
  }
}
```

#### presence.joined

New user joined the project.

```json
{
  "type": "presence.joined",
  "payload": {
    "userId": "user-3",
    "projectId": "project-123",
    "issueId": "issue-456" | null
  }
}
```

#### presence.left

User disconnected or left the project.

```json
{
  "type": "presence.left",
  "payload": {
    "userId": "user-3",
    "projectId": "project-123"
  }
}
```

#### presence.updated

User moved to a different issue or updated their focus.

```json
{
  "type": "presence.updated",
  "payload": {
    "userId": "user-2",
    "projectId": "project-123",
    "issueId": "issue-789" | null
  }
}
```

---

### Consult (AI Chat)

Consult sessions use special room IDs: `consult:<sessionId>`

#### consult.started

```json
{
  "type": "consult.started",
  "payload": {
    "sessionId": "consult-abc",
    "projectId": "project-123",
    "mode": "agent",
    "agentName": "ResearchAgent",
    "model": "gpt-4"
  }
}
```

#### consult.user_message

```json
{
  "type": "consult.user_message",
  "payload": {
    "sessionId": "consult-abc",
    "messageId": "msg-1",
    "content": "How do we improve performance?"
  }
}
```

#### consult.message_delta

Streamed response tokens.

```json
{
  "type": "consult.message_delta",
  "payload": {
    "sessionId": "consult-abc",
    "delta": " We can"
  }
}
```

#### consult.message_complete

Response finished.

```json
{
  "type": "consult.message_complete",
  "payload": {
    "sessionId": "consult-abc",
    "messageId": "msg-2",
    "content": "We can optimize queries, add caching...",
    "role": "assistant"
  }
}
```

#### consult.completed

Session ended.

```json
{
  "type": "consult.completed",
  "payload": {
    "sessionId": "consult-abc",
    "reason": "completed" | "cancelled" | "failed"
  }
}
```

---

### Workflow & Ceremonies

#### workflow.advanced

Workflow step was executed or advanced.

```json
{
  "type": "workflow.advanced",
  "payload": {
    "projectId": "project-123",
    "issueId": "issue-456",
    "runId": "run-789",
    "step": "review"
  }
}
```

---

### Comments & Deliverables

#### comment.created

```json
{
  "type": "comment.created",
  "payload": {
    "issueId": "issue-456",
    "comment": {
      "id": "comment-123",
      "author": "user-2",
      "content": "Great progress!",
      "createdAt": "2024-05-20T10:35:00Z"
    }
  }
}
```

#### deliverable.created

```json
{
  "type": "deliverable.created",
  "payload": {
    "issueId": "issue-456",
    "deliverable": {
      "id": "deliv-789",
      "title": "Authentication module",
      "source": "auto-extract" | "manual"
    }
  }
}
```

---

### System Events

#### sweep.tick

Heartbeat sweep completion (useful for status dashboards).

```json
{
  "type": "sweep.tick",
  "payload": {
    "sweepName": "ready-workflow-steps",
    "sweepLabel": "Workflow Advance",
    "sweepScope": "project"
  }
}
```

---

## Reconnection & Resilience

### Heartbeat

The server sends a **ping frame** every 15 seconds. Clients should respond with **pong**.

- **Missing pong** → connection terminated by server
- Client must reconnect manually
- Browser WebSocket API handles ping/pong automatically

### Client Reconnection Strategy

```javascript
function reconnect(token) {
  const ws = new WebSocket(`ws://localhost:3000/api/ws?token=${token}`);
  
  ws.addEventListener('open', () => {
    // Resubscribe to projects
    ws.send(JSON.stringify({ type: 'subscribe', payload: { projectId: 'project-123' } }));
    
    // For consult rooms, replay from last known seq
    ws.send(JSON.stringify({
      type: 'resubscribe',
      payload: { projectId: 'consult:session-abc', lastSeq: lastKnownSeq }
    }));
  });
  
  ws.addEventListener('close', () => {
    setTimeout(() => reconnect(token), 3000); // Retry in 3s
  });
}
```

### Buffering & Replay

Consult (chat) rooms maintain a **15-minute buffer** of events. On reconnect:

1. Client sends `resubscribe` with `lastSeq`
2. Server replays missed events from buffer
3. Client replays events up to current state

---

## Rate Limiting

WebSocket connections follow standard project rate limits:

- Per-connection message rate: 100/sec
- Subscription limit: 10 projects per connection
- Payload size: 1 MB max

Exceeding limits triggers a `{"type": "error"}` and may close the connection.

---

## Example: Subscribe to Project & Listen for Issues

```javascript
const ws = new WebSocket(`ws://localhost:3000/api/ws?token=${token}`);

ws.addEventListener('open', () => {
  // Subscribe to project
  ws.send(JSON.stringify({
    type: 'subscribe',
    payload: { projectId: 'project-123' }
  }));
});

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'issue.created':
      console.log('New issue:', message.payload.issue.title);
      break;
    case 'issue.moved':
      console.log(`Issue ${message.payload.issueId} moved to ${message.payload.column}`);
      break;
    case 'presence.updated':
      console.log(`User ${message.payload.userId} is now on issue ${message.payload.issueId}`);
      break;
  }
});
```

---

## Comparison to REST API

| Aspect | REST | WebSocket |
|--------|------|-----------|
| **Polling** | Client polls for changes | Server pushes events |
| **Latency** | Higher (poll interval) | Lower (real-time) |
| **Bandwidth** | Higher (empty polls) | Lower (events only) |
| **Initial Data** | Single request | Use REST `/api/projects/:id/presence` or room buffer |
| **Use Case** | One-off reads, mutations | Live collaboration, dashboards |

Use **WebSocket** for:
- Real-time presence (who's viewing what)
- Live run output
- Collaboratively editing the same issue
- Dashboard monitoring

Use **REST API** for:
- Creating/updating issues
- Querying historical data
- Scheduled operations
