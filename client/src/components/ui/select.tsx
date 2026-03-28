import React from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
  onChange?: (value: string) => void;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, hint, options, placeholder, onChange, ...props }, ref) => {
    const id = props.id || props.name;

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange?.(e.target.value);
    };

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={id}
            className="block text-sm font-medium text-content-primary mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={id}
            className={cn(
              'w-full h-10 px-3 pr-10 rounded-md border border-border bg-surface-primary text-content-primary',
              'transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface-secondary',
              'appearance-none cursor-pointer',
              error && 'border-error focus:ring-error/50 focus:border-error',
              className
            )}
            onChange={handleChange}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-content-tertiary pointer-events-none" />
        </div>
        {error && <p className="mt-1.5 text-sm text-error">{error}</p>}
        {hint && !error && <p className="mt-1.5 text-sm text-content-tertiary">{hint}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

export { Select };
