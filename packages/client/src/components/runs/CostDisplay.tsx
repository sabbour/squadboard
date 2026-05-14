interface CostDisplayProps {
  costUsd?: string
  /** Total tokens (legacy — used when split is unavailable) */
  costTokens?: number
  /** Tokens consumed (input/prompt) */
  tokensIn?: number
  /** Tokens generated (output/completion) */
  tokensOut?: number
  /** Model name shown in tooltip */
  model?: string
}

function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export default function CostDisplay({ costUsd, costTokens, tokensIn, tokensOut, model }: CostDisplayProps) {
  if (!costUsd && !costTokens && !tokensIn && !tokensOut) return null

  const usdLabel = costUsd ? `$${parseFloat(costUsd).toFixed(4)}` : null

  // Prefer split token counts; fall back to combined costTokens
  const tokenLabel = (() => {
    if (tokensIn != null && tokensOut != null) return `${fmtK(tokensIn)} in / ${fmtK(tokensOut)} out`
    if (costTokens) return `${fmtK(costTokens)} tok`
    return null
  })()

  const tooltip = [model, usdLabel, tokenLabel].filter(Boolean).join(' · ')

  return (
    <span
      title={tooltip}
      style={{
        fontSize: '11px',
        color: 'var(--text-muted)',
        alignItems: 'center',
        gap: '4px',
        cursor: 'default',
      }}
    >
      {usdLabel && <span>{usdLabel}</span>}
      {tokenLabel && (
        <span style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
          ({tokenLabel})
        </span>
      )}
    </span>
  )
}
