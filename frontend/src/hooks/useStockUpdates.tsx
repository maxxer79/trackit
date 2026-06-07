import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getSocket } from '../lib/socket';
import { useAuthStore } from '../store/auth';

interface StockUpdateEvent {
  productId: string;
  productSlug: string;
  productName: string;
  storeSlug: string;
  storeName: string;
  status: string;
  price?: number | null;
  productUrl: string;
}

export function useStockUpdates() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!user) return;

    const socket = getSocket();

    const handleStockUpdate = (event: StockUpdateEvent) => {
      // Invalidate relevant queries
      qc.invalidateQueries({ queryKey: ['product', event.productSlug] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['tracking'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });

      // Show toast notification
      const priceStr = event.price ? ` — $${event.price.toFixed(2)}` : '';
      const statusLabel = event.status === 'LIMITED' ? 'Limited Stock' : 'In Stock';

      toast.custom(
        (t) => (
          <a
            href={event.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-start gap-3 p-4 bg-dark-surface1 border border-apple-green/30
                       rounded-apple-lg shadow-glow-green cursor-pointer max-w-sm
                       ${t.visible ? 'animate-slide-down' : 'opacity-0'}`}
          >
            <span className="text-xl mt-0.5">🟢</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-dark-label1 text-subhead truncate">{event.productName}</p>
              <p className="text-footnote text-apple-green mt-0.5">
                {statusLabel} at {event.storeName}{priceStr}
              </p>
            </div>
          </a>
        ),
        { duration: 8000, id: `stock-${event.productSlug}-${event.storeSlug}` }
      );
    };

    socket.on('stock-update', handleStockUpdate);

    return () => {
      socket.off('stock-update', handleStockUpdate);
    };
  }, [user, qc]);
}
