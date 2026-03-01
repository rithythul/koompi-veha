import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, ...props }, ref) => (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-medium text-text-secondary">{label}</label>
      )}
      <textarea
        ref={ref}
        className={cn(
          'w-full bg-bg-surface border rounded-lg px-3 py-2 text-sm text-text-primary',
          'placeholder:text-text-muted resize-none',
          'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent',
          error ? 'border-status-error' : 'border-border-default',
          className,
        )}
        rows={3}
        {...props}
      />
      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  ),
)
Textarea.displayName = 'Textarea'
