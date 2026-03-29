import React from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'default' | 'success' | 'error' | 'warning' | 'info' | 'primary';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', size = 'md', dot = false, children, ...props }, ref) => {
    const variants = {
      default: 'bg-surface-tertiary text-content-secondary',
      success: 'bg-success-light text-success',
      error: 'bg-error-light text-error',
      warning: 'bg-warning-light text-warning',
      info: 'bg-info-light text-info',
      primary: 'bg-primary-light text-primary',
    };

    const sizes = {
      sm: 'text-2xs px-1.5 py-0.5',
      md: 'text-xs px-2 py-0.5',
    };

    const dotColors = {
      default: 'bg-content-tertiary',
      success: 'bg-success',
      error: 'bg-error',
      warning: 'bg-warning',
      info: 'bg-info',
      primary: 'bg-primary',
    };

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1.5 font-medium rounded-full',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dotColors[variant])} />}
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

export { Badge };
