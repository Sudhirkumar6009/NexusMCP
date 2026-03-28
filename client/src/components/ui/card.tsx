import React from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'bordered' | 'elevated';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'bordered', padding = 'md', hoverable = false, ...props }, ref) => {
    const variants = {
      default: 'bg-surface-primary',
      bordered: 'bg-surface-primary border border-border',
      elevated: 'bg-surface-primary shadow-md',
    };

    const paddings = {
      none: '',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-6',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-lg',
          variants[variant],
          paddings[padding],
          hoverable && 'card-hover cursor-pointer',
          className
        )}
        {...props}
      />
    );
  }
);

Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-between mb-4', className)}
      {...props}
    />
  )
);

CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-lg font-semibold text-content-primary', className)}
      {...props}
    />
  )
);

CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-sm text-content-secondary', className)}
      {...props}
    />
  )
);

CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('', className)} {...props} />
  )
);

CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 mt-4 pt-4 border-t border-border', className)}
      {...props}
    />
  )
);

CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
