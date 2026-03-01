import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: SelectOption[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, ...props }, ref) => (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-medium text-text-secondary">{label}</label>
      )}
      <select
        ref={ref}
        className={cn(
          'w-full bg-bg-surface border rounded-lg px-3 py-2 text-sm text-text-primary',
          'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error ? 'border-status-error' : 'border-border-default',
          className,
        )}
        {...props}
      >
        {placeholder && (
          <option value="" className="text-text-muted">
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  ),
)
Select.displayName = 'Select'
