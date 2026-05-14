interface CostDisplayProps {
  costUsd?: string
  costTokens?: number
}

export default function CostDisplay({ costUsd, costTokens }: CostDisplayProps) {
  if (!costUsd && !costTokens) return null

  const parts: string[] = []
  if (costUsd) parts.push(`$${parseFloat(costUsd).toFixed(3)}`)
  if (costTokens) parts.push(`${costTokens.toLocaleString()} tokens`)

  return (
    <span
      style={{
        fontSize: '11px',
        color: '#8b949e',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      {parts.join(' · ')}
    </span>
  )
}
