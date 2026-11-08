import type { BugSeverity, BugStatus, Priority, ResultStatus } from '@qtm/shared';
import { cn } from '@/lib/utils';
import { humanize } from '@/lib/format';

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'gray';

const TONES: Record<Tone, string> = {
  green: 'bg-success/12 text-success ring-success/25',
  red: 'bg-destructive/12 text-destructive ring-destructive/25',
  amber: 'bg-warning/12 text-warning ring-warning/25',
  blue: 'bg-info/12 text-info ring-info/25',
  violet: 'bg-primary/12 text-primary ring-primary/25',
  gray: 'bg-muted text-muted-foreground ring-border',
};

const RESULT: Record<ResultStatus, Tone> = { PASSED: 'green', FAILED: 'red', BLOCKED: 'amber', SKIPPED: 'gray', NOT_RUN: 'gray' };
const SEVERITY: Record<BugSeverity, Tone> = { CRITICAL: 'red', HIGH: 'amber', MEDIUM: 'blue', LOW: 'gray' };
const BUG_STATUS: Record<BugStatus, Tone> = { OPEN: 'red', IN_PROGRESS: 'blue', RESOLVED: 'green', CLOSED: 'gray', REOPENED: 'amber' };

const GENERIC: Record<string, Tone> = {
  ...RESULT,
  ...BUG_STATUS,
  ACTIVE: 'green',
  ARCHIVED: 'gray',
  DRAFT: 'gray',
  READY: 'green',
  DEPRECATED: 'amber',
  COMPLETED: 'green',
  IN_PROGRESS: 'blue',
  ABORTED: 'amber',
  INTERRUPTED: 'amber',
};

export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const ResultBadge = ({ status }: { status: ResultStatus }) => <Pill tone={RESULT[status]}>{humanize(status)}</Pill>;
export const SeverityBadge = ({ severity }: { severity: BugSeverity }) => <Pill tone={SEVERITY[severity]}>{humanize(severity)}</Pill>;
export const PriorityBadge = ({ priority }: { priority: Priority }) => <Pill tone={SEVERITY[priority]}>{humanize(priority)}</Pill>;
export const StatusBadge = ({ status }: { status: string }) => <Pill tone={GENERIC[status] ?? 'gray'}>{humanize(status)}</Pill>;
export const AiBadge = () => (
  <Pill tone="violet" className="uppercase tracking-wide">
    AI
  </Pill>
);
