import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-medium text-text-secondary">{label}</label>
      )}
      <input
        ref={ref}
        className={cn(
          'w-full bg-bg-surface border rounded-lg px-3 py-2 text-sm text-text-primary',
          'placeholder:text-text-muted',
          'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error ? 'border-status-error' : 'border-border-default',
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  ),
)
Input.displayName = 'Input'
