export interface WorkflowStep {
  type: 'route' | 'agent_run' | 'approve' | string
  label?: string
  agent?: string
}

const STEP_ICONS: Record<string, string> = {
  route: '⇄',
  agent_run: '▶',
  approve: '✓',
}

const STEP_COLORS: Record<string, string> = {
  route: '#388bfd',
  agent_run: '#3fb950',
  approve: '#d29922',
}

interface WorkflowStepFlowProps {
  steps: WorkflowStep[]
  activeStepIndex?: number
}

const BOX_W = 200
const BOX_H = 64
const BOX_GAP = 48
const SVG_PAD = 24
const ARROW_H = BOX_GAP
const TOTAL_H = (steps: WorkflowStep[]) =>
  SVG_PAD * 2 + steps.length * BOX_H + Math.max(0, steps.length - 1) * ARROW_H
const SVG_W = BOX_W + SVG_PAD * 2

export default function WorkflowStepFlow({ steps, activeStepIndex }: WorkflowStepFlowProps) {
  if (steps.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          fontSize: '13px',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '24px' }}>⬡</span>
        <span>No steps yet — start typing YAML on the left</span>
      </div>
    )
  }

  const svgH = TOTAL_H(steps)

  return (
    <svg
      width={SVG_W}
      height={svgH}
      viewBox={`0 0 ${SVG_W} ${svgH}`}
      style={{ display: 'block', margin: '0 auto' }}
    >
      {steps.map((step, i) => {
        const x = SVG_PAD
        const y = SVG_PAD + i * (BOX_H + ARROW_H)
        const cx = SVG_PAD + BOX_W / 2
        const isActive = activeStepIndex === i
        const stepType = step.type ?? 'route'
        const icon = STEP_ICONS[stepType] ?? '▪'
        const color = STEP_COLORS[stepType] ?? '#656d76'
        const label = step.label ?? stepType
        const subLabel = step.agent ? `@${step.agent}` : null

        return (
          <g key={i}>
            {/* Arrow from previous step */}
            {i > 0 && (
              <>
                <line
                  x1={cx}
                  y1={y - ARROW_H}
                  x2={cx}
                  y2={y - 8}
                  stroke="#d0d7de"
                  strokeWidth="2"
                />
                {/* Arrowhead */}
                <polygon
                  points={`${cx - 5},${y - 8} ${cx + 5},${y - 8} ${cx},${y - 1}`}
                  fill="#d0d7de"
                />
              </>
            )}

            {/* Box */}
            <rect
              x={x}
              y={y}
              width={BOX_W}
              height={BOX_H}
              rx={6}
              fill={isActive ? 'rgba(56,139,253,0.15)' : '#f6f8fa'}
              stroke={isActive ? '#388bfd' : color}
              strokeWidth={isActive ? 2 : 1}
            />

            {/* Step number pill */}
            <circle cx={x + 16} cy={y + BOX_H / 2} r={10} fill={color} opacity={0.2} />
            <text
              x={x + 16}
              y={y + BOX_H / 2 + 4}
              textAnchor="middle"
              fill={color}
              fontSize={10}
              fontWeight="600"
            >
              {i + 1}
            </text>

            {/* Icon */}
            <text
              x={x + 38}
              y={y + BOX_H / 2 + 5}
              fontSize={16}
              textAnchor="middle"
            >
              {icon}
            </text>

            {/* Label */}
            <text
              x={x + 56}
              y={subLabel ? y + BOX_H / 2 - 4 : y + BOX_H / 2 + 5}
              fontSize={12}
              fontWeight={500}
              fill="#1f2328"
            >
              {label.length > 20 ? label.slice(0, 19) + '…' : label}
            </text>

            {/* Sub-label (agent name) */}
            {subLabel && (
              <text
                x={x + 56}
                y={y + BOX_H / 2 + 13}
                fontSize={10}
                fill="#656d76"
              >
                {subLabel.length > 22 ? subLabel.slice(0, 21) + '…' : subLabel}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
