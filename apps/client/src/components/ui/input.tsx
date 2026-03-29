import React from 'react';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  isSearch?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, label, error, hint, leftIcon, rightIcon, isSearch, type = 'text', ...props },
    ref
  ) => {
    const id = props.id || props.name;

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
          {(leftIcon || isSearch) && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary">
              {isSearch ? <Search className="h-4 w-4" /> : leftIcon}
            </div>
          )}
          <input
            ref={ref}
            type={type}
            id={id}
            className={cn(
              'w-full h-10 px-3 rounded-md border border-border bg-surface-primary text-content-primary placeholder:text-content-tertiary',
              'transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface-secondary',
              (leftIcon || isSearch) && 'pl-10',
              rightIcon && 'pr-10',
              error && 'border-error focus:ring-error/50 focus:border-error',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-content-tertiary">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="mt-1.5 text-sm text-error">{error}</p>}
        {hint && !error && <p className="mt-1.5 text-sm text-content-tertiary">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
