import { cn } from '../../lib/utils'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeStyles = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-[3px]',
  lg: 'w-8 h-8 border-[3px]',
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <div
      className={cn(
        'rounded-full border-border-default border-t-accent animate-spin',
        sizeStyles[size],
        className,
      )}
    />
  )
}

export function FullScreenSpinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <Spinner size="lg" />
    </div>
  )
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner size="lg" />
    </div>
  )
}
