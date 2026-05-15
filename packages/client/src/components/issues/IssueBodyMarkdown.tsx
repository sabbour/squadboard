import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { tokens } from '@fluentui/react-components'
// highlight.js dark theme — matches the app's dark palette
import 'highlight.js/styles/github-dark.min.css'

interface Props {
  value: string
}

export default function IssueBodyMarkdown({ value }: Props) {
  return (
    <div
      style={{
        fontSize: '13px',
        lineHeight: '1.65',
        color: tokens.colorNeutralForeground1,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p({ children }) {
            return (
              <p style={{ margin: '0 0 8px', color: tokens.colorNeutralForeground1 }}>
                {children}
              </p>
            )
          },
          // Fenced code blocks — let rehype-highlight add hljs classes, style the pre wrapper
          pre({ children }) {
            return (
              <pre
                style={{
                  background: tokens.colorNeutralBackground3,
                  border: `1px solid ${tokens.colorNeutralStroke1}`,
                  borderRadius: '6px',
                  padding: '12px 14px',
                  overflowX: 'auto',
                  fontFamily: tokens.fontFamilyMonospace,
                  fontSize: '12px',
                  margin: '0 0 10px',
                  lineHeight: '1.5',
                }}
              >
                {children}
              </pre>
            )
          },
          // Inline code vs block code — block code already gets hljs classes from rehype-highlight
          code({ className, children, ...rest }) {
            const isBlock = /language-/.test(className ?? '')
            if (isBlock) {
              // Let hljs CSS handle coloring; just pass className through
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              )
            }
            return (
              <code
                style={{
                  fontFamily: tokens.fontFamilyMonospace,
                  background: tokens.colorNeutralBackground3,
                  padding: '1px 5px',
                  borderRadius: '3px',
                  fontSize: '12px',
                  color: tokens.colorNeutralForeground1,
                }}
              >
                {children}
              </code>
            )
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                style={{ color: tokens.colorBrandForeground1 }}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            )
          },
          // Only render images served from our own attachment endpoint
          img({ src, alt }) {
            if (src?.startsWith('/api/projects/')) {
              return (
                <img
                  src={src}
                  alt={alt ?? ''}
                  style={{ maxWidth: '100%', borderRadius: '4px', marginTop: '4px', display: 'block' }}
                />
              )
            }
            return (
              <span
                style={{
                  color: tokens.colorNeutralForeground3,
                  fontStyle: 'italic',
                  fontSize: '12px',
                }}
              >
                [external image redacted]
              </span>
            )
          },
          h1({ children }) {
            return (
              <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px', color: tokens.colorNeutralForeground1 }}>
                {children}
              </h1>
            )
          },
          h2({ children }) {
            return (
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 8px', color: tokens.colorNeutralForeground1 }}>
                {children}
              </h2>
            )
          },
          h3({ children }) {
            return (
              <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 6px', color: tokens.colorNeutralForeground1 }}>
                {children}
              </h3>
            )
          },
          ul({ children }) {
            return <ul style={{ paddingLeft: '20px', margin: '0 0 8px' }}>{children}</ul>
          },
          ol({ children }) {
            return <ol style={{ paddingLeft: '20px', margin: '0 0 8px' }}>{children}</ol>
          },
          li({ children }) {
            return <li style={{ marginBottom: '2px' }}>{children}</li>
          },
          blockquote({ children }) {
            return (
              <blockquote
                style={{
                  borderLeft: `3px solid ${tokens.colorBrandBackground}`,
                  paddingLeft: '12px',
                  margin: '0 0 8px',
                  color: tokens.colorNeutralForeground2,
                }}
              >
                {children}
              </blockquote>
            )
          },
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  )
}
