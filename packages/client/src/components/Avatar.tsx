interface AvatarProps {
  name: string
  avatarUrl?: string
  size?: number
}

export default function Avatar({ name, avatarUrl, size = 24 }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // Deterministic background color based on name
  const colors = ['#388bfd', '#3fb950', '#f78166', '#d2a8ff', '#ffa657', '#79c0ff', '#56d364']
  const colorIndex = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length
  const bg = colors[colorIndex]

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        title={name}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    )
  }

  return (
    <span
      title={name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: '#0d1117',
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initials}
    </span>
  )
}
