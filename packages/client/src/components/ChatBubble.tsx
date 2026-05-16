/**
 * ChatBubble — reusable chat message component (Stream J, Wave 19).
 *
 * Handles:
 * - Per-message identity (avatar + name + role badge)         [J1]
 * - Streaming-aware markdown rendering                        [J2]
 * - "Agent is thinking…" pre-stream indicator                 [J4]
 * - Shared across run transcript, Consult, future surfaces    [J6]
 */
import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { tokens, Badge, type BadgeProps } from '@fluentui/react-components'
import { Copy20Regular, Checkmark20Regular } from '@fluentui/react-icons'

// ── Role definitions ──────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'agent' | 'system' | 'tool'

const ROLE_BADGE_APPEARANCE: Record<ChatRole, BadgeProps['appearance']> = {
  agent: 'filled',
  user: 'filled',
  system: 'ghost',
  tool: 'filled',
}

const ROLE_BADGE_COLOR: Record<ChatRole, BadgeProps['color']> = {
  agent: 'informative',
  user: 'brand',
  system: 'subtle',
  tool: 'informative',
}

const ROLE_LABEL: Record<ChatRole, string> = {
  agent: 'agent',
  user: 'user',
  system: 'system',
  tool: 'tool',
}

// ── Avatar helpers ────────────────────────────────────────────────────────────

/** Simple djb2-ish hash → deterministic hue for initials circles. */
function nameToHue(name: string): number {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h) ^ name.charCodeAt(i)
  return Math.abs(h) % 360
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0]![0] ?? '?').toUpperCase()
  return ((parts[0]![0] ?? '') + (parts[parts.length - 1]![0] ?? '')).toUpperCase()
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const hue = nameToHue(name)
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `hsl(${hue}, 55%, 40%)`,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38,
        fontWeight: 700,
        flexShrink: 0,
        userSelect: 'none',
        letterSpacing: '0.02em',
      }}
    >
      {initials(name)}
    </div>
  )
}

// ── Thinking indicator (three pulsing dots) ───────────────────────────────────

const PULSE_KEYFRAMES = `
@keyframes chatbubble-pulse {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40%           { transform: scale(1.0); opacity: 1; }
}
`

let _styleInjected = false
function ensureStyles() {
  if (_styleInjected || typeof document === 'undefined') return
  _styleInjected = true
  const s = document.createElement('style')
  s.textContent = PULSE_KEYFRAMES
  document.head.appendChild(s)
}

function ThinkingDots() {
  ensureStyles()
  return (
    <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: tokens.colorNeutralForeground3,
            display: 'inline-block',
            animation: `chatbubble-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </span>
  )
}

// ── Debounced markdown renderer ───────────────────────────────────────────────

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Allow highlight.js class names
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-.+/]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^hljs-.*/]],
    div:  [...(defaultSchema.attributes?.div  ?? []), ['className', /^hljs.*/]],
  },
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = setTimeout(() => setDebounced(value), delayMs)
    return () => { if (timeout.current) clearTimeout(timeout.current) }
  }, [value, delayMs])
  return debounced
}

/** Copy button shown on hover over a code block. */
function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy code"
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        background: 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.18)',
        borderRadius: 4,
        color: '#fff',
        padding: '2px 6px',
        cursor: 'pointer',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        opacity: 0,
        transition: 'opacity 0.15s',
      }}
      className="chatbubble-copy-btn"
    >
      {copied ? <Checkmark20Regular /> : <Copy20Regular />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** Wraps a pre/code block with position:relative + hover copy button. */
function CodeBlock({ children, className }: { children?: ReactNode; className?: string }) {
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLPreElement>(null)

  const getRawCode = (): string => {
    return ref.current?.textContent ?? ''
  }

  return (
    <pre
      ref={ref}
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: 6,
        overflow: 'auto',
        margin: '8px 0',
      }}
    >
      {children}
      {hovered && <CopyCodeButton code={getRawCode()} />}
    </pre>
  )
}

// ── Markdown component ────────────────────────────────────────────────────────

function MarkdownContent({ text, streaming }: { text: string; streaming?: boolean }) {
  // Debounce only when actively streaming to avoid reflow on every token.
  const debouncedText = useDebounced(text, streaming ? 100 : 0)
  const rendered = useMemo(() => debouncedText, [debouncedText])

  return (
    <div className="chatbubble-md" style={{ lineHeight: 1.6, wordBreak: 'break-word' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
          [rehypeSanitize, SANITIZE_SCHEMA],
        ]}
        components={{
          pre: ({ children, className }) => (
            <CodeBlock className={className as string | undefined}>{children}</CodeBlock>
          ),
          code: ({ children, className, ...rest }) => (
            // Inline code (no parent pre) — or inside our CodeBlock
            <code
              className={className}
              style={
                !className
                  ? {
                      background: 'rgba(255,255,255,0.08)',
                      borderRadius: 3,
                      padding: '1px 4px',
                      fontSize: '0.88em',
                    }
                  : undefined
              }
              {...rest}
            >
              {children}
            </code>
          ),
          a: ({ href, children, ...rest }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: tokens.colorBrandForegroundLink, textDecoration: 'underline' }}
              {...rest}
            >
              {children}
            </a>
          ),
          table: ({ children, ...rest }) => (
            <div style={{ overflowX: 'auto', margin: '8px 0' }}>
              <table
                style={{
                  borderCollapse: 'collapse',
                  width: '100%',
                  fontSize: '0.92em',
                }}
                {...rest}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...rest }) => (
            <th
              style={{
                border: `1px solid ${tokens.colorNeutralStroke2}`,
                padding: '6px 10px',
                background: tokens.colorNeutralBackground3,
                textAlign: 'left',
              }}
              {...rest}
            >
              {children}
            </th>
          ),
          td: ({ children, ...rest }) => (
            <td
              style={{
                border: `1px solid ${tokens.colorNeutralStroke2}`,
                padding: '6px 10px',
              }}
              {...rest}
            >
              {children}
            </td>
          ),
        }}
      >
        {rendered}
      </ReactMarkdown>
    </div>
  )
}

// ── ChatBubble public API ─────────────────────────────────────────────────────

export interface ChatBubbleAction {
  icon: ReactNode
  label: string
  onClick: () => void
}

export interface ChatBubbleIdentity {
  name: string
  avatar?: string | null
  roleBadge?: string
}

export interface ChatBubbleProps {
  role: ChatRole
  identity: ChatBubbleIdentity
  content: string
  /** When true and content is empty: renders thinking indicator. */
  streaming?: boolean
  /** Optional hover actions (copy, regenerate, etc.). */
  actions?: ChatBubbleAction[]
  timestamp?: Date
}

export function ChatBubble({
  role,
  identity,
  content,
  streaming = false,
  actions,
  timestamp,
}: ChatBubbleProps) {
  const isUser = role === 'user'
  const isSystem = role === 'system'
  const isTool = role === 'tool'

  // Thinking: streaming is true but no content yet
  const isThinking = streaming && !content

  // "Taking longer than usual" after 30s of thinking
  const [longWait, setLongWait] = useState(false)
  useEffect(() => {
    if (!isThinking) { setLongWait(false); return }
    const t = setTimeout(() => setLongWait(true), 30_000)
    return () => clearTimeout(t)
  }, [isThinking])

  const [hovered, setHovered] = useState(false)

  // System + tool rows: compact pill-like layout
  if (isSystem || isTool) {
    return (
      <div
        style={{
          alignSelf: 'center',
          fontSize: 11,
          background: tokens.colorNeutralBackground3,
          color: tokens.colorNeutralForeground3,
          border: `1px solid ${tokens.colorNeutralStroke2}`,
          borderRadius: 999,
          padding: '3px 12px',
          display: 'inline-flex',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <Badge
          appearance={ROLE_BADGE_APPEARANCE[role]}
          color={ROLE_BADGE_COLOR[role]}
          size="extra-small"
        >
          {identity.roleBadge ?? ROLE_LABEL[role]}
        </Badge>
        <span>{identity.name}</span>
        {content && <span style={{ opacity: 0.7 }}>· {content}</span>}
        {timestamp && (
          <span style={{ opacity: 0.5 }}>
            {timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    )
  }

  // User + agent: full bubble
  const bubbleBg = isUser
    ? tokens.colorBrandBackground
    : tokens.colorNeutralBackground1

  const bubbleFg = isUser ? tokens.colorNeutralForegroundOnBrand : tokens.colorNeutralForeground1
  const borderColor = isUser ? 'transparent' : tokens.colorNeutralStroke1

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: 10,
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
      }}
    >
      {/* Avatar */}
      <div style={{ paddingTop: 2, flexShrink: 0 }}>
        <Avatar name={identity.name} size={30} />
      </div>

      {/* Bubble body */}
      <div
        style={{
          background: bubbleBg,
          color: bubbleFg,
          border: `1px solid ${borderColor}`,
          borderRadius: isUser ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
          padding: '10px 14px',
          fontSize: 13,
          minWidth: 80,
        }}
      >
        {/* Header: name + badge + timestamp */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            marginBottom: 6,
            flexWrap: 'wrap',
          }}
        >
          <strong style={{ fontSize: 12 }}>{identity.name}</strong>
          <Badge
            appearance={ROLE_BADGE_APPEARANCE[role]}
            color={ROLE_BADGE_COLOR[role]}
            size="extra-small"
          >
            {identity.roleBadge ?? ROLE_LABEL[role]}
          </Badge>
          {timestamp && (
            <span
              style={{
                fontSize: 10,
                opacity: 0.55,
                marginLeft: 'auto',
              }}
            >
              {timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* Content */}
        {isThinking ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <ThinkingDots />
            {longWait && (
              <span
                style={{
                  fontSize: 11,
                  color: isUser
                    ? 'rgba(255,255,255,0.7)'
                    : tokens.colorNeutralForeground3,
                  animation: 'chatbubble-pulse 2s ease-in-out infinite',
                }}
              >
                Agent is taking longer than usual…
              </span>
            )}
          </div>
        ) : isUser ? (
          // User messages: plain text (pre-wrap), no markdown
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.5 }}>
            {content || <em style={{ opacity: 0.6 }}>(empty)</em>}
          </div>
        ) : (
          // Agent messages: full markdown rendering
          <MarkdownContent text={content} streaming={streaming} />
        )}

        {/* Hover actions (copy, regenerate, etc.) */}
        {!isThinking && hovered && actions && actions.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 4,
              marginTop: 8,
              justifyContent: isUser ? 'flex-start' : 'flex-end',
            }}
          >
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                title={a.label}
                style={{
                  background: 'transparent',
                  border: `1px solid ${tokens.colorNeutralStroke2}`,
                  borderRadius: 4,
                  color: tokens.colorNeutralForeground2,
                  padding: '2px 6px',
                  cursor: 'pointer',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatBubble
