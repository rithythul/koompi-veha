import { cn } from '../../lib/utils'

type BadgeVariant = 'online' | 'offline' | 'warning' | 'error' | 'info' | 'default' | 'accent'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
  dot?: boolean
}

const variantStyles: Record<BadgeVariant, string> = {
  online: 'bg-status-online/15 text-status-online',
  offline: 'bg-status-neutral/15 text-status-neutral',
  warning: 'bg-status-warning/15 text-status-warning',
  error: 'bg-status-error/15 text-status-error',
  info: 'bg-status-info/15 text-status-info',
  default: 'bg-bg-elevated text-text-secondary',
  accent: 'bg-accent/15 text-accent',
}

export function Badge({ variant = 'default', children, className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        variantStyles[variant],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            variant === 'online' ? 'bg-status-online animate-pulse-dot' : '',
            variant === 'offline' ? 'bg-status-neutral' : '',
            variant === 'warning' ? 'bg-status-warning' : '',
            variant === 'error' ? 'bg-status-error' : '',
            variant === 'info' ? 'bg-status-info' : '',
            variant === 'default' ? 'bg-text-muted' : '',
            variant === 'accent' ? 'bg-accent' : '',
          )}
        />
      )}
      {children}
    </span>
  )
}
