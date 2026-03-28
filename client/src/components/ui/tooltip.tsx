'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export function Tooltip({ content, children, side = 'top', delay = 200 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const show = () => {
    const id = setTimeout(() => setIsVisible(true), delay);
    setTimeoutId(id);
  };

  const hide = () => {
    if (timeoutId) clearTimeout(timeoutId);
    setIsVisible(false);
  };

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrows = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-surface-tertiary border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-surface-tertiary border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-surface-tertiary border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-surface-tertiary border-y-transparent border-l-transparent',
  };

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {isVisible && (
        <div
          className={cn(
            'absolute z-50 px-2 py-1 text-xs font-medium text-content-primary bg-surface-tertiary rounded shadow-md whitespace-nowrap',
            'animate-in fade-in duration-150',
            positions[side]
          )}
          role="tooltip"
        >
          {content}
          <span
            className={cn('absolute border-4', arrows[side])}
            style={{ width: 0, height: 0 }}
          />
        </div>
      )}
    </div>
  );
}
