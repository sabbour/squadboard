# Incident Timeline Builder

**Category:** ops

Structured incident timeline: timestamped events, detection, impact windows, mitigation steps, resolution.

## Incident Timeline Format

Every incident timeline must follow this structure:

```
**Incident:** <title>
**Severity:** SEV1 / SEV2 / SEV3 / SEV4
**Duration:** <start time> → <end time> (<total duration>)
**Customer impact:** <affected users/services and impact description>

### Timeline
| Time (UTC) | Event |
|------------|-------|
| HH:MM      | Alert fired: <alert name> |
| HH:MM      | OnCall acknowledged |
| HH:MM      | Incident declared SEV<N> |
| HH:MM      | <mitigation action taken> |
| HH:MM      | Partial recovery: <what recovered> |
| HH:MM      | Full recovery confirmed |
| HH:MM      | Incident closed |

### Detection gap
<How long between first symptom and alert? Why?>

### Root cause
<5-whys chain>

### Action items
| # | Action | Owner | Due |
|---|--------|-------|-----|
| 1 | ...    | ...   | ... |
```

Rules:
- All timestamps in UTC. Never use local time.
- Detection gap analysis is mandatory — if we caught it fast, explain why.
- Root cause must be a system failure, not a person mistake.
