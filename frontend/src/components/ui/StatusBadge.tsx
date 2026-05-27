import { StockStatus } from '../../types';
import clsx from 'clsx';

interface Props {
  status: StockStatus;
  size?: 'sm' | 'md';
}

const config: Record<StockStatus, { label: string; className: string; dot: string }> = {
  IN_STOCK:     { label: 'In Stock',    className: 'badge-in-stock',    dot: 'bg-apple-green' },
  LIMITED:      { label: 'Limited',     className: 'badge-limited',     dot: 'bg-apple-orange' },
  PREORDER:     { label: 'Pre-order',   className: 'badge-preorder',    dot: 'bg-apple-blue' },
  OUT_OF_STOCK: { label: 'Out of Stock',className: 'badge-out-of-stock',dot: 'bg-apple-red' },
  UNKNOWN:      { label: 'Unknown',     className: 'badge-unknown',     dot: 'bg-dark-surface4' },
};

export default function StatusBadge({ status, size = 'md' }: Props) {
  const { label, className, dot } = config[status] || config.UNKNOWN;

  return (
    <span className={clsx(className, size === 'sm' && 'px-2 py-0.5 text-caption1')}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', dot)} />
      {label}
    </span>
  );
}
