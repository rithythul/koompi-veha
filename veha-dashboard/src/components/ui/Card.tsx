import { cn } from '../../lib/utils'

interface CardProps {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export function Card({ title, action, children, className, padding = true }: CardProps) {
  return (
    <div className={cn('bg-bg-surface border border-border-default rounded-lg', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          {title && <h3 className="text-sm font-semibold text-text-primary">{title}</h3>}
          {action}
        </div>
      )}
      <div className={cn(padding && 'p-4')}>{children}</div>
    </div>
  )
}
