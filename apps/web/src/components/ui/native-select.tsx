import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Styled native <select>: accessible by default and works with react-hook-form `register`. */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        'h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs outline-none transition-[color,box-shadow] dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive [&>option]:bg-popover',
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
  </div>
));
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
