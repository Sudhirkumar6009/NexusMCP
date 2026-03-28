import React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, ...props }, ref) => {
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
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'w-full min-h-[120px] px-3 py-2.5 rounded-md border border-border bg-surface-primary text-content-primary placeholder:text-content-tertiary',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface-secondary',
            'resize-y',
            error && 'border-error focus:ring-error/50 focus:border-error',
            className
          )}
          {...props}
        />
        {error && <p className="mt-1.5 text-sm text-error">{error}</p>}
        {hint && !error && <p className="mt-1.5 text-sm text-content-tertiary">{hint}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export { Textarea };
