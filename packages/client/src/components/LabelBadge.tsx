interface LabelBadgeProps {
  name: string
  color: string
}

export default function LabelBadge({ name, color }: LabelBadgeProps) {
  // Compute a readable text color from the background color
  const hex = color.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const textColor = luminance > 0.5 ? '#0d1117' : '#e6edf3'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: color,
        color: textColor,
        borderRadius: '12px',
        padding: '2px 8px',
        fontSize: '11px',
        fontWeight: 500,
        lineHeight: '1.4',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </span>
  )
}
