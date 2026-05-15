import { useState, useRef, useEffect, useCallback } from 'react'
import { tokens, Tooltip } from '@fluentui/react-components'
import { Code24Regular, Image24Regular } from '@fluentui/react-icons'
import { useUploadIssueAttachment } from '../../api/issue-attachments.ts'
import IssueBodyMarkdown from './IssueBodyMarkdown.tsx'

interface Props {
  value: string
  onChange: (next: string) => void
  projectId: string
  /** Undefined during create-flow — image uploads disabled until the issue is saved. */
  issueId?: string
  placeholder?: string
  rows?: number
}

export default function MarkdownBodyEditor({
  value,
  onChange,
  projectId,
  issueId,
  placeholder = 'Describe the issue… (Markdown supported)',
  rows = 8,
}: Props) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [dragOver, setDragOver] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Keep a ref to the latest value so async callbacks see the live string
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])

  const canUpload = Boolean(issueId)
  const uploadMutation = useUploadIssueAttachment(projectId, issueId ?? '__no_issue__')

  function showError(msg: string) {
    setErrorMsg(msg)
    setTimeout(() => setErrorMsg(null), 5000)
  }

  /** Insert text at cursor / selection in the textarea, then refocus. */
  const insertAtCursor = useCallback(
    (text: string): { start: number; end: number } => {
      const ta = textareaRef.current
      const start = ta?.selectionStart ?? valueRef.current.length
      const end = ta?.selectionEnd ?? valueRef.current.length
      const newVal = valueRef.current.slice(0, start) + text + valueRef.current.slice(end)
      onChange(newVal)
      // Restore cursor after React re-renders the textarea
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          const pos = start + text.length
          el.setSelectionRange(pos, pos)
          el.focus()
        }
      })
      return { start, end }
    },
    [onChange],
  )

  /** Full upload sequence: placeholder → upload → replace. */
  const handleUpload = useCallback(
    async (file: File, cursorStart: number, cursorEnd: number) => {
      if (!canUpload) return
      const placeholder = `![uploading ${file.name}…]()`
      const pre = valueRef.current.slice(0, cursorStart)
      const post = valueRef.current.slice(cursorEnd)
      onChange(pre + placeholder + post)

      try {
        const data = await uploadMutation.mutateAsync(file)
        onChange(valueRef.current.replace(placeholder, `![${file.name}](${data.url})`))
      } catch (err) {
        const msg = (err as Error).message || 'upload_failed'
        onChange(
          valueRef.current.replace(
            placeholder,
            `<!-- upload failed: ${file.name} (${msg}) -->`,
          ),
        )
        showError(`Upload failed: ${msg}`)
      }
    },
    [canUpload, onChange, uploadMutation],
  )

  function getCaretBounds(): [number, number] {
    const ta = textareaRef.current
    return [ta?.selectionStart ?? valueRef.current.length, ta?.selectionEnd ?? valueRef.current.length]
  }

  // ── Toolbar handlers ────────────────────────────────────────────────────

  function handleFencedCodeBlock() {
    const ta = textareaRef.current
    const start = ta?.selectionStart ?? value.length
    const end = ta?.selectionEnd ?? value.length
    const selected = value.slice(start, end)
    const block = selected ? `\`\`\`\n${selected}\n\`\`\`` : '```\n\n```'
    insertAtCursor(block)
  }

  function handleImageButton() {
    if (!canUpload) return
    fileInputRef.current?.click()
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!canUpload) return
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (imageItems.length === 0) return
    e.preventDefault()
    const [start, end] = getCaretBounds()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) void handleUpload(file, start, end)
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault()
    setDragOver(false)
    if (!canUpload) return
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    const [start, end] = getCaretBounds()
    for (const file of files) void handleUpload(file, start, end)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const [start, end] = getCaretBounds()
    void handleUpload(file, start, end)
    e.target.value = ''
  }

  // ── Toolbar button style helper ─────────────────────────────────────────

  const toolbarBtnStyle = (disabled: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    borderRadius: '4px',
    padding: '3px 5px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? tokens.colorNeutralForeground4 : tokens.colorNeutralForeground2,
    opacity: disabled ? 0.5 : 1,
    transition: 'background 0.1s, color 0.1s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Write / Preview tab bar ── */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        }}
      >
        {(['write', 'preview'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${tab === t ? tokens.colorBrandBackground : 'transparent'}`,
              color: tab === t ? tokens.colorNeutralForeground1 : tokens.colorNeutralForeground2,
              padding: '5px 14px',
              fontSize: '12px',
              fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer',
              marginBottom: '-1px',
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'write' && (
        <>
          {/* ── Toolbar ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              padding: '4px 6px',
              background: tokens.colorNeutralBackground2,
              border: `1px solid ${tokens.colorNeutralStroke1}`,
              borderBottom: 'none',
            }}
          >
            <Tooltip content="Fenced code block (```)" relationship="label">
              <button
                type="button"
                onClick={handleFencedCodeBlock}
                style={toolbarBtnStyle(false)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    tokens.colorNeutralBackground3
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'none'
                }}
              >
                <Code24Regular />
              </button>
            </Tooltip>

            <Tooltip
              content={
                canUpload
                  ? 'Attach image (or paste / drag-and-drop)'
                  : 'Save the issue first to attach images.'
              }
              relationship="label"
            >
              <button
                type="button"
                disabled={!canUpload}
                onClick={handleImageButton}
                style={toolbarBtnStyle(!canUpload)}
                onMouseEnter={(e) => {
                  if (canUpload) {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      tokens.colorNeutralBackground3
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'none'
                }}
              >
                <Image24Regular />
              </button>
            </Tooltip>
          </div>

          {/* ── Textarea ── */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            onPaste={handlePaste}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              width: '100%',
              background: dragOver
                ? tokens.colorBrandBackground2
                : tokens.colorNeutralBackground1,
              border: `1px solid ${dragOver ? tokens.colorBrandBackground : tokens.colorNeutralStroke1}`,
              borderTop: dragOver
                ? `1px solid ${tokens.colorBrandBackground}`
                : `1px solid ${tokens.colorNeutralStroke1}`,
              borderRadius: '0 0 6px 6px',
              color: tokens.colorNeutralForeground1,
              padding: '10px 12px',
              fontSize: '13px',
              fontFamily: tokens.fontFamilyMonospace,
              resize: 'vertical',
              outline: 'none',
              lineHeight: '1.6',
              boxSizing: 'border-box',
              transition: 'border-color 0.1s, background 0.1s',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = tokens.colorBrandBackground
            }}
            onBlur={(e) => {
              if (!dragOver) e.currentTarget.style.borderColor = tokens.colorNeutralStroke1
            }}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
        </>
      )}

      {tab === 'preview' && (
        <div
          style={{
            background: tokens.colorNeutralBackground2,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: '0 0 6px 6px',
            padding: '12px 14px',
            minHeight: `${rows * 1.6 + 1.5}em`,
          }}
        >
          {value.trim() ? (
            <IssueBodyMarkdown value={value} />
          ) : (
            <span style={{ color: tokens.colorNeutralForeground3, fontSize: '13px', fontStyle: 'italic' }}>
              Nothing to preview
            </span>
          )}
        </div>
      )}

      {/* ── Upload error banner ── */}
      {errorMsg && (
        <div
          style={{
            marginTop: '6px',
            padding: '8px 12px',
            background: tokens.colorStatusDangerBackground1,
            border: `1px solid ${tokens.colorStatusDangerBorder1}`,
            borderRadius: '6px',
            color: tokens.colorStatusDangerForeground1,
            fontSize: '12px',
          }}
        >
          {errorMsg}
        </div>
      )}
    </div>
  )
}
