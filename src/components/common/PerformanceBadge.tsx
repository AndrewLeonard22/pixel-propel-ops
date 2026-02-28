import type { PerformanceLevel } from '@/lib/types';

const styles: Record<PerformanceLevel, string> = {
  good: 'bg-success/10 text-success',
  fair: 'bg-warning/10 text-warning',
  poor: 'bg-destructive/10 text-destructive',
};

export default function PerformanceBadge({ level }: { level: PerformanceLevel }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${styles[level]}`}>
      {level}
    </span>
  );
}
