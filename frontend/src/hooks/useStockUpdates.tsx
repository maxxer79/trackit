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

interface PriceDropEvent extends StockUpdateEvent {
  previousPrice?: number | null;
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

    const handlePriceDrop = (event: PriceDropEvent) => {
      qc.invalidateQueries({ queryKey: ['product', event.productSlug] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['tracking'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });

      const wasStr = event.previousPrice ? ` (was $${event.previousPrice.toFixed(2)})` : '';
      toast.custom(
        (t) => (
          <a
            href={event.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-start gap-3 p-4 bg-dark-surface1 border border-apple-blue/30
                       rounded-apple-lg cursor-pointer max-w-sm
                       ${t.visible ? 'animate-slide-down' : 'opacity-0'}`}
          >
            <span className="text-xl mt-0.5">💸</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-dark-label1 text-subhead truncate">{event.productName}</p>
              <p className="text-footnote text-apple-blue mt-0.5">
                Price drop at {event.storeName}
                {event.price != null ? ` — $${event.price.toFixed(2)}` : ''}{wasStr}
              </p>
            </div>
          </a>
        ),
        { duration: 8000, id: `pricedrop-${event.productSlug}-${event.storeSlug}` }
      );
    };

    socket.on('stock-update', handleStockUpdate);
    socket.on('price-drop', handlePriceDrop);

    return () => {
      socket.off('stock-update', handleStockUpdate);
      socket.off('price-drop', handlePriceDrop);
    };
  }, [user, qc]);
}
