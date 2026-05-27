import clsx from 'clsx';

interface Props { className?: string; }

export function Skeleton({ className }: Props) {
  return <div className={clsx('skeleton', className)} />;
}

export default Skeleton;

export function ProductCardSkeleton() {
  return (
    <div className="card p-4 space-y-3">
      <Skeleton className="h-40 w-full rounded-apple" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-pill" />
        <Skeleton className="h-6 w-16 rounded-pill" />
      </div>
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}
