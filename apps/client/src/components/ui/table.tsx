import React from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react';

// Table Root
export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, ...props }, ref) => (
    <div className="w-full overflow-auto">
      <table
        ref={ref}
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
);

Table.displayName = 'Table';

// Table Header
const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('border-b border-border', className)} {...props} />
));

TableHeader.displayName = 'TableHeader';

// Table Body
const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));

TableBody.displayName = 'TableBody';

// Table Footer
const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t border-border bg-surface-secondary font-medium', className)}
    {...props}
  />
));

TableFooter.displayName = 'TableFooter';

// Table Row
const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border transition-colors hover:bg-surface-secondary/50',
        className
      )}
      {...props}
    />
  )
);

TableRow.displayName = 'TableRow';

// Table Head
export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sorted?: 'asc' | 'desc' | false;
  onSort?: () => void;
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, sortable, sorted, onSort, children, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'h-10 px-3 text-left align-middle font-medium text-content-secondary',
        sortable && 'cursor-pointer select-none hover:text-content-primary',
        className
      )}
      onClick={sortable ? onSort : undefined}
      {...props}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortable && (
          <span className="ml-1">
            {sorted === 'asc' ? (
              <ChevronUp className="h-4 w-4" />
            ) : sorted === 'desc' ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ArrowUpDown className="h-3 w-3 opacity-50" />
            )}
          </span>
        )}
      </div>
    </th>
  )
);

TableHead.displayName = 'TableHead';

// Table Cell
const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('px-3 py-3 align-middle text-content-primary', className)}
      {...props}
    />
  )
);

TableCell.displayName = 'TableCell';

// Empty State
export interface TableEmptyProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

function TableEmpty({ icon, title, description, action }: TableEmptyProps) {
  return (
    <TableRow>
      <TableCell colSpan={100}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          {icon && <div className="mb-4 text-content-tertiary">{icon}</div>}
          <h3 className="text-sm font-medium text-content-primary">{title}</h3>
          {description && (
            <p className="mt-1 text-sm text-content-secondary max-w-sm">{description}</p>
          )}
          {action && <div className="mt-4">{action}</div>}
        </div>
      </TableCell>
    </TableRow>
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableEmpty };
