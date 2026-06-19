import { useState } from 'react';
import toast from 'react-hot-toast';
import { useCreatePurchase, CARRIERS } from '../../hooks/usePurchases';

interface Props {
  productId: string;
  defaultStoreName?: string | null;
  defaultPrice?: number | null;
}

export default function MarkPurchased({ productId, defaultStoreName, defaultPrice }: Props) {
  const create = useCreatePurchase();
  const [open, setOpen] = useState(false);
  const [storeName, setStoreName] = useState(defaultStoreName ?? '');
  const [price, setPrice] = useState(defaultPrice != null ? String(defaultPrice) : '');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  const submit = () => {
    const priceNum = price.trim() === '' ? null : Number(price);
    if (priceNum !== null && (Number.isNaN(priceNum) || priceNum < 0)) {
      toast.error('Enter a valid price');
      return;
    }
    create.mutate(
      {
        productId,
        storeName: storeName.trim() || null,
        price: priceNum,
        carrier: carrier || null,
        trackingNumber: trackingNumber.trim() || null,
      } as any,
      {
        onSuccess: () => {
          toast.success('Saved to Purchases');
          setOpen(false);
          setCarrier('');
          setTrackingNumber('');
        },
        onError: () => toast.error('Could not save purchase'),
      }
    );
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1.5 text-caption2 text-dark-label3 hover:text-apple-blue">
        🛒 Mark purchased
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-apple bg-dark-surface2/50 p-2.5">
      <div className="flex flex-wrap gap-2">
        <input
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          placeholder="Store"
          className="input text-caption1 py-1 flex-1 min-w-[90px]"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="$ paid"
          inputMode="decimal"
          className="input text-caption1 py-1 w-20"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="input text-caption1 py-1 w-28">
          <option value="">Carrier…</option>
          {CARRIERS.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          placeholder="Tracking #"
          className="input text-caption1 py-1 flex-1 min-w-[110px]"
        />
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={create.isPending} className="text-caption2 text-apple-blue font-semibold hover:underline disabled:opacity-40">
          {create.isPending ? 'Saving…' : 'Save purchase'}
        </button>
        <button onClick={() => setOpen(false)} className="text-caption2 text-dark-label3 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
